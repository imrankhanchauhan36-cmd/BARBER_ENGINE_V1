/**
 * BARBER_ENGINE_V1
 * backend/scripts/migrations/02_repairStaffChairIndexes.js
 *
 * Part E — Staff/Chair unique-index repair. Standalone, manually-run,
 * idempotent index migration — follows the same established
 * precedent as scripts/migrations/00_createIndexes.js and
 * 01_createFraudDetectionIndexes.js: builds indexes directly against
 * the target collection via `Model.collection.createIndex()`, never
 * modifying models/Staff.js or models/Chair.js.
 *
 * THREE DEFECTS THIS REPAIRS (confirmed by direct schema read):
 *   1. Staff {salonId,phone} — partialFilterExpression used an
 *      unsupported `{$ne: null}` operator.
 *   2. Staff {chairId} — combined `sparse:true` WITH
 *      partialFilterExpression (an unsupported combination), AND
 *      also used `{$ne: null}`.
 *   3. Chair {salonId,chairCode} — combined `sparse:true` with
 *      partialFilterExpression.
 * None of the three has ever successfully built via Mongoose's
 * autoIndex, in any environment including production (config/db.js
 * sets autoIndex:true; neither 00_createIndexes.js nor
 * 01_createFraudDetectionIndexes.js mentions Staff or Chair) — the
 * uniqueness they are meant to enforce has never actually existed.
 *
 * ──────────────────────────────────────────────────────────────
 * ⚠️  THIS SCRIPT WAS CREATED FOR REVIEW ONLY. IT HAS NOT BEEN RUN
 *     AGAINST ANY DATABASE. Do not run it until you have reviewed
 *     this file, the paired regression test
 *     (scripts/e2e/verifyStaffChairIndexRepair.mjs), and the
 *     deviation noted below, and explicitly approved proceeding.
 * ──────────────────────────────────────────────────────────────
 *
 * DEVIATION FROM THE ORIGINALLY PROPOSED CHAIR DEFINITION — found by
 * the paired regression test, not assumed: chairCode defaults to
 * null on every Chair document (same as Staff's phone/chairId), and
 * the originally proposed filter ({isDeleted:false} only, no
 * null-exclusion) was proven, by actually inserting two such
 * documents in the test, to reject two ACTIVE chairs with no
 * chairCode set in the same salon as a false duplicate — a state the
 * ORIGINAL (never-enforced) index never blocked, and one this
 * migration must not newly forbid without your explicit knowledge.
 * This script therefore adds the same `$type:"string"` null-exclusion
 * already used for Staff's phone/chairId. If you want the Chair index
 * to match the literally-proposed definition instead (no
 * null-exclusion), change CHAIR_CODE_INDEX.partialFilterExpression
 * below before running — but note the preflight below will not catch
 * a null/null collision as a "duplicate" either way unless it uses
 * the same filter as the index it is checking.
 *
 * STAGING NOTE: this project has no separate staging MongoDB cluster
 * (confirmed by scripts/curateAreaAligarh.js's own header comment —
 * MONGODB_URI always points at the real cluster). This script cannot
 * independently know whether the URI it is given is "staging" or
 * "production" — the --confirm flag below is a deliberate,
 * explicit-intent gate (same convention as curateAreaAligarh.js),
 * not a technical guarantee of environment. Point MONGODB_URI at
 * whatever target you intend before running; this script only
 * refuses to run with NO explicit confirmation at all.
 *
 * Run (NOT executed as part of creating this file):
 *   cd backend && node scripts/migrations/02_repairStaffChairIndexes.js --confirm
 *
 * Omitting --confirm, or running with NODE_ENV=production, refuses
 * to open any database connection at all.
 */

import dotenv from "dotenv";
dotenv.config();

//////////////////////////////////////////////////////////////
// 🔒 GUARD 1 — HARD PRODUCTION BLOCK, checked BEFORE any DB
// connection is opened. Same convention as
// scripts/seedSupportTestUsers.js / seedSupportTestConfig.js.
//////////////////////////////////////////////////////////////
if (process.env.NODE_ENV === "production") {
  console.error("❌ BLOCKED: 02_repairStaffChairIndexes.js must never run with NODE_ENV=production.");
  console.error("   No connection was opened. No data was read or written.");
  process.exit(1);
}

//////////////////////////////////////////////////////////////
// 🔒 GUARD 2 — EXPLICIT CONFIRMATION FLAG, checked BEFORE any DB
// connection is opened. Same convention as scripts/curateAreaAligarh
// .js's --confirm — a deliberate, separate flag, not NODE_ENV,
// because (per that file's own header) this project has no separate
// staging cluster: whatever MONGODB_URI resolves to IS the real
// target. This flag exists so the operation can never happen by
// accident (e.g. a copy-pasted command, a CI job running this file
// by mistake) — it does not and cannot verify "staging" vs
// "production" on its own.
//////////////////////////////////////////////////////////////
const args = process.argv.slice(2);
if (!args.includes("--confirm")) {
  console.error("❌ BLOCKED: --confirm flag is required to run this migration.");
  console.error("   No connection was opened. No data was read or written.");
  console.error("   Run: node scripts/migrations/02_repairStaffChairIndexes.js --confirm");
  process.exit(1);
}

//////////////////////////////////////////////////////////////
// 🔒 GUARD 3 — MONGODB_URI must be explicitly set; never printed,
// not even partially, beyond the host for operator confirmation.
//////////////////////////////////////////////////////////////
if (!process.env.MONGODB_URI) {
  console.error("❌ BLOCKED: MONGODB_URI is not set in the environment. Refusing to guess a target.");
  process.exit(1);
}
const maskedHost = (() => {
  try {
    const u = new URL(process.env.MONGODB_URI.replace(/^mongodb\+srv:\/\//, "https://").replace(/^mongodb:\/\//, "https://"));
    return u.hostname || "(unparseable)";
  } catch {
    return "(unparseable)";
  }
})();
console.log(`🎯 Target host (credentials/connection string never printed): ${maskedHost}`);

const connectDB = (await import("../../config/db.js")).default;
const Staff = (await import("../../models/Staff.js")).default;
const Chair = (await import("../../models/Chair.js")).default;

//////////////////////////////////////////////////////////////
// INDEX DEFINITIONS — see the deviation note above for chairCode.
//////////////////////////////////////////////////////////////

const STAFF_PHONE_INDEX = {
  model: Staff,
  keys: { salonId: 1, phone: 1 },
  options: {
    unique: true,
    partialFilterExpression: { phone: { $type: "string" }, isDeleted: false },
    name: "salonId_1_phone_1",
  },
  // Preflight must mirror the index's own partial filter exactly —
  // otherwise it would flag rows the index itself would never see.
  preflight: {
    match: { isDeleted: false, phone: { $type: "string" } },
    groupKey: { salonId: "$salonId", phone: "$phone" },
  },
};

const STAFF_CHAIR_INDEX = {
  model: Staff,
  keys: { chairId: 1 },
  options: {
    unique: true,
    partialFilterExpression: { chairId: { $type: "objectId" }, isDeleted: false },
    name: "chairId_1",
  },
  preflight: {
    match: { isDeleted: false, chairId: { $type: "objectId" } },
    groupKey: "$chairId",
  },
};

const CHAIR_CODE_INDEX = {
  model: Chair,
  keys: { salonId: 1, chairCode: 1 },
  options: {
    unique: true,
    partialFilterExpression: { chairCode: { $type: "string" }, isDeleted: false },
    name: "salonId_1_chairCode_1",
  },
  preflight: {
    match: { isDeleted: false, chairCode: { $type: "string" } },
    groupKey: { salonId: "$salonId", chairCode: "$chairCode" },
  },
};

const TARGETS = [
  { label: "Staff phone (salonId+phone)", def: STAFF_PHONE_INDEX },
  { label: "Staff chair assignment (chairId)", def: STAFF_CHAIR_INDEX },
  { label: "Chair code (salonId+chairCode)", def: CHAIR_CODE_INDEX },
];

//////////////////////////////////////////////////////////////
// PREFLIGHT — reports conflicts, changes nothing. Run for ALL
// three targets before touching any index (step 7 of the approved
// scope: abort before creating ANY index if ANY scan finds a
// conflict).
//////////////////////////////////////////////////////////////
const runPreflight = async ({ label, def }) => {
  const conflicts = await def.model.collection.aggregate([
    { $match: def.preflight.match },
    { $group: { _id: def.preflight.groupKey, count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (conflicts.length === 0) {
    console.log(`✅ Preflight clean: ${label} — no conflicting documents found.`);
    return { label, clean: true, conflicts: [] };
  }

  console.error(`❌ Preflight CONFLICT: ${label} — ${conflicts.length} duplicate group(s) found:`);
  for (const c of conflicts) {
    console.error(`   key=${JSON.stringify(c._id)} count=${c.count} ids=${JSON.stringify(c.ids.map(String))}`);
  }
  return { label, clean: false, conflicts };
};

//////////////////////////////////////////////////////////////
// IDEMPOTENT INDEX CREATOR — same pattern as 00_createIndexes.js's
// createIndexSafe, extended to also detect a NAME collision against
// a DIFFERENT key pattern/options (which this script refuses to
// touch — no automatic drop/rebuild, per the approved scope).
//////////////////////////////////////////////////////////////
const createIndexSafe = async ({ label, def }) => {
  const existing = await def.model.collection.indexes();
  const sameName = existing.find((idx) => idx.name === def.options.name);

  if (sameName) {
    const sameKeys = JSON.stringify(sameName.key) === JSON.stringify(def.keys);
    const samePartial = JSON.stringify(sameName.partialFilterExpression || null) === JSON.stringify(def.options.partialFilterExpression || null);
    if (sameKeys && samePartial) {
      console.log(`⚠️  Skip: ${label} — index '${def.options.name}' already exists with the corrected definition.`);
      return { label, action: "skipped-already-correct" };
    }
    console.error(`❌ BLOCKED: ${label} — an index named '${def.options.name}' already exists with a DIFFERENT definition.`);
    console.error(`   Existing key: ${JSON.stringify(sameName.key)}, partialFilterExpression: ${JSON.stringify(sameName.partialFilterExpression || null)}`);
    console.error(`   This migration never drops or rebuilds an existing index automatically. Resolve manually.`);
    return { label, action: "blocked-name-conflict" };
  }

  await def.model.collection.createIndex(def.keys, def.options);
  console.log(`✅ Created: ${label} — index '${def.options.name}'.`);
  return { label, action: "created" };
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN RUNNER
//////////////////////////////////////////////////////////////
const run = async () => {
  try {
    await connectDB();

    console.log("\n🚀 Staff/Chair index repair — preflight phase (read-only, changes nothing)...");
    const preflightResults = await Promise.all(TARGETS.map(runPreflight));
    const anyConflict = preflightResults.some((r) => !r.clean);

    if (anyConflict) {
      console.error("\n❌ ABORTED: one or more preflight scans found conflicting documents.");
      console.error("   NO index was created. NO document was changed.");
      console.error("   Resolve the conflicts listed above (manually), then re-run this script.");
      process.exit(1);
    }

    console.log("\n✅ All preflight scans clean. Proceeding to build indexes, one at a time...\n");

    const results = [];
    for (const target of TARGETS) {
      results.push(await createIndexSafe(target));
    }

    const blocked = results.filter((r) => r.action === "blocked-name-conflict");
    if (blocked.length > 0) {
      console.error(`\n❌ ${blocked.length} of 3 index operation(s) blocked by a pre-existing name conflict — see above. Exiting non-zero.`);
      process.exit(1);
    }

    console.log("\n📦 FINAL STATE:");
    for (const target of TARGETS) {
      const indexes = await target.def.model.collection.indexes();
      const match = indexes.find((i) => i.name === target.def.options.name);
      console.log(`   • ${target.label}: ${match ? "present" : "MISSING"} (${target.def.options.name})`);
    }

    console.log("\n✅ Staff/Chair index repair complete.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  }
};

run();
