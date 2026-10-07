/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyTerritoryRevenueUxPhase1.js
 *
 * TERRITORY PARTNER — PHASE 1 (Admin UX standardization) verification.
 * The actual change is admin-panel-only (TerritoryRevenuePage.jsx +
 * new TerritoryRevenueHistoryPage.jsx — no new backend endpoint, no
 * schema change). This script exercises the REAL, unmodified backend
 * service functions (createDraftTerritoryRevenueSettings /
 * publishTerritoryRevenueSettings / retireTerritoryRevenueSettings /
 * listTerritoryRevenueSettings) with the exact payload shape the new
 * UI now submits, proving the real contract end-to-end.
 *
 * SAFETY: aborts immediately if any PUBLISHED TerritoryRevenueSettings
 * already exists — never publishes/retires a real admin's live policy.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyTerritoryRevenueUxPhase1.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import TerritoryRevenueSettings from "../../modules/finance/models/TerritoryRevenueSettings.js";
import TerritoryRevenueSplit from "../../modules/finance/models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../../modules/finance/models/TerritoryRevenueLedger.js";
import {
  createDraftTerritoryRevenueSettings,
  listTerritoryRevenueSettings,
  publishTerritoryRevenueSettings,
  updateDraftTerritoryRevenueSettings,
  retireTerritoryRevenueSettings,
} from "../../modules/finance/services/TerritoryRevenueSettingsService.js";
import { oid } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = [];

const run = async () => {
  await connectDB();
  const adminId = oid();

  try {
    const preExistingPublished = await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" });
    const before = {
      TerritoryRevenueSettings: await TerritoryRevenueSettings.countDocuments({}),
      TerritoryRevenueSettingsPublished: preExistingPublished,
      TerritoryRevenueSplit: await TerritoryRevenueSplit.countDocuments({}),
      TerritoryRevenueLedger: await TerritoryRevenueLedger.countDocuments({}),
    };
    if (preExistingPublished !== 0) {
      throw new Error(`SAFETY ABORT: ${preExistingPublished} PUBLISHED TerritoryRevenueSettings document(s) already exist — refusing to run.`);
    }
    results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

    // ═══════════════════════════════════════════════════════════
    // TEST A — FIRST POLICY (exact payload shape handleCreateDraft
    // submits: deliberately non-round numbers, proving nothing in the
    // new UI is hardcoded).
    // ═══════════════════════════════════════════════════════════
    const draft1 = await createDraftTerritoryRevenueSettings({
      adminId,
      territoryCommissionPercent: 17.5,
      minimumPayoutInPaise: 34500, // ₹345
    });
    createdIds.push(draft1._id);
    check("A1. Draft created, status DRAFT, version 1", draft1.status === "DRAFT" && draft1.version === 1, draft1);
    check("A2. territoryCommissionPercent === entered value (17.5), not hardcoded", draft1.territoryCommissionPercent === 17.5, draft1.territoryCommissionPercent);
    check("A3. minimumPayoutInPaise === entered value (34500), not hardcoded", draft1.minimumPayoutInPaise === 34500, draft1.minimumPayoutInPaise);

    // ═══════════════════════════════════════════════════════════
    // TEST B — EDIT DRAFT (the page's "EDIT" / SAVE DRAFT action).
    // ═══════════════════════════════════════════════════════════
    const edited1 = await updateDraftTerritoryRevenueSettings({
      versionId: draft1._id,
      adminId,
      territoryCommissionPercent: 20,
      minimumPayoutInPaise: 50000,
    });
    check("B1. Edited draft reflects new values (20%, ₹500)", edited1.territoryCommissionPercent === 20 && edited1.minimumPayoutInPaise === 50000, edited1);
    check("B2. Still DRAFT, still version 1 (edit never bumps version)", edited1.status === "DRAFT" && edited1.version === 1, edited1);

    // ═══════════════════════════════════════════════════════════
    // TEST C — PUBLISH.
    // ═══════════════════════════════════════════════════════════
    const published1 = await publishTerritoryRevenueSettings({ versionId: draft1._id, adminId });
    check("C1. Publish succeeds, status PUBLISHED", published1.status === "PUBLISHED", published1.status);
    const publishedCount = await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" });
    check("C2. Exactly one PUBLISHED policy exists", publishedCount === 1, publishedCount);

    // ═══════════════════════════════════════════════════════════
    // TEST E — SECOND POLICY + HISTORY. Publishing V2 must retire V1
    // (never delete), and listTerritoryRevenueSettings must return
    // BOTH, exactly as the new History page now renders.
    // ═══════════════════════════════════════════════════════════
    const draft2 = await createDraftTerritoryRevenueSettings({
      adminId,
      territoryCommissionPercent: 12,
      minimumPayoutInPaise: 60000,
    });
    createdIds.push(draft2._id);
    check("E1. Second draft is version 2", draft2.version === 2, draft2.version);

    const published2 = await publishTerritoryRevenueSettings({ versionId: draft2._id, adminId });
    check("E2. V2 published successfully", published2.status === "PUBLISHED", published2.status);

    const v1AfterV2Publish = await TerritoryRevenueSettings.findById(draft1._id).lean();
    check("E3. V1 is now RETIRED (not deleted, not mutated otherwise)", v1AfterV2Publish?.status === "RETIRED" && v1AfterV2Publish?.territoryCommissionPercent === 20, v1AfterV2Publish);
    check("E4. V1's historical values remain exactly what was published (20%, ₹500) — never rewritten by V2's publish", v1AfterV2Publish?.territoryCommissionPercent === 20 && v1AfterV2Publish?.minimumPayoutInPaise === 50000, v1AfterV2Publish);

    const allVersions = await listTerritoryRevenueSettings({ page: 1, limit: 100 });
    check("E5. listTerritoryRevenueSettings (the History page's own API) returns BOTH versions", allVersions.length === 2, allVersions.length);
    const v1InList = allVersions.find((v) => String(v._id) === String(draft1._id));
    const v2InList = allVersions.find((v) => String(v._id) === String(draft2._id));
    check("E6. V1 appears in the list as RETIRED", v1InList?.status === "RETIRED", v1InList);
    check("E7. V2 appears in the list as PUBLISHED", v2InList?.status === "PUBLISHED", v2InList);

    // ═══════════════════════════════════════════════════════════
    // TEST F — SIDE EFFECT SAFETY. This is a UI-only standardization —
    // zero Territory Partner earning/assignment side effects.
    // ═══════════════════════════════════════════════════════════
    const splitCountAfter = await TerritoryRevenueSplit.countDocuments({});
    const ledgerCountAfter = await TerritoryRevenueLedger.countDocuments({});
    check("F1. Zero TerritoryRevenueSplit rows created by any of this", splitCountAfter === before.TerritoryRevenueSplit, { before: before.TerritoryRevenueSplit, after: splitCountAfter });
    check("F2. Zero TerritoryRevenueLedger rows created by any of this", ledgerCountAfter === before.TerritoryRevenueLedger, { before: before.TerritoryRevenueLedger, after: ledgerCountAfter });

    // ═══════════════════════════════════════════════════════════
    // TEST G — RETIRE (the main page's own RETIRE button action).
    // ═══════════════════════════════════════════════════════════
    const retired2 = await retireTerritoryRevenueSettings({ versionId: draft2._id, adminId });
    check("G1. V2 retired successfully, status RETIRED", retired2.status === "RETIRED", retired2.status);
    const publishedCountAfterRetire = await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" });
    check("G2. Zero PUBLISHED policies after retiring V2 (fails closed, same as other 3 Global Commercial Control pages)", publishedCountAfterRetire === 0, publishedCountAfterRetire);

    // ═══════════════════════════════════════════════════════════
    // CLEANUP — restore to exactly the pre-test state.
    // ═══════════════════════════════════════════════════════════
    await TerritoryRevenueSettings.deleteMany({ _id: { $in: createdIds } });

    const after = {
      TerritoryRevenueSettings: await TerritoryRevenueSettings.countDocuments({}),
      TerritoryRevenueSettingsPublished: await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" }),
      TerritoryRevenueSplit: await TerritoryRevenueSplit.countDocuments({}),
      TerritoryRevenueLedger: await TerritoryRevenueLedger.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts: ${JSON.stringify(after)}`);
    check("H1. All counts returned exactly to their BEFORE values", JSON.stringify(before) === JSON.stringify(after), { before, after });
  } catch (err) {
    console.error("FATAL ERROR DURING TERRITORY REVENUE UX PHASE 1 E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await TerritoryRevenueSettings.deleteMany({ _id: { $in: createdIds } });
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nTERRITORY-REVENUE-UX-PHASE1-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
