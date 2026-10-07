/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentApplicationsPhase2A.js
 *
 * PHASE 2A — Field Agent "My Applications" read-only list. Live, real
 * Mongo (Atlas) + real HTTP (app.listen(0)) + real JWT verification.
 * No mocks. Reuses the proven fieldAgentE2EHelpers.js fixture pattern.
 *
 * Every document this script creates is tracked by exact _id and
 * purged in the `finally` block — never an unscoped delete filter.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentApplicationsPhase2A.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import Salon from "../../models/Salon.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };

// Minimal, direct fixture creation — this phase is READ-ONLY, so
// claims/salons are created directly (valid shapes only), not via the
// real /assisted-onboarding/start endpoint (that endpoint is Phase 1's
// own, already separately live-verified — reusing it here would just
// be re-testing Phase 1, not Phase 2A).
const makeClaimFixture = async ({ ownerPhone, fieldAgentId, onboardingStep, approvalStatus, rejectionReason, rejectedAt, claimStatus }) => {
  const owner = await User.create({ name: "ZE2E_P2A_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    {
      $set: {
        ownerId: owner._id,
        "basicInfo.shopName": `ZE2E_P2A_SALON_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        "onboarding.step": onboardingStep,
        "approval.status": approvalStatus,
        ...(rejectionReason ? { "approval.rejectionReason": rejectionReason } : {}),
        // Phase 11J fixture support — a REJECTED->Fix&Resubmit DRAFT
        // salon in real production NEVER has rejectedAt cleared by
        // resubmitOnboarding() (confirmed in the Phase 11I audit), so
        // this models that exact persisted shape directly.
        ...(rejectedAt ? { "approval.rejectedAt": rejectedAt } : {}),
      },
    },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  const referral = await AcquisitionReferral.create({
    code: `ZE2EP2A-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId,
    status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumedSalonRef: salon._id,
    consumedAt: new Date(),
  });
  const claim = await AcquisitionClaim.create({
    salonRef: salon._id,
    fieldAgentRef: fieldAgentId,
    referralRef: referral._id,
    status: claimStatus,
  });
  return { owner, salon, referral, claim };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    // ═══════════════════════════════════════════════════════════
    // FIXTURES — two independent ACTIVE Field Agents (A and B), for
    // the cross-agent isolation tests.
    // ═══════════════════════════════════════════════════════════
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P2A_A");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P2A_B");
    createdIds.users.push(faB.agentUser._id);
    createdIds.applications.push(faB.application._id);
    createdIds.fieldAgents.push(faB.fieldAgent._id);
    const faBToken = faB.token;

    const otherOwnerUser = await User.create({ name: "ZE2E_P2A_OTHER_OWNER", phone: nextPhone("8"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(otherOwnerUser._id);
    const ownerToken = generateAccessToken({ _id: otherOwnerUser._id, role: "OWNER", tokenVersion: 0 });

    // ───────────────────────────────────────────────────────────
    // TEST 1 — no token -> 401
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch("/api/field-agent/acquisition/applications", null, { method: "GET" });
      check("T1 no token -> 401", res.status === 401, res);
    }

    // TEST 2 — non-FIELD_AGENT (OWNER) token -> 403
    {
      const res = await authFetch("/api/field-agent/acquisition/applications", ownerToken, { method: "GET" });
      check("T2 OWNER token -> 403", res.status === 403, res);
    }

    // TEST 3 — zero applications -> empty list, 200, not an error
    {
      const res = await authFetch("/api/field-agent/acquisition/applications", faToken, { method: "GET" });
      check("T3 zero applications -> 200", res.status === 200, res);
      check("T3 success:true, applications is an array (not an error)", res.data?.success === true && Array.isArray(res.data?.data?.applications), res.data);
      check("T3 applications array is empty", (res.data?.data?.applications || []).length === 0, res.data?.data?.applications);
      check("T3 pagination.total === 0", res.data?.pagination?.total === 0, res.data?.pagination);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 4 — one claim -> one application, correct fields
    // ───────────────────────────────────────────────────────────
    const ownerPhone1 = nextPhone("7");
    const fixture1 = await makeClaimFixture({
      ownerPhone: ownerPhone1, fieldAgentId: fa.fieldAgent._id,
      onboardingStep: 2, approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(fixture1.owner._id);
    createdIds.salons.push(fixture1.salon._id);
    createdIds.referrals.push(fixture1.referral._id);
    createdIds.claims.push(fixture1.claim._id);

    {
      const res = await authFetch("/api/field-agent/acquisition/applications", faToken, { method: "GET" });
      const apps = res.data?.data?.applications || [];
      check("T4 one application returned", apps.length === 1, apps);
      const app1 = apps[0];
      check("T4 salonId correct", String(app1?.salonId) === String(fixture1.salon._id), app1);
      check("T4 ownerId correct (real owner, not FA)", String(app1?.ownerId) === String(fixture1.owner._id), app1);
      check("T4 onboardingStep === 2", app1?.onboardingStep === 2, app1);
      check("T4 salonApprovalStatus === DRAFT", app1?.salonApprovalStatus === "DRAFT", app1);
      check("T4 claimId correct", String(app1?.claimId) === String(fixture1.claim._id), app1);
      check("T4 claimStatus === PENDING_APPROVAL", app1?.claimStatus === "PENDING_APPROVAL", app1);
      check("T4 shopName present", !!app1?.shopName, app1);
      check("T4 rejectionReason is null (not applicable)", app1?.rejectionReason === null, app1);
      check("T4 response contains no OTP/token field", !JSON.stringify(res.data).toLowerCase().includes("accesstoken") && !JSON.stringify(res.data).toLowerCase().includes("\"otp\""), res.data);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 5 — multiple claims for the SAME field agent, DIFFERENT
    // statuses/steps -> all returned simultaneously, no singular
    // current/active assumption.
    // ───────────────────────────────────────────────────────────
    const ownerPhone2 = nextPhone("7");
    const fixture2 = await makeClaimFixture({
      ownerPhone: ownerPhone2, fieldAgentId: fa.fieldAgent._id,
      onboardingStep: 5, approvalStatus: "DRAFT", claimStatus: "ACTIVE_RECOVERY",
    });
    createdIds.users.push(fixture2.owner._id);
    createdIds.salons.push(fixture2.salon._id);
    createdIds.referrals.push(fixture2.referral._id);
    createdIds.claims.push(fixture2.claim._id);

    const ownerPhone3 = nextPhone("7");
    const fixture3 = await makeClaimFixture({
      ownerPhone: ownerPhone3, fieldAgentId: fa.fieldAgent._id,
      onboardingStep: 7, approvalStatus: "PENDING", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(fixture3.owner._id);
    createdIds.salons.push(fixture3.salon._id);
    createdIds.referrals.push(fixture3.referral._id);
    createdIds.claims.push(fixture3.claim._id);

    const ownerPhone4 = nextPhone("7");
    const fixture4 = await makeClaimFixture({
      ownerPhone: ownerPhone4, fieldAgentId: fa.fieldAgent._id,
      onboardingStep: 8, approvalStatus: "REJECTED", rejectionReason: "Incomplete KYC documents", claimStatus: "ENDED",
    });
    createdIds.users.push(fixture4.owner._id);
    createdIds.salons.push(fixture4.salon._id);
    createdIds.referrals.push(fixture4.referral._id);
    createdIds.claims.push(fixture4.claim._id);

    {
      const res = await authFetch("/api/field-agent/acquisition/applications?limit=50", faToken, { method: "GET" });
      const apps = res.data?.data?.applications || [];
      check("T5 all 4 applications returned for this agent", apps.length === 4, apps.map((a) => a.salonId));
      const bySalonId = new Map(apps.map((a) => [String(a.salonId), a]));
      const a1 = bySalonId.get(String(fixture1.salon._id));
      const a2 = bySalonId.get(String(fixture2.salon._id));
      const a3 = bySalonId.get(String(fixture3.salon._id));
      const a4 = bySalonId.get(String(fixture4.salon._id));
      check("T5 Salon A: step 2, PENDING_APPROVAL", a1?.onboardingStep === 2 && a1?.claimStatus === "PENDING_APPROVAL", a1);
      check("T5 Salon B: step 5, ACTIVE_RECOVERY", a2?.onboardingStep === 5 && a2?.claimStatus === "ACTIVE_RECOVERY", a2);
      check("T5 Salon C: PENDING approval, step 7", a3?.salonApprovalStatus === "PENDING" && a3?.onboardingStep === 7, a3);
      check("T5 Salon D: REJECTED with reason, ENDED claim", a4?.salonApprovalStatus === "REJECTED" && a4?.rejectionReason === "Incomplete KYC documents" && a4?.claimStatus === "ENDED", a4);
      check("T5 no accidental dedup by ownerId (4 distinct owners, 4 distinct salons)", new Set(apps.map((a) => String(a.salonId))).size === 4, apps);
    }

    // TEST 5b — same OWNER with TWO branches (two salons), both
    // claimed by the SAME field agent -> both appear as separate
    // applications, never deduplicated by ownerId.
    const sharedOwnerPhone = nextPhone("7");
    const branchA = await makeClaimFixture({
      ownerPhone: sharedOwnerPhone, fieldAgentId: fa.fieldAgent._id,
      onboardingStep: 1, approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(branchA.owner._id);
    createdIds.salons.push(branchA.salon._id);
    createdIds.referrals.push(branchA.referral._id);
    createdIds.claims.push(branchA.claim._id);

    // Second branch for the SAME owner — reuse the same owner User
    // doc, create a second Salon/referral/claim directly.
    const branchBSalon = await Salon.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { ownerId: branchA.owner._id, "basicInfo.shopName": `ZE2E_P2A_BRANCH_B_${Date.now()}`, "onboarding.step": 3, "approval.status": "DRAFT" } },
      { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
    );
    createdIds.salons.push(branchBSalon._id);
    const branchBReferral = await AcquisitionReferral.create({
      code: `ZE2EP2A-B-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      fieldAgentRef: fa.fieldAgent._id, status: "CONSUMED",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      consumedSalonRef: branchBSalon._id, consumedAt: new Date(),
    });
    createdIds.referrals.push(branchBReferral._id);
    const branchBClaim = await AcquisitionClaim.create({
      salonRef: branchBSalon._id, fieldAgentRef: fa.fieldAgent._id, referralRef: branchBReferral._id, status: "PENDING_APPROVAL",
    });
    createdIds.claims.push(branchBClaim._id);

    {
      const res = await authFetch("/api/field-agent/acquisition/applications?limit=50", faToken, { method: "GET" });
      const apps = res.data?.data?.applications || [];
      const bothBranches = apps.filter((a) => String(a.ownerId) === String(branchA.owner._id));
      check("T5b same owner's two branches BOTH appear as separate applications", bothBranches.length === 2, bothBranches);
      check("T5b branch salonIds are distinct", String(bothBranches[0]?.salonId) !== String(bothBranches[1]?.salonId), bothBranches);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 6 — cross-agent isolation: Field Agent B must NOT see
    // Field Agent A's applications, and vice versa.
    // ───────────────────────────────────────────────────────────
    const ownerPhoneB = nextPhone("7");
    const fixtureB = await makeClaimFixture({
      ownerPhone: ownerPhoneB, fieldAgentId: faB.fieldAgent._id,
      onboardingStep: 4, approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(fixtureB.owner._id);
    createdIds.salons.push(fixtureB.salon._id);
    createdIds.referrals.push(fixtureB.referral._id);
    createdIds.claims.push(fixtureB.claim._id);

    {
      const resB = await authFetch("/api/field-agent/acquisition/applications?limit=50", faBToken, { method: "GET" });
      const appsB = resB.data?.data?.applications || [];
      check("T6 Field Agent B sees exactly their own 1 application", appsB.length === 1, appsB);
      check("T6 Field Agent B's application is their own salon", String(appsB[0]?.salonId) === String(fixtureB.salon._id), appsB);
      check("T6 Field Agent B does NOT see any of Field Agent A's salons", !appsB.some((a) => [fixture1, fixture2, fixture3, fixture4, branchA].some((f) => String(a.salonId) === String(f.salon._id))), appsB);

      const resA = await authFetch("/api/field-agent/acquisition/applications?limit=50", faToken, { method: "GET" });
      const appsA = resA.data?.data?.applications || [];
      check("T6 Field Agent A does NOT see Field Agent B's salon", !appsA.some((a) => String(a.salonId) === String(fixtureB.salon._id)), appsA);
    }

    // TEST 6b — attempting to bypass scope via query params is ignored
    // (schema .unknown(false) + .forbidden() on identity fields).
    {
      const res = await authFetch(`/api/field-agent/acquisition/applications?fieldAgentId=${faB.fieldAgent._id}`, faToken, { method: "GET" });
      check("T6b client-supplied fieldAgentId query param is rejected (400, schema .forbidden())", res.status === 400, res);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 7 — status filter (optional, additive) works and does NOT
    // silently default to ACTIVE_RECOVERY-only.
    // ───────────────────────────────────────────────────────────
    {
      const resNoFilter = await authFetch("/api/field-agent/acquisition/applications?limit=50", faToken, { method: "GET" });
      const allStatuses = new Set((resNoFilter.data?.data?.applications || []).map((a) => a.claimStatus));
      check("T7 no status filter returns MULTIPLE distinct claim statuses (not auto-filtered to ACTIVE_RECOVERY)", allStatuses.size > 1, Array.from(allStatuses));

      const resFiltered = await authFetch("/api/field-agent/acquisition/applications?status=ENDED", faToken, { method: "GET" });
      const filteredApps = resFiltered.data?.data?.applications || [];
      check("T7 explicit status=ENDED filter returns only ENDED claims", filteredApps.length > 0 && filteredApps.every((a) => a.claimStatus === "ENDED"), filteredApps);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 8 — no write occurred anywhere (re-read every fixture,
    // confirm untouched since creation).
    // ───────────────────────────────────────────────────────────
    {
      const salonAfter = await Salon.findById(fixture1.salon._id).lean();
      check("T8 Salon.onboarding.step unchanged", salonAfter?.onboarding?.step === 2, salonAfter?.onboarding);
      check("T8 Salon.approval.status unchanged", salonAfter?.approval?.status === "DRAFT", salonAfter?.approval);
      const claimAfter = await AcquisitionClaim.findById(fixture1.claim._id).lean();
      check("T8 AcquisitionClaim.status unchanged", claimAfter?.status === "PENDING_APPROVAL", claimAfter);
      const referralAfter = await AcquisitionReferral.findById(fixture1.referral._id).lean();
      check("T8 AcquisitionReferral.status unchanged", referralAfter?.status === "CONSUMED", referralAfter);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 9 — regression: Phase 1's own assisted-onboarding
    // send-otp endpoint still works (not re-running Phase 1's full
    // 54-assertion suite here — just a live smoke check that this
    // router's Phase 1 routes are unaffected by the Phase 2A edit).
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: nextPhone("7") }),
      });
      check("T9 Phase 1 send-otp endpoint still returns 200", res.status === 200 && res.data?.success === true, res);
    }

    // TEST 10 — regression: existing /claims/mine (pre-Phase-1/2A)
    // still works, unaffected by the new route.
    {
      const res = await authFetch("/api/field-agent/acquisition/claims/mine", faToken, { method: "GET" });
      check("T10 existing /claims/mine still 200", res.status === 200, res);
    }

    // ───────────────────────────────────────────────────────────
    // PHASE 11J — Draft lifecycle visibility fix. Dedicated field
    // agent (P2A_C) so these 5 scenarios can be counted exactly,
    // independent of fixtures 1-4/branchA/branchB above.
    // ───────────────────────────────────────────────────────────
    const faC = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P2A_C");
    createdIds.users.push(faC.agentUser._id);
    createdIds.applications.push(faC.application._id);
    createdIds.fieldAgents.push(faC.fieldAgent._id);
    const faCToken = faC.token;

    // 11J-1: DRAFT + step 0 -> abandoned, permanently-empty draft.
    const j1 = await makeClaimFixture({
      ownerPhone: nextPhone("7"), fieldAgentId: faC.fieldAgent._id,
      onboardingStep: 0, approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(j1.owner._id); createdIds.salons.push(j1.salon._id);
    createdIds.referrals.push(j1.referral._id); createdIds.claims.push(j1.claim._id);

    // 11J-2: DRAFT + step 3 -> genuinely in-progress, must stay visible.
    const j2 = await makeClaimFixture({
      ownerPhone: nextPhone("7"), fieldAgentId: faC.fieldAgent._id,
      onboardingStep: 3, approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(j2.owner._id); createdIds.salons.push(j2.salon._id);
    createdIds.referrals.push(j2.referral._id); createdIds.claims.push(j2.claim._id);

    // 11J-3: REJECTED -> Fix&Resubmit -> DRAFT, rejectedAt still set
    // (never cleared by resubmitOnboarding, per the Phase 11I audit).
    // step is deliberately 0 here to prove rejectedAt alone is enough
    // to keep it visible, independent of the step condition.
    const j3 = await makeClaimFixture({
      ownerPhone: nextPhone("7"), fieldAgentId: faC.fieldAgent._id,
      onboardingStep: 0, approvalStatus: "DRAFT", rejectedAt: new Date(), claimStatus: "ENDED",
    });
    createdIds.users.push(j3.owner._id); createdIds.salons.push(j3.salon._id);
    createdIds.referrals.push(j3.referral._id); createdIds.claims.push(j3.claim._id);

    // 11J-4: PENDING -> submitted, awaiting admin review.
    const j4 = await makeClaimFixture({
      ownerPhone: nextPhone("7"), fieldAgentId: faC.fieldAgent._id,
      onboardingStep: 7, approvalStatus: "PENDING", claimStatus: "PENDING_APPROVAL",
    });
    createdIds.users.push(j4.owner._id); createdIds.salons.push(j4.salon._id);
    createdIds.referrals.push(j4.referral._id); createdIds.claims.push(j4.claim._id);

    // 11J-5: APPROVED.
    const j5 = await makeClaimFixture({
      ownerPhone: nextPhone("7"), fieldAgentId: faC.fieldAgent._id,
      onboardingStep: 7, approvalStatus: "APPROVED", claimStatus: "ACTIVE_RECOVERY",
    });
    createdIds.users.push(j5.owner._id); createdIds.salons.push(j5.salon._id);
    createdIds.referrals.push(j5.referral._id); createdIds.claims.push(j5.claim._id);

    {
      const res = await authFetch("/api/field-agent/acquisition/applications?limit=50", faCToken, { method: "GET" });
      const apps = res.data?.data?.applications || [];
      const bySalonId = new Map(apps.map((a) => [String(a.salonId), a]));

      check("11J-1 DRAFT+step0 is NOT returned", !bySalonId.has(String(j1.salon._id)), apps.map((a) => a.salonId));
      check("11J-2 DRAFT+step3 IS returned", bySalonId.has(String(j2.salon._id)), apps.map((a) => a.salonId));
      check("11J-3 REJECTED->DRAFT with rejectedAt IS returned (even at step 0)", bySalonId.has(String(j3.salon._id)), apps.map((a) => a.salonId));
      check("11J-4 PENDING IS returned", bySalonId.has(String(j4.salon._id)), apps.map((a) => a.salonId));
      check("11J-5 APPROVED IS returned", bySalonId.has(String(j5.salon._id)), apps.map((a) => a.salonId));
      check("11J total visible count === 4 (5 fixtures minus the 1 hidden abandoned draft)", apps.length === 4, apps.map((a) => a.salonId));
      check("11J pagination.total matches visible count (not raw claim count)", res.data?.pagination?.total === 4, res.data?.pagination);
    }

    // 11J-6: fieldAgentRef isolation still intact under the new filter
    // — Field Agent A (fa) must never see Field Agent C's fixtures.
    {
      const resA = await authFetch("/api/field-agent/acquisition/applications?limit=50", faToken, { method: "GET" });
      const appsA = resA.data?.data?.applications || [];
      check("11J-6 Field Agent A does not see Field Agent C's salons", !appsA.some((a) => [j1, j2, j3, j4, j5].some((f) => String(a.salonId) === String(f.salon._id))), appsA);
    }

    // 11J-7: no DB mutation occurred as a side effect of the new
    // read-side filtering (re-read every 11J fixture, confirm
    // untouched since creation).
    {
      const j1After = await Salon.findById(j1.salon._id).lean();
      check("11J-7 j1 Salon unchanged (step still 0, status still DRAFT)", j1After?.onboarding?.step === 0 && j1After?.approval?.status === "DRAFT", j1After);
      const j3After = await Salon.findById(j3.salon._id).lean();
      check("11J-7 j3 Salon unchanged (rejectedAt still set)", j3After?.approval?.rejectedAt != null, j3After?.approval);
    }

  } finally {
    // ═══════════════════════════════════════════════════════════
    // CLEANUP — exact _id only.
    // ═══════════════════════════════════════════════════════════
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total\n`);

    server.close();
    await mongoose.connection.close();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
