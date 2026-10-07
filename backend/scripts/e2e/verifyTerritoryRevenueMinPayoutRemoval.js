/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyTerritoryRevenueMinPayoutRemoval.js
 *
 * TERRITORY PARTNER — Minimum Payout removal from the Admin UI,
 * verification. The actual change is admin-panel-only
 * (TerritoryRevenuePage.jsx / TerritoryRevenueHistoryPage.jsx — no
 * backend file touched). This script exercises the REAL, unmodified
 * backend service functions with the EXACT payload shape the updated
 * handleCreateDraft/handleSaveEdit now submit — createDraft silently
 * sending minimumPayout: 0, updateDraft never sending it at all —
 * proving the existing, unmodified contract still accepts both.
 *
 * SAFETY: aborts immediately if any PUBLISHED TerritoryRevenueSettings
 * already exists — never publishes/retires a real admin's live policy.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyTerritoryRevenueMinPayoutRemoval.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import TerritoryRevenueSettings from "../../modules/finance/models/TerritoryRevenueSettings.js";
import TerritoryRevenueSplit from "../../modules/finance/models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../../modules/finance/models/TerritoryRevenueLedger.js";
import {
  createDraftTerritoryRevenueSettings,
  updateDraftTerritoryRevenueSettings,
  publishTerritoryRevenueSettings,
  retireTerritoryRevenueSettings,
  listTerritoryRevenueSettings,
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
      throw new Error(`SAFETY ABORT: ${preExistingPublished} PUBLISHED TerritoryRevenueSettings document(s) already exist — refusing to run (would not retire/overwrite it, but aborting to be certain).`);
    }
    results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

    // ═══════════════════════════════════════════════════════════
    // TEST 1 — exact createDraft payload the new handleCreateDraft
    // sends: only territoryCommissionPercent is admin-entered;
    // minimumPayout is the fixed structural placeholder (0), never
    // admin-entered, never displayed.
    // ═══════════════════════════════════════════════════════════
    const enteredPercent = 14.25; // arbitrary, not a round/example number
    const draft1 = await createDraftTerritoryRevenueSettings({
      adminId,
      territoryCommissionPercent: enteredPercent,
      minimumPayoutInPaise: 0, // structural placeholder, matches controller's rupeesToPaise(0)
    });
    createdIds.push(draft1._id);
    check("1. Draft created, status DRAFT", draft1.status === "DRAFT", draft1.status);
    check("2. territoryCommissionPercent === entered value (14.25), not hardcoded", draft1.territoryCommissionPercent === enteredPercent, draft1.territoryCommissionPercent);
    check("3. minimumPayoutInPaise persisted as 0 (the structural placeholder, not invented)", draft1.minimumPayoutInPaise === 0, draft1.minimumPayoutInPaise);

    // ═══════════════════════════════════════════════════════════
    // TEST 2 — exact updateDraft payload the new handleSaveEdit
    // sends: ONLY territoryCommissionPercent, minimumPayoutInPaise
    // omitted entirely (undefined) — confirms the backend's own
    // updateDraft still accepts the commission field alone.
    // ═══════════════════════════════════════════════════════════
    const edited1 = await updateDraftTerritoryRevenueSettings({
      versionId: draft1._id,
      adminId,
      territoryCommissionPercent: 9.5,
      minimumPayoutInPaise: undefined,
    });
    check("4. Edited draft reflects new commission (9.5%) with minimumPayout untouched", edited1.territoryCommissionPercent === 9.5 && edited1.minimumPayoutInPaise === 0, edited1);

    // ═══════════════════════════════════════════════════════════
    // TEST 3 — PUBLISH lifecycle remains intact.
    // ═══════════════════════════════════════════════════════════
    const published1 = await publishTerritoryRevenueSettings({ versionId: draft1._id, adminId });
    check("5. Publish succeeds, status PUBLISHED", published1.status === "PUBLISHED", published1.status);
    const publishedCount = await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" });
    check("6. Exactly one PUBLISHED policy exists", publishedCount === 1, publishedCount);

    // ═══════════════════════════════════════════════════════════
    // TEST 4 — HISTORY list still returns the version; minimumPayoutInPaise
    // still exists on the raw document (untouched schema) even though
    // the UI no longer renders it.
    // ═══════════════════════════════════════════════════════════
    const allVersions = await listTerritoryRevenueSettings({ page: 1, limit: 100 });
    check("7. listTerritoryRevenueSettings (the History page's own API) returns the version", allVersions.length === 1, allVersions.length);
    check("8. The returned version still carries minimumPayoutInPaise=0 on the raw document (schema untouched, just not rendered)", allVersions[0]?.minimumPayoutInPaise === 0, allVersions[0]);

    // ═══════════════════════════════════════════════════════════
    // TEST 5 — SIDE EFFECT SAFETY.
    // ═══════════════════════════════════════════════════════════
    const splitCountAfter = await TerritoryRevenueSplit.countDocuments({});
    const ledgerCountAfter = await TerritoryRevenueLedger.countDocuments({});
    check("9. Zero TerritoryRevenueSplit rows created", splitCountAfter === before.TerritoryRevenueSplit, { before: before.TerritoryRevenueSplit, after: splitCountAfter });
    check("10. Zero TerritoryRevenueLedger rows created", ledgerCountAfter === before.TerritoryRevenueLedger, { before: before.TerritoryRevenueLedger, after: ledgerCountAfter });

    // ═══════════════════════════════════════════════════════════
    // TEST 6 — RETIRE (this script's own disposable policy only).
    // ═══════════════════════════════════════════════════════════
    const retired1 = await retireTerritoryRevenueSettings({ versionId: draft1._id, adminId });
    check("11. Retire succeeds, status RETIRED", retired1.status === "RETIRED", retired1.status);

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
    check("12. All counts returned exactly to their BEFORE values", JSON.stringify(before) === JSON.stringify(after), { before, after });
  } catch (err) {
    console.error("FATAL ERROR DURING TERRITORY REVENUE MIN-PAYOUT-REMOVAL E2E:", err);
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
  console.log(`\nTERRITORY-REVENUE-MIN-PAYOUT-REMOVAL-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
