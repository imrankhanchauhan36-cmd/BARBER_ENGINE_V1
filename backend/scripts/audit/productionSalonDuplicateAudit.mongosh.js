/**
 * BARBER_ENGINE_V1 — read-only production audit
 * Salon duplicate / data-shape audit for the `salons` collection.
 *
 * WHAT THIS IS: a read-only reporting script. It only runs
 * countDocuments()/aggregate() with no $merge, $out, $set, update,
 * delete, or index operation anywhere in this file. It prints only
 * aggregate counts — no ownerId, salonId, salon name, phone number,
 * or any other per-document field. Verified against the actual
 * Mongoose model (models/Salon.js) before writing this file:
 *   - Collection name: "salons" (default pluralization — no explicit
 *     `collection:` override in SalonSchema).
 *   - ownerId: ObjectId, schema says required:true — but that is a
 *     Mongoose application-level check, not a MongoDB-level
 *     constraint, so older or directly-inserted documents can still
 *     have it missing or null. This script checks for that instead
 *     of assuming the schema guarantee holds in the real data.
 *   - isDeleted: Boolean, schema default:false — same caveat: the
 *     default only applies to documents created through Mongoose;
 *     it does not retroactively add the field to existing documents
 *     that predate it. This script categorizes true/false/missing
 *     separately rather than assuming "false" covers everything.
 *   - approval.status: String enum ["DRAFT","PENDING","APPROVED",
 *     "REJECTED"], schema default:"DRAFT" — same caveat as above.
 *
 * HOW TO RUN (once):
 *   1. Open a mongosh session against the intended database yourself
 *      (this script never contains or asks for a connection string):
 *        mongosh "<your own production connection string>"
 *   2. Run the PREFLIGHT block first (Section 0 below) and read its
 *      output. Confirm the database name and collection list look
 *      right BEFORE running anything else. If anything looks wrong,
 *      stop and reconnect — nothing past this point assumes you
 *      checked correctly.
 *   3. Then run:  mongosh "<your own production connection string>" --file productionSalonDuplicateAudit.mongosh.js
 *      — or paste the whole file into the shell / Compass's embedded
 *      "MongoSH" shell tab (modern Compass ships one; pasting works
 *      interactively without the --file flag).
 *   4. Copy the full printed JSON report back for review. Nothing in
 *      this script modifies any record, index, or schema.
 *
 * Wrapped in a single async IIFE below — required for `mongosh --file`
 * execution (its script-file mode does not allow bare top-level
 * `await`, unlike its interactive REPL); pasting this into an
 * interactive shell works the same either way.
 */
(async () => {

// ── SECTION 0 — PREFLIGHT (run this first, confirm before continuing) ──
// Prints only the database name and collection list — never the
// connection string, host, or any credential. This is how you confirm
// you are pointed at the database you intend to audit, without this
// script ever seeing or printing your connection details.
print("\n=== PREFLIGHT ===");
print("Connected database name:", db.getName());
print("Collections in this database (names only):");
print(JSON.stringify(db.getCollectionNames().sort(), null, 2));
const salonsExists = db.getCollectionNames().includes("salons");
print("`salons` collection present:", salonsExists);
if (!salonsExists) {
  print("\n⚠️  STOP — no `salons` collection in this database. You are likely connected to the wrong database. Reconnect and re-run the preflight before continuing.");
  return;
}
print("Estimated total documents in `salons` (fast, approximate):", await db.salons.estimatedDocumentCount());
print("=== END PREFLIGHT — review the above before continuing ===\n");

// ── SECTION 1 — isDeleted categorization ────────────────────────────
// Three mutually exclusive buckets, each counted independently. Also
// reports the two natural "active" and "deleted" rollups explicitly,
// so nothing is silently assumed about what "missing" should mean.
print("=== SECTION 1 — isDeleted breakdown ===");
const isDeletedFalse = await db.salons.countDocuments({ isDeleted: false });
const isDeletedTrue  = await db.salons.countDocuments({ isDeleted: true });
const isDeletedMissingOrNull = await db.salons.countDocuments({
  $or: [{ isDeleted: { $exists: false } }, { isDeleted: null }],
});
print(JSON.stringify({
  isDeleted_false: isDeletedFalse,
  isDeleted_true: isDeletedTrue,
  isDeleted_missingOrNull: isDeletedMissingOrNull,
  // Rollup only — not a new query, just the sum of the two buckets
  // above that are NOT explicitly marked deleted. Labeled explicitly
  // so it is never confused with a raw field value.
  rollup_notExplicitlyDeleted_falseOrMissing: isDeletedFalse + isDeletedMissingOrNull,
}, null, 2));

// ── SECTION 2 — ownerId missing/null ─────────────────────────────────
print("\n=== SECTION 2 — ownerId presence ===");
const ownerIdMissingOrNull = await db.salons.countDocuments({
  $or: [{ ownerId: { $exists: false } }, { ownerId: null }],
});
const ownerIdPresent = await db.salons.countDocuments({
  ownerId: { $exists: true, $ne: null },
});
print(JSON.stringify({ ownerId_missingOrNull: ownerIdMissingOrNull, ownerId_present: ownerIdPresent }, null, 2));

// ── SECTION 3 — approval.status breakdown, including missing ────────
print("\n=== SECTION 3 — approval.status breakdown ===");
const statusBreakdown = await db.salons.aggregate([
  {
    $group: {
      _id: { $ifNull: ["$approval.status", "MISSING_OR_NULL"] },
      count: { $sum: 1 },
    },
  },
  { $sort: { _id: 1 } },
]).toArray();
print(JSON.stringify(statusBreakdown, null, 2));

// ── SECTION 4 — owner-duplicate counts (the core question) ──────────
// Documents with a missing/null ownerId are excluded BEFORE grouping
// in every pipeline below — otherwise they would all collapse into
// one misleading "_id: null" group that looks like a single owner
// with many salons, which is not a real duplicate-ownership case.
print("\n=== SECTION 4 — owner-duplicate counts (ownerId missing/null excluded from every count below) ===");

// 4a. Narrowest, most actionable scope: owners with more than one
// SIMULTANEOUSLY ACTIVE (not explicitly deleted, and PENDING or
// APPROVED) salon — this is the exact scope the new application-level
// guard (controllers/salon.controller.js#onboardSalon) already
// enforces going forward; this count tells you whether it already
// happened before that guard existed.
const activeDuplicates = await db.salons.aggregate([
  {
    $match: {
      ownerId: { $exists: true, $ne: null },
      $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }, { isDeleted: null }],
      "approval.status": { $in: ["PENDING", "APPROVED"] },
    },
  },
  { $group: { _id: "$ownerId", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: "ownersWithMultipleActiveSalons" },
]).toArray();
print("4a. Owners with >1 simultaneously PENDING/APPROVED, not-explicitly-deleted salon:");
print(JSON.stringify(activeDuplicates[0] || { ownersWithMultipleActiveSalons: 0 }, null, 2));

// 4b. Broader scope: owners with more than one not-explicitly-deleted
// salon in ANY status (DRAFT/PENDING/APPROVED/REJECTED/missing) — for
// comparison only, not the primary question.
const anyStatusDuplicates = await db.salons.aggregate([
  {
    $match: {
      ownerId: { $exists: true, $ne: null },
      $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }, { isDeleted: null }],
    },
  },
  { $group: { _id: "$ownerId", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: "ownersWithMultipleNotDeletedSalons" },
]).toArray();
print("\n4b. Owners with >1 not-explicitly-deleted salon, any status (comparison only):");
print(JSON.stringify(anyStatusDuplicates[0] || { ownersWithMultipleNotDeletedSalons: 0 }, null, 2));

// 4c. Widest scope: owners with more than one salon document at all,
// including ones explicitly marked isDeleted:true — purely
// informational, tells you nothing about current live risk.
const absoluteDuplicates = await db.salons.aggregate([
  { $match: { ownerId: { $exists: true, $ne: null } } },
  { $group: { _id: "$ownerId", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: "ownersWithMultipleSalonsAnyState" },
]).toArray();
print("\n4c. Owners with >1 salon document in any state at all (informational only):");
print(JSON.stringify(absoluteDuplicates[0] || { ownersWithMultipleSalonsAnyState: 0 }, null, 2));

print("\n=== AUDIT COMPLETE — copy the full output above for review. No records, indexes, or schemas were modified. ===");

})();
