/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentSecurityPhaseB.js
 *
 * FA-15 Phase B — permanent regression suite for the three additive
 * scale/index hardening changes: AcquisitionClaim {createdAt:-1},
 * FieldAgentComplianceCase {createdAt:-1}, FieldAgentComplianceEvidence
 * {reportedAt:-1}. Verifies BOTH the Mongoose schema declaration AND
 * the actual live MongoDB index (via the raw driver's .indexes()),
 * plus a real explain() proving the exact admin-list query shape
 * (empty filter, sorted by the new index's field) uses an index scan
 * with no separate in-memory sort stage — never a fabricated claim.
 *
 * Purely additive/read-only against the database: relies on Mongoose's
 * existing autoIndex:true (config/db.js) to create the newly-declared
 * indexes as a side effect of connecting — the same mechanism already
 * used for every other index in this project, including FA-14's own
 * prior {createdAt:-1} fix on FieldAgentPayoutRequest. No index is
 * dropped, renamed, or altered; no document is created or mutated.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentSecurityPhaseB.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import FieldAgentComplianceCase from "../modules/fieldAgent/models/FieldAgentComplianceCase.js";
import FieldAgentComplianceEvidence from "../modules/fieldAgent/models/FieldAgentComplianceEvidence.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

// Exact field spec match — order and direction matter for an index to
// serve a given sort; a loose "contains the field" check would be a
// false positive.
const keysEqual = (key, expected) => JSON.stringify(key) === JSON.stringify(expected);

const run = async () => {
  await connectDB();

  try {
    // autoIndex:true (config/db.js) schedules index creation in the
    // background per model — it is NOT guaranteed complete just
    // because connectDB() has resolved (confirmed directly: a first
    // run of this exact script without this step found the schema
    // declaration present but the live index genuinely absent).
    // Model.init() is Mongoose's own standard method for this — it
    // returns a promise that resolves only once the model's indexes
    // are confirmed built, which is what makes the live-index checks
    // below deterministic rather than racy.
    await Promise.all([AcquisitionClaim.init(), FieldAgentComplianceCase.init(), FieldAgentComplianceEvidence.init()]);

    // ═══════════════════════════════════════════════════════════
    // SCHEMA-LEVEL DECLARATION CHECK
    // ═══════════════════════════════════════════════════════════
    const schemaHasIndex = (Model, expectedKey) =>
      Model.schema.indexes().some(([key]) => keysEqual(key, expectedKey));

    check("B1a. AcquisitionClaim schema declares {createdAt:-1}", schemaHasIndex(AcquisitionClaim, { createdAt: -1 }));
    check("B2a. FieldAgentComplianceCase schema declares {createdAt:-1}", schemaHasIndex(FieldAgentComplianceCase, { createdAt: -1 }));
    check("B3a. FieldAgentComplianceEvidence schema declares {reportedAt:-1}", schemaHasIndex(FieldAgentComplianceEvidence, { reportedAt: -1 }));

    // ═══════════════════════════════════════════════════════════
    // LIVE MONGODB INDEX CHECK — the actual, deployed index, not
    // just the schema's intent. autoIndex:true (config/db.js) already
    // created these as a side effect of the connectDB() call above +
    // these models being compiled/used, exactly like every other
    // index in this project.
    // ═══════════════════════════════════════════════════════════
    const getLiveIndexes = async (collectionName) => mongoose.connection.db.collection(collectionName).indexes();

    const claimIndexes = await getLiveIndexes(AcquisitionClaim.collection.name);
    const caseIndexes = await getLiveIndexes(FieldAgentComplianceCase.collection.name);
    const evidenceIndexes = await getLiveIndexes(FieldAgentComplianceEvidence.collection.name);

    const claimCreatedAtIdx = claimIndexes.find((i) => keysEqual(i.key, { createdAt: -1 }));
    const caseCreatedAtIdx = caseIndexes.find((i) => keysEqual(i.key, { createdAt: -1 }));
    const evidenceReportedAtIdx = evidenceIndexes.find((i) => keysEqual(i.key, { reportedAt: -1 }));

    check("B1b. AcquisitionClaim LIVE MongoDB index {createdAt:-1} exists", !!claimCreatedAtIdx, claimIndexes.map((i) => i.name));
    check("B2b. FieldAgentComplianceCase LIVE MongoDB index {createdAt:-1} exists", !!caseCreatedAtIdx, caseIndexes.map((i) => i.name));
    check("B3b. FieldAgentComplianceEvidence LIVE MongoDB index {reportedAt:-1} exists", !!evidenceReportedAtIdx, evidenceIndexes.map((i) => i.name));

    // ═══════════════════════════════════════════════════════════
    // B4 — NO DUPLICATE EQUIVALENT INDEX
    // Exactly one index per collection should have this exact
    // single-field key spec (the new one) — not two.
    // ═══════════════════════════════════════════════════════════
    check("B4a. Exactly one {createdAt:-1}-keyed index on AcquisitionClaim (no duplicate)", claimIndexes.filter((i) => keysEqual(i.key, { createdAt: -1 })).length === 1);
    check("B4b. Exactly one {createdAt:-1}-keyed index on FieldAgentComplianceCase (no duplicate)", caseIndexes.filter((i) => keysEqual(i.key, { createdAt: -1 })).length === 1);
    check("B4c. Exactly one {reportedAt:-1}-keyed index on FieldAgentComplianceEvidence (no duplicate)", evidenceIndexes.filter((i) => keysEqual(i.key, { reportedAt: -1 })).length === 1);

    // ═══════════════════════════════════════════════════════════
    // B6 — EXISTING IMPORTANT INDEXES REMAIN PRESENT/UNCHANGED
    // Specifically the unique/partial correctness-critical ones —
    // these must never be dropped, renamed, or altered by an
    // additive-only change.
    // ═══════════════════════════════════════════════════════════
    const claimSalonStatusUnique = claimIndexes.find((i) => keysEqual(i.key, { salonRef: 1, status: 1 }));
    check("B6a. AcquisitionClaim's {salonRef,status} unique partial (one-ACTIVE-claim rule) is untouched", claimSalonStatusUnique?.unique === true && !!claimSalonStatusUnique?.partialFilterExpression, claimSalonStatusUnique);

    const caseCategoryUnique = caseIndexes.find((i) => keysEqual(i.key, { fieldAgentRef: 1, category: 1 }));
    check("B6b. FieldAgentComplianceCase's {fieldAgentRef,category} unique partial (one-ACTIVE-case rule) is untouched", caseCategoryUnique?.unique === true && !!caseCategoryUnique?.partialFilterExpression, caseCategoryUnique);

    const evidenceDedupeUnique = evidenceIndexes.find((i) => keysEqual(i.key, { dedupeKey: 1 }));
    check("B6c. FieldAgentComplianceEvidence's {dedupeKey} unique sparse index is untouched", evidenceDedupeUnique?.unique === true && evidenceDedupeUnique?.sparse === true, evidenceDedupeUnique);

    check("B6d. AcquisitionClaim pre-existing {status,createdAt} index still present", claimIndexes.some((i) => keysEqual(i.key, { status: 1, createdAt: -1 })));
    check("B6e. FieldAgentComplianceCase pre-existing {status,createdAt} index still present", caseIndexes.some((i) => keysEqual(i.key, { status: 1, createdAt: -1 })));
    check("B6f. FieldAgentComplianceEvidence pre-existing {fieldAgentRef,reportedAt} index still present", evidenceIndexes.some((i) => keysEqual(i.key, { fieldAgentRef: 1, reportedAt: -1 })));

    // ═══════════════════════════════════════════════════════════
    // B5 — REAL explain() ON THE EXACT ADMIN QUERY SHAPE
    // (empty filter, sorted by the new index's field — the real
    // INDIA-admin-no-filter case from acquisitionClaim.service.js /
    // complianceCase.service.js / complianceEvidence.service.js).
    // Real MongoDB explain, never fabricated.
    // ═══════════════════════════════════════════════════════════
    {
      const explainResult = await AcquisitionClaim.collection.find({}).sort({ createdAt: -1 }).explain("executionStats");
      const winningPlan = explainResult.queryPlanner.winningPlan;
      const stageStr = JSON.stringify(winningPlan);
      check("B5a. AcquisitionClaim admin-list query (no filter, sort createdAt) uses an IXSCAN", stageStr.includes("IXSCAN"), winningPlan);
      check("B5a. AcquisitionClaim admin-list query has no separate in-memory SORT stage", !stageStr.includes('"stage":"SORT"'), winningPlan);
    }
    {
      const explainResult = await FieldAgentComplianceCase.collection.find({}).sort({ createdAt: -1 }).explain("executionStats");
      const winningPlan = explainResult.queryPlanner.winningPlan;
      const stageStr = JSON.stringify(winningPlan);
      check("B5b. FieldAgentComplianceCase admin-list query (no filter, sort createdAt) uses an IXSCAN", stageStr.includes("IXSCAN"), winningPlan);
      check("B5b. FieldAgentComplianceCase admin-list query has no separate in-memory SORT stage", !stageStr.includes('"stage":"SORT"'), winningPlan);
    }
    {
      const explainResult = await FieldAgentComplianceEvidence.collection.find({}).sort({ reportedAt: -1 }).explain("executionStats");
      const winningPlan = explainResult.queryPlanner.winningPlan;
      const stageStr = JSON.stringify(winningPlan);
      check("B5c. FieldAgentComplianceEvidence admin-list query (no filter, sort reportedAt) uses an IXSCAN", stageStr.includes("IXSCAN"), winningPlan);
      check("B5c. FieldAgentComplianceEvidence admin-list query has no separate in-memory SORT stage", !stageStr.includes('"stage":"SORT"'), winningPlan);
    }
  } catch (err) {
    console.error("FATAL ERROR DURING TEST RUN:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    await mongoose.disconnect();
  }

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)\n`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
