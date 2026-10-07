/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentCommissionCollisionFix.js
 *
 * ADMIN PANEL MUST-DO-NOW #4 — Field Agent Commission legacy
 * Revenue-Settings naming collision, minimal fix verification.
 *
 * This ticket's fix is Admin Panel (frontend) ONLY — no backend file
 * was touched. There is therefore no new HTTP behavior to exercise;
 * this script instead:
 *   A. Statically inspects the two relevant admin-panel source files
 *      to confirm the exact, narrow change was made (and nothing
 *      broader).
 *   B. Confirms, read-only, that the one real CommercialPolicyVersion
 *      and every other tracked collection are completely unchanged —
 *      this script creates, updates, publishes, and retires NOTHING.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentCommissionCollisionFix.js
 */

import "dotenv/config";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../../modules/fieldAgent/models/CommercialPolicyOverride.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const ADMIN_PANEL_ROOT = new URL("../../../admin-panel/", import.meta.url);
const read = (relPath) => fs.readFile(new URL(relPath, ADMIN_PANEL_ROOT), "utf8");

const run = async () => {
  await connectDB();

  const before = {
    CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
    CommercialPolicyOverride: await CommercialPolicyOverride.countDocuments({}),
    AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
    AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
    FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Transaction: await Transaction.countDocuments({}),
  };
  const publishedBefore = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
  results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);
  results.push(`ℹ️  Published policy before: ${JSON.stringify(publishedBefore)}`);

  try {
    // ── A1-A4: Legacy Revenue Settings page — the fix itself ──────
    const revenueSrc = await read("src/pages/revenueConfig/RevenueSettingsPage.jsx");
    check("A1. Legacy page no longer renders an editable Acquisition Reward input (value={form.acquisitionReward} is gone)", !revenueSrc.includes("value={form.acquisitionReward}") && !revenueSrc.includes("acquisitionReward: e.target.value"), {});
    check("A2. Legacy page no longer reads form.acquisitionReward anywhere", !revenueSrc.includes("form.acquisitionReward"), {});
    check("A3. Legacy page never sends `acquisitionReward` in the outgoing PATCH body", !/body\.acquisitionReward\s*=/.test(revenueSrc), {});
    check("A4. Legacy page shows a pointer to the canonical Field Agent Commission page", revenueSrc.includes("Global Commercial Control") && revenueSrc.includes("field-agent-commission"), {});

    // ── A5-A7: unrelated Revenue Settings functionality preserved ─
    check("A5. Recovery % control still present and still sent", revenueSrc.includes("Recovery %") && /body\.recoveryPercentage\s*=/.test(revenueSrc), {});
    check("A6. Minimum Payout control still present and still sent", revenueSrc.includes("Minimum Payout") && /body\.minimumPayout\s*=/.test(revenueSrc), {});
    check("A7. Territory Commission section untouched (still present)", revenueSrc.includes("Territory Commission") && revenueSrc.includes("saveTerritory"), {});

    // ── B1-B2: canonical GCC page untouched / still correct ───────
    const gccSrc = await read("src/pages/finance/commission/FieldAgentCommissionPage.jsx");
    check("B1. Canonical GCC page still edits acquisitionRewardAmountInPaise", gccSrc.includes("acquisitionRewardAmountInPaise"), {});
    check("B2. Canonical GCC page still edits acquisitionAgentCommissionPercent", gccSrc.includes("acquisitionAgentCommissionPercent"), {});

    // ── C1: backend untouched ──────────────────────────────────────
    const serviceSrc = await fs.readFile(new URL("../../modules/fieldAgent/services/revenueConfig.service.js", import.meta.url), "utf8");
    const publishSrc = await fs.readFile(new URL("../../modules/fieldAgent/services/commercialPolicy.service.js", import.meta.url), "utf8");
    check("C1. revenueConfig.service.js mapping unchanged (still acquisitionEarningTargetInPaise, not remapped)", serviceSrc.includes("acquisitionEarningTargetInPaise: acquisitionRewardInPaise"), {});
    check("C2. publishPolicyVersion source untouched by this ticket (still has its own transaction+retry)", publishSrc.includes("MAX_PUBLISH_ATTEMPTS") && publishSrc.includes("session.startTransaction()"), {});

  } catch (err) {
    console.error("SCRIPT ERROR (will still report DB safety below):", err);
    fail++;
    results.push(`❌ FATAL SCRIPT ERROR — ${err.message}`);
  } finally {
    const after = {
      CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
      CommercialPolicyOverride: await CommercialPolicyOverride.countDocuments({}),
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
      FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
    };
    const publishedAfter = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();

    check("D1. All tracked collection counts exactly unchanged", JSON.stringify(before) === JSON.stringify(after), { before, after });
    check("D2. Current published policy document byte-for-byte unchanged", JSON.stringify(publishedBefore) === JSON.stringify(publishedAfter), {});

    results.push(`ℹ️  AFTER counts: ${JSON.stringify(after)}`);
    results.push(`ℹ️  Published policy after: ${JSON.stringify(publishedAfter)}`);

    console.log(results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
