/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyPlatformFeeGstPolicyFoundation.mjs
 *
 * PLATFORM-FEE GST FOUNDATION — Phase 1 focused tests (additive,
 * 2026-10-12). Verifies the new, optional `platformFeeGstRatePercent`
 * field on GstPolicyVersion and its decoupled resolution in
 * services/gstPolicy.service.js#getPublishedGstPolicy, without
 * touching the real project database in any way.
 *
 * SAFE/LOCAL BY CONSTRUCTION: uses `mongodb-memory-server` (an
 * existing devDependency, already used by several scripts under
 * scripts/e2e/, e.g. verifyFieldAgentGeographyModel.js) to spin up a
 * genuinely ephemeral, in-process, network-isolated MongoDB instance.
 * Uses MongoMemoryReplSet (not the plain single-node MongoMemoryServer)
 * because publishGstPolicy() uses a real multi-document transaction
 * (session.startTransaction()), which MongoDB only allows on a
 * replica set — a single standalone mongod rejects it outright
 * ("Transaction numbers are only allowed on a replica set member").
 * This NEVER reads MONGODB_URI/TEST_MONGODB_URI, never contacts
 * Atlas or any remote host, and the instance is destroyed at the end
 * of this run — it is not "the database" in any sense that matters
 * for data safety, only a disposable local validation layer for
 * Mongoose schema/service behavior that cannot be meaningfully
 * exercised as pure in-memory JS (required/min/max field validation,
 * the partial-unique "at most one PUBLISHED" index).
 *
 * Covers exactly the five focused checks requested for this phase:
 *   1. Existing two-rate GST policy continues to work unchanged.
 *   2. A legacy-shaped PUBLISHED policy without platformFeeGstRatePercent
 *      still resolves service GST correctly.
 *   3. A missing/invalid platform-fee GST rate does not disable
 *      service GST (and vice versa — tested for completeness).
 *   4. A valid new rate is created/published/resolved through the
 *      existing Draft -> Publish workflow.
 *   5. The broader existing lifecycle (create -> publish -> retire,
 *      "at most one PUBLISHED" uniqueness) still passes.
 *
 * Run:  cd backend && node scripts/unit/verifyPlatformFeeGstPolicyFoundation.mjs
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const run = async () => {
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "gst_policy_foundation_unit" });

  // Imported AFTER connect so the model registers against this
  // isolated connection's default mongoose instance.
  const GstPolicyVersion = (await import("../../models/GstPolicyVersion.js")).default;
  const {
    createDraftGstPolicy,
    updateDraftGstPolicy,
    publishGstPolicy,
    retireGstPolicy,
    getPublishedGstPolicy,
    clearGstPolicyCache,
  } = await import("../../services/gstPolicy.service.js");

  const adminId = new mongoose.Types.ObjectId();

  try {
    // ════════════════════════════════════════════════════════════
    // 1. Existing two-rate GST policy continues to work unchanged —
    //    create + publish via the SAME service calls as before,
    //    never passing platformFeeGstRatePercent at all.
    // ════════════════════════════════════════════════════════════
    clearGstPolicyCache();
    const v1 = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0 });
    check("1a. Draft created without platformFeeGstRatePercent (field simply absent)", v1.platformFeeGstRatePercent === undefined, v1.platformFeeGstRatePercent);
    check("1b. Draft status is DRAFT", v1.status === "DRAFT");

    await publishGstPolicy({ versionId: v1._id, adminId });
    const resolved1 = await getPublishedGstPolicy();
    check("1c. Service GST resolves correctly (registered=5)", resolved1?.registeredRatePercent === 5, resolved1);
    check("1d. Service GST resolves correctly (unregistered=0)", resolved1?.unregisteredRatePercent === 0, resolved1);
    check("1e. platformFeeGstRatePercent resolves to null when never set", resolved1?.platformFeeGstRatePercent === null, resolved1);
    check("1f. versionId is present on the resolved policy", String(resolved1?.versionId) === String(v1._id));

    // ════════════════════════════════════════════════════════════
    // 2. Legacy-shaped PUBLISHED policy (simulating a document that
    //    predates this field) still resolves service GST correctly.
    //    Inserted directly, bypassing the service, to faithfully
    //    reproduce "already published before this phase existed".
    // ════════════════════════════════════════════════════════════
    clearGstPolicyCache();
    await GstPolicyVersion.deleteMany({});
    const legacyDoc = await GstPolicyVersion.create({
      registeredRatePercent: 5,
      unregisteredRatePercent: 0,
      status: "PUBLISHED",
      createdBy: adminId,
      publishedBy: adminId,
      publishedAt: new Date(),
    });
    check("2a. Legacy-shaped doc has no platformFeeGstRatePercent key", legacyDoc.platformFeeGstRatePercent === undefined);
    const resolved2 = await getPublishedGstPolicy();
    check("2b. Legacy-shaped PUBLISHED policy still resolves service GST (registered=5/unregistered=0)", resolved2?.registeredRatePercent === 5 && resolved2?.unregisteredRatePercent === 0, resolved2);
    check("2c. platformFeeGstRatePercent resolves to null for the legacy-shaped doc (not undefined, not a crash)", resolved2?.platformFeeGstRatePercent === null, resolved2);

    // ════════════════════════════════════════════════════════════
    // 3. Missing/invalid platform-fee GST rate does not disable
    //    service GST — explicit null, and (separately) a policy
    //    missing the two service rates must not be rescued by a
    //    present fee rate either (the two checks stay independent
    //    in both directions).
    // ════════════════════════════════════════════════════════════
    clearGstPolicyCache();
    await GstPolicyVersion.deleteMany({});
    await GstPolicyVersion.create({
      registeredRatePercent: 5,
      unregisteredRatePercent: 0,
      platformFeeGstRatePercent: null,
      status: "PUBLISHED",
      createdBy: adminId,
      publishedBy: adminId,
      publishedAt: new Date(),
    });
    const resolved3 = await getPublishedGstPolicy();
    check("3a. Explicit null platformFeeGstRatePercent does not disable service GST", resolved3?.registeredRatePercent === 5 && resolved3?.unregisteredRatePercent === 0, resolved3);
    check("3b. platformFeeGstRatePercent itself resolves to null", resolved3?.platformFeeGstRatePercent === null, resolved3);

    // Inverse direction: a doc with ONLY a fee rate and no valid two
    // service rates (simulating a hypothetical corrupt/legacy row)
    // must resolve the WHOLE policy as null — service GST was never
    // "rescued" by the presence of an unrelated fee rate, matching
    // the pre-existing "no usable GST policy" semantics exactly.
    clearGstPolicyCache();
    await GstPolicyVersion.deleteMany({});
    await GstPolicyVersion.collection.insertOne({
      // Raw insert, bypassing Mongoose validation entirely, to
      // reproduce a row that could never be created through the
      // service/validator layer but could theoretically already
      // exist from some other write path.
      platformFeeGstRatePercent: 18,
      status: "PUBLISHED",
      createdBy: adminId,
      publishedAt: new Date(),
    });
    const resolved3b = await getPublishedGstPolicy();
    check("3c. A PUBLISHED doc missing BOTH service-GST rates still resolves the whole policy as null (fee rate alone never substitutes for service GST)", resolved3b === null, resolved3b);

    // ════════════════════════════════════════════════════════════
    // 4. Valid new rate is created/published/resolved through the
    //    EXISTING Draft -> Publish workflow (no new workflow).
    // ════════════════════════════════════════════════════════════
    clearGstPolicyCache();
    await GstPolicyVersion.deleteMany({});
    const v4 = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    check("4a. Draft created with a valid platformFeeGstRatePercent", v4.platformFeeGstRatePercent === 18, v4.platformFeeGstRatePercent);

    await publishGstPolicy({ versionId: v4._id, adminId });
    const resolved4 = await getPublishedGstPolicy();
    check("4b. Published policy resolves platformFeeGstRatePercent correctly", resolved4?.platformFeeGstRatePercent === 18, resolved4);
    check("4c. Service GST still resolves correctly alongside the new rate", resolved4?.registeredRatePercent === 5 && resolved4?.unregisteredRatePercent === 0, resolved4);

    // Schema-level range validation on the new field (min 0 / max 100),
    // same discipline as the two existing rates.
    let rejectedOutOfRange = false;
    try {
      await GstPolicyVersion.create({ registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 150, createdBy: adminId });
    } catch { rejectedOutOfRange = true; }
    check("4d. platformFeeGstRatePercent=150 is rejected by schema validation (min/max enforced, same as the existing two rates)", rejectedOutOfRange);

    // updateDraftGstPolicy can set, and separately clear, the field.
    clearGstPolicyCache();
    const v4b = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0 });
    await updateDraftGstPolicy({ versionId: v4b._id, adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 12 });
    const afterSet = await GstPolicyVersion.findById(v4b._id);
    check("4e. updateDraftGstPolicy sets platformFeeGstRatePercent when provided", afterSet.platformFeeGstRatePercent === 12, afterSet.platformFeeGstRatePercent);
    await updateDraftGstPolicy({ versionId: v4b._id, adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: null });
    const afterClear = await GstPolicyVersion.findById(v4b._id);
    check("4f. updateDraftGstPolicy clears platformFeeGstRatePercent back to null when explicitly passed null", afterClear.platformFeeGstRatePercent === null, afterClear.platformFeeGstRatePercent);
    await updateDraftGstPolicy({ versionId: v4b._id, adminId, registeredRatePercent: 7, unregisteredRatePercent: 1 });
    const afterOmit = await GstPolicyVersion.findById(v4b._id);
    check("4g. updateDraftGstPolicy leaves platformFeeGstRatePercent untouched when the caller omits it (undefined, not null)", afterOmit.platformFeeGstRatePercent === null && afterOmit.registeredRatePercent === 7, afterOmit.platformFeeGstRatePercent);

    // ════════════════════════════════════════════════════════════
    // 5. Existing GST policy lifecycle/behavior remains passing —
    //    publish retires the prior PUBLISHED doc; retire leaves no
    //    policy active; "at most one PUBLISHED" is still enforced.
    // ════════════════════════════════════════════════════════════
    clearGstPolicyCache();
    await GstPolicyVersion.deleteMany({});
    const vA = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0 });
    await publishGstPolicy({ versionId: vA._id, adminId });

    const vB = await createDraftGstPolicy({ adminId, registeredRatePercent: 12, unregisteredRatePercent: 2, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: vB._id, adminId });

    const vAAfter = await GstPolicyVersion.findById(vA._id);
    check("5a. Publishing a new version retires the previously-PUBLISHED one", vAAfter.status === "RETIRED", vAAfter.status);

    const resolved5 = await getPublishedGstPolicy();
    check("5b. Resolver now returns the newest published version's rates (service + fee)", resolved5?.registeredRatePercent === 12 && resolved5?.unregisteredRatePercent === 2 && resolved5?.platformFeeGstRatePercent === 18, resolved5);

    let uniqueRejected = false;
    try {
      await GstPolicyVersion.collection.insertOne({ registeredRatePercent: 1, unregisteredRatePercent: 1, status: "PUBLISHED", createdBy: adminId });
    } catch { uniqueRejected = true; }
    check('5c. "At most one PUBLISHED" partial-unique index still enforced', uniqueRejected);

    await retireGstPolicy({ versionId: vB._id, adminId });
    clearGstPolicyCache();
    const resolved6 = await getPublishedGstPolicy();
    check("5d. After retiring the only PUBLISHED policy, resolver returns null (no policy active, never blocks a booking)", resolved6 === null, resolved6);

  } finally {
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nPLATFORM-FEE GST POLICY FOUNDATION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err);
  process.exit(1);
});
