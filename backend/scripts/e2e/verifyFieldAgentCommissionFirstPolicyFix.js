/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentCommissionFirstPolicyFix.js
 *
 * FIELD AGENT GLOBAL CENTRE — FIRST POLICY CREATION FIX verification.
 *
 * The actual change is admin-panel-only (FieldAgentCommissionPage.jsx
 * — no new backend endpoint, no schema change). This script exercises
 * the REAL backend service functions (createDraftPolicyVersion /
 * publishPolicyVersion / retirePolicyVersion, all unmodified) with the
 * EXACT payload shape handleCreateDraft's two branches now construct,
 * so the real contract end-to-end (admin-entered values + disclosed
 * placeholders -> real document -> real publish) is proven, not just
 * the JSX.
 *
 * SAFETY (the Platform Fee incident lesson, never to be repeated):
 * aborts immediately if any PUBLISHED CommercialPolicyVersion already
 * exists — never publishes/retires a real admin's live policy.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentCommissionFirstPolicyFix.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../../modules/fieldAgent/models/CommercialPolicyOverride.js";
import TerritoryAssignment from "../../modules/fieldAgent/models/TerritoryAssignment.js";
import { createDraftPolicyVersion, publishPolicyVersion, retirePolicyVersion } from "../../modules/fieldAgent/services/commercialPolicy.service.js";
import { oid } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

// Mirrors FieldAgentCommissionPage.jsx's own constant exactly.
const FIRST_RUN_TERRITORY_PARTNER_PLACEHOLDERS = {
  territoryPartnerCommissionPercent: 20,
  licenseTermMonths: 36,
  claimExpiryDays: 30,
};
const r2p = (rupees) => Math.round(Number(rupees) * 100);

const createdPolicyIds = [];

const run = async () => {
  await connectDB();
  const adminId = oid();

  try {
    const preExistingPublished = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    const before = {
      CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
      CommercialPolicyVersionPublished: preExistingPublished,
      CommercialPolicyOverride: await CommercialPolicyOverride.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
    };
    if (preExistingPublished !== 0) {
      throw new Error(`SAFETY ABORT: ${preExistingPublished} PUBLISHED CommercialPolicyVersion document(s) already exist — refusing to run.`);
    }
    results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);
    check("SETUP. CommercialPolicyVersion count is 0 before this test", before.CommercialPolicyVersion === 0, before);

    // ═══════════════════════════════════════════════════════════
    // TEST A — FIRST POLICY. Admin enters a reward/commission that
    // are deliberately NOT 200/10 (proving nothing is hardcoded).
    // ═══════════════════════════════════════════════════════════
    const enteredRewardRupees = 317; // arbitrary, not ₹200
    const enteredCommissionPercent = 13.5; // arbitrary, not 10%

    // Exact payload shape handleCreateDraft's "no published" branch
    // constructs (see FieldAgentCommissionPage.jsx).
    const firstDraft = await createDraftPolicyVersion({
      adminId,
      acquisitionAgentCommissionPercent: enteredCommissionPercent,
      acquisitionRewardAmountInPaise: r2p(enteredRewardRupees),
      ...FIRST_RUN_TERRITORY_PARTNER_PLACEHOLDERS,
      acquisitionEarningTargetInPaise: r2p(enteredRewardRupees),
    });
    createdPolicyIds.push(firstDraft._id);

    check("A1. Draft created, status DRAFT", firstDraft.status === "DRAFT", firstDraft.status);
    check("A2. acquisitionRewardAmountInPaise === entered reward (not hardcoded ₹200)", firstDraft.acquisitionRewardAmountInPaise === r2p(enteredRewardRupees), firstDraft.acquisitionRewardAmountInPaise);
    check("A3. acquisitionAgentCommissionPercent === entered commission (not hardcoded 10%)", firstDraft.acquisitionAgentCommissionPercent === enteredCommissionPercent, firstDraft.acquisitionAgentCommissionPercent);
    check("A4. territoryPartnerCommissionPercent === 20 (disclosed placeholder)", firstDraft.territoryPartnerCommissionPercent === 20, firstDraft.territoryPartnerCommissionPercent);
    check("A5. licenseTermMonths === 36 (disclosed placeholder)", firstDraft.licenseTermMonths === 36, firstDraft.licenseTermMonths);
    check("A6. claimExpiryDays === 30 (disclosed placeholder)", firstDraft.claimExpiryDays === 30, firstDraft.claimExpiryDays);
    check("A7. acquisitionEarningTargetInPaise mirrors the entered reward (precedent: revenueConfig.service.js's own first-run resolution), not invented separately", firstDraft.acquisitionEarningTargetInPaise === r2p(enteredRewardRupees), firstDraft.acquisitionEarningTargetInPaise);

    // TEST B (Preview display) is a JSX/UI concern verified by direct
    // code inspection, not executable headlessly here — see report.
    results.push("ℹ️  B. Preview-dialog disclosure/field-display verified by static code review of PublishPreviewDialog (isFirstPolicy branch) — not executable from this headless script.");

    // ═══════════════════════════════════════════════════════════
    // TEST C — PUBLISH.
    // ═══════════════════════════════════════════════════════════
    const published1 = await publishPolicyVersion({ versionId: firstDraft._id, adminId });
    check("C1. Publish succeeds, status PUBLISHED", published1.status === "PUBLISHED", published1.status);
    const publishedCount = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("C2. Exactly one PUBLISHED policy exists", publishedCount === 1, publishedCount);

    // ═══════════════════════════════════════════════════════════
    // TEST E — SECOND POLICY. A published policy now exists, with
    // deliberately NON-placeholder Territory-Partner-field values
    // (8/12/45, all different from 20/36/30) so carry-forward is
    // unambiguous — if the placeholder branch were wrongly used
    // again, this would read 20/36/30 instead.
    // ═══════════════════════════════════════════════════════════
    await retirePolicyVersion({ versionId: published1._id, adminId, reason: "ZE2E_FIRSTPOLICY — swapping in a non-placeholder-shaped baseline for the carry-forward test" });
    const baselineDraft = await createDraftPolicyVersion({
      adminId,
      acquisitionAgentCommissionPercent: 8,
      acquisitionRewardAmountInPaise: r2p(250),
      acquisitionEarningTargetInPaise: r2p(250),
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 45,
    });
    createdPolicyIds.push(baselineDraft._id);
    const baselinePublished = await publishPolicyVersion({ versionId: baselineDraft._id, adminId });

    // Exact payload shape handleCreateDraft's "published exists"
    // branch constructs: CARRY_FORWARD_FIELDS copied verbatim from
    // `published`, never the placeholders.
    const CARRY_FORWARD_FIELDS = [
      "acquisitionIncentiveAmountInPaise", "acquisitionEarningTargetInPaise",
      "territoryPartnerCommissionPercent", "licenseTermMonths", "claimExpiryDays",
      "obligations", "performanceFactors", "coverageRules",
      "minimumPayoutInPaise", "autoPayoutEnabled",
    ];
    const carryForward = CARRY_FORWARD_FIELDS.reduce((acc, field) => {
      if (baselinePublished[field] !== undefined) acc[field] = baselinePublished[field];
      return acc;
    }, {});
    const secondDraft = await createDraftPolicyVersion({
      adminId,
      acquisitionAgentCommissionPercent: 22,
      acquisitionRewardAmountInPaise: r2p(400),
      ...carryForward,
    });
    createdPolicyIds.push(secondDraft._id);

    check("E1. Second draft's territoryPartnerCommissionPercent carried forward (8), NOT the placeholder (20)", secondDraft.territoryPartnerCommissionPercent === 8, secondDraft.territoryPartnerCommissionPercent);
    check("E2. Second draft's licenseTermMonths carried forward (12), NOT the placeholder (36)", secondDraft.licenseTermMonths === 12, secondDraft.licenseTermMonths);
    check("E3. Second draft's claimExpiryDays carried forward (45), NOT the placeholder (30)", secondDraft.claimExpiryDays === 45, secondDraft.claimExpiryDays);
    check("E4. Second draft's own Field Agent fields are the newly entered values (22%, ₹400)", secondDraft.acquisitionAgentCommissionPercent === 22 && secondDraft.acquisitionRewardAmountInPaise === r2p(400), secondDraft);

    // ═══════════════════════════════════════════════════════════
    // TEST F — SIDE EFFECT SAFETY.
    // ═══════════════════════════════════════════════════════════
    const afterOverride = await CommercialPolicyOverride.countDocuments({});
    const afterAssignment = await TerritoryAssignment.countDocuments({});
    check("F1. CommercialPolicyOverride count unchanged", afterOverride === before.CommercialPolicyOverride, { before: before.CommercialPolicyOverride, after: afterOverride });
    check("F2. TerritoryAssignment count unchanged (no Territory Partner assignment created)", afterAssignment === before.TerritoryAssignment, { before: before.TerritoryAssignment, after: afterAssignment });

    // ═══════════════════════════════════════════════════════════
    // CLEANUP — restore to exactly the pre-test state.
    // ═══════════════════════════════════════════════════════════
    await CommercialPolicyVersion.deleteMany({ _id: { $in: createdPolicyIds } });

    const after = {
      CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
      CommercialPolicyVersionPublished: await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" }),
      CommercialPolicyOverride: await CommercialPolicyOverride.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts: ${JSON.stringify(after)}`);
    check("G1. All counts returned exactly to their BEFORE values (no unrelated records left)", JSON.stringify(before) === JSON.stringify(after), { before, after });
  } catch (err) {
    console.error("FATAL ERROR DURING FIRST-POLICY-FIX E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await CommercialPolicyVersion.deleteMany({ _id: { $in: createdPolicyIds } });
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nFIELD-AGENT-COMMISSION-FIRST-POLICY-FIX-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
