/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentOnboardingPhase2B.js
 *
 * PHASE 2B — Field Agent salonId-scoped onboarding step-write APIs +
 * claim-ownership guard. Live, real Mongo (Atlas) + real Redis + real
 * HTTP (app.listen(0)) + real JWT. No mocks.
 *
 * Every document this script creates is tracked by exact _id and
 * purged in the `finally` block.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentOnboardingPhase2B.js
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
import Service from "../../models/Service.js";
import Staff from "../../models/Staff.js";
import Chair from "../../models/Chair.js";
import SalonMedia from "../../models/SalonMedia.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };

// Real Pincode-covered coordinates, read directly from the live Atlas
// Pincode collection (Carnicobar, 744301) — guarantees
// geoService.detectLocation() returns a real, non-null location
// rather than depending on synthetic/unindexed coordinates.
const REAL_LAT = 9.1833;
const REAL_LNG = 92.7667;

const fullWeekTimings = () => {
  const day = { open: "09:00", close: "20:00", isClosed: false, isOpen24Hours: false, breaks: [] };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
};

// Bare DRAFT salon + CONSUMED referral + PENDING_APPROVAL claim for a
// given owner+fieldAgent — same direct-fixture pattern Phase 2A used
// (this phase is testing the NEW onboarding-write surface, not
// re-testing Phase 1's own already-verified /start endpoint).
const makeClaimedDraftSalon = async ({ ownerPhone, fieldAgentId }) => {
  const owner = await User.create({ name: "ZE2E_P2B_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId: owner._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  const referral = await AcquisitionReferral.create({
    code: `ZE2EP2B-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: "PENDING_APPROVAL" });
  return { owner, salon, referral, claim };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P2B_A");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P2B_B");
    createdIds.users.push(faB.agentUser._id);
    createdIds.applications.push(faB.application._id);
    createdIds.fieldAgents.push(faB.fieldAgent._id);
    const faBToken = faB.token;

    const ownerOnlyUser = await User.create({ name: "ZE2E_P2B_OTHER_OWNER", phone: nextPhone("8"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(ownerOnlyUser._id);
    const ownerToken = generateAccessToken({ _id: ownerOnlyUser._id, role: "OWNER", tokenVersion: 0 });

    // Main fixture: Salon X, claimed by FA A.
    const fixtureX = await makeClaimedDraftSalon({ ownerPhone: nextPhone("7"), fieldAgentId: fa.fieldAgent._id });
    createdIds.users.push(fixtureX.owner._id);
    createdIds.salons.push(fixtureX.salon._id);
    createdIds.referrals.push(fixtureX.referral._id);
    createdIds.claims.push(fixtureX.claim._id);
    const salonX = fixtureX.salon._id;

    // Salon Y, claimed by FA B (cross-agent isolation target).
    const fixtureY = await makeClaimedDraftSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faB.fieldAgent._id });
    createdIds.users.push(fixtureY.owner._id);
    createdIds.salons.push(fixtureY.salon._id);
    createdIds.referrals.push(fixtureY.referral._id);
    createdIds.claims.push(fixtureY.claim._id);
    const salonY = fixtureY.salon._id;

    // A SECOND salon for Salon X's SAME owner, but claimed by FA A
    // too — proves "ownerId is never used to select the target" (two
    // salons, same owner, independently addressable only by salonId).
    const salonBranchB = await Salon.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { ownerId: fixtureX.owner._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
      { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
    );
    createdIds.salons.push(salonBranchB._id);
    const branchBReferral = await AcquisitionReferral.create({
      code: `ZE2EP2B-BR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      fieldAgentRef: fa.fieldAgent._id, status: "CONSUMED",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      consumedSalonRef: salonBranchB._id, consumedAt: new Date(),
    });
    createdIds.referrals.push(branchBReferral._id);
    const branchBClaim = await AcquisitionClaim.create({ salonRef: salonBranchB._id, fieldAgentRef: fa.fieldAgent._id, referralRef: branchBReferral._id, status: "PENDING_APPROVAL" });
    createdIds.claims.push(branchBClaim._id);

    const path = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

    // ───────────────────────────────────────────────────────────
    // T1 — unauthenticated -> 401
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch(path(salonX, "/basic-info"), null, { method: "PATCH", body: JSON.stringify({ shopName: "X", category: "UNISEX" }) });
      check("T1 unauthenticated -> 401", res.status === 401, res);
    }

    // T2 — non-Field-Agent (OWNER token) -> 403
    {
      const res = await authFetch(path(salonX, "/basic-info"), ownerToken, { method: "PATCH", body: JSON.stringify({ shopName: "X", category: "UNISEX" }) });
      check("T2 OWNER token -> 403", res.status === 403, res);
    }

    // T13a — malformed salonId (not 24-hex) -> 400 (Joi param validation)
    {
      const res = await authFetch(path("not-a-valid-id", "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "X", category: "UNISEX" }) });
      check("T13a malformed salonId -> 400", res.status === 400, res);
    }

    // T13b — well-formed but nonexistent salonId -> 404
    {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await authFetch(path(fakeId, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "X", category: "UNISEX" }) });
      check("T13b nonexistent salonId -> 404", res.status === 404, res);
    }

    // T4/T5/T14 — cross-agent isolation BEFORE any real mutation.
    {
      const resACrossB = await authFetch(path(salonY, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "X", category: "UNISEX" }) });
      check("T4 FA-A cannot mutate Salon Y (owned by FA-B's claim) -> 404", resACrossB.status === 404, resACrossB);

      const resBCrossX = await authFetch(path(salonX, "/basic-info"), faBToken, { method: "PATCH", body: JSON.stringify({ shopName: "X", category: "UNISEX" }) });
      check("T5 FA-B cannot mutate Salon X (owned by FA-A's claim) -> 404", resBCrossX.status === 404, resBCrossX);

      const resBOwnY = await authFetch(path(salonY, "/review"), faBToken, { method: "GET" });
      check("T14b FA-B CAN read their own claimed Salon Y (claim exists) -> 200", resBOwnY.status === 200, resBOwnY);
    }

    // ───────────────────────────────────────────────────────────
    // T12a — existing validation preserved: invalid chairCount
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch(path(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 0 }) });
      check("T12a chairCount=0 rejected (Joi min(1))", res.status === 400, res);
      const res2 = await authFetch(path(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 999 }) });
      check("T12a chairCount=999 rejected (Joi max(50))", res2.status === 400, res2);
    }

    // T12b — invalid lat/lng preserved
    {
      const res = await authFetch(path(salonX, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "x", lat: 999, lng: 999 }) });
      check("T12b invalid lat/lng rejected", res.status === 400, res);
    }

    // ───────────────────────────────────────────────────────────
    // T3/T6/T8/T9/T10/T11 — FULL HAPPY-PATH WALK for Salon X, step by
    // step, verifying salonId-exact targeting and step advancement at
    // every stage.
    // ───────────────────────────────────────────────────────────
    {
      const r1 = await authFetch(path(salonX, "/basic-info"), faToken, {
        method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P2B Salon X", category: "UNISEX" }),
      });
      // PHASE 11K FIX (was: "inherited $max-nesting quirk, see Phase
      // 2B report §7" — saveBasicInfo's own $max was nested INSIDE the
      // $set payload object instead of as a true top-level Mongo
      // operator sibling to $set, so it never actually advanced
      // onboarding.step). Fixed in fieldAgentOnboarding.service.js;
      // this Field-Agent-scoped salon (pre-existing at step 0, created
      // by Phase 1) now correctly advances to step 1 on this call.
      // NOTE: the identical nesting bug was separately confirmed to
      // still exist in the frozen Owner-flow
      // controllers/salon.onboarding.controller.js:122-129 — explicitly
      // OUT OF SCOPE for Phase 11K ("Do NOT change Owner onboarding
      // controller"), left untouched, flagged for its own ticket.
      check("T3.1 saveBasicInfo -> 200, step advances to 1 (Phase 11K fix)", r1.status === 200 && r1.data?.data?.onboardingStep === 1, r1);

      const r2 = await authFetch(path(salonX, "/location"), faToken, {
        method: "PATCH", body: JSON.stringify({ address: "Test address", lat: REAL_LAT, lng: REAL_LNG }),
      });
      check("T3.2 saveLocation -> 200, step 2", r2.status === 200 && r2.data?.data?.onboardingStep === 2, r2);

      const r3 = await authFetch(path(salonX, "/services"), faToken, {
        method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }),
      });
      check("T3.3 saveServices -> 200, step 3", r3.status === 200 && r3.data?.data?.onboardingStep === 3, r3);

      const r4 = await authFetch(path(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("T3.4 saveChairs -> 200, step 4", r4.status === 200 && r4.data?.data?.onboardingStep === 4, r4);

      const r5 = await authFetch(path(salonX, "/timings"), faToken, { method: "PATCH", body: JSON.stringify({ timings: fullWeekTimings() }) });
      check("T3.5 saveTimings -> 200, step 5", r5.status === 200 && r5.data?.data?.onboardingStep === 5, r5);

      // Exercises the disclosed owner-identity adaptation directly —
      // isOwnerOnly:true must read the REAL owner's name/phone, not
      // the Field Agent's (whose JWT carries neither).
      const r6 = await authFetch(path(salonX, "/staff"), faToken, { method: "PATCH", body: JSON.stringify({ isOwnerOnly: true }) });
      check("T3.6 saveStaff(isOwnerOnly) -> 200, step 6", r6.status === 200 && r6.data?.data?.onboardingStep === 6, r6);

      const r7 = await authFetch(path(salonX, "/photos"), faToken, {
        method: "PATCH", body: JSON.stringify({ photos: [{ url: "https://example.com/photo1.jpg", type: "COVER" }] }),
      });
      check("T3.7 savePhotos -> 200, step 7", r7.status === 200 && r7.data?.data?.onboardingStep === 7, r7);

      const r8 = await authFetch(path(salonX, "/review"), faToken, { method: "GET" });
      check("T3.8 getReview -> 200", r8.status === 200, r8);
      check("T3.8 review.salon._id === salonX", String(r8.data?.data?.salon?._id) === String(salonX), r8.data?.data?.salon?._id);
      check("T3.8 review.services has 1 item", (r8.data?.data?.services || []).length === 1, r8.data?.data?.services);
      check("T3.8 review.staff has 1 item (owner barber)", (r8.data?.data?.staff || []).length === 1, r8.data?.data?.staff);
      check("T3.8 review.media has 1 item", (r8.data?.data?.media || []).length === 1, r8.data?.data?.media);
      check("T3.8 review.chairs has 2 items", (r8.data?.data?.chairs || []).length === 2, r8.data?.data?.chairs);

      // T11 — step data persists correctly, verified by direct DB read
      // of the sub-resource collections, keyed by salonId (unchanged
      // models, confirmed untouched).
      const serviceDoc = await Service.findOne({ salonId: salonX }).lean();
      check("T11 Service doc created with correct salonId", String(serviceDoc?.salonId) === String(salonX), serviceDoc);
      check("T11 Service createdBy === real owner (never the Field Agent)", String(serviceDoc?.createdBy) === String(fixtureX.owner._id), serviceDoc?.createdBy);
      const staffDoc = await Staff.findOne({ salonId: salonX }).lean();
      check("T11 Staff doc (owner-only) has real owner's name/phone source, isOwner:true", staffDoc?.isOwner === true && String(staffDoc?.createdBy) === String(fixtureX.owner._id), staffDoc);
      const chairCount = await Chair.countDocuments({ salonId: salonX });
      check("T11 2 Chair docs created with correct salonId", chairCount === 2, chairCount);
      const mediaDoc = await SalonMedia.findOne({ salonId: salonX }).lean();
      check("T11 SalonMedia doc created with correct salonId", String(mediaDoc?.salonId) === String(salonX), mediaDoc);

      const r9 = await authFetch(path(salonX, "/submit"), faToken, { method: "POST" });
      check("T17 submitSalon -> 200 (completeness rules satisfied)", r9.status === 200, r9);
      check("T17 salon.approval.status -> PENDING", r9.data?.data?.status === "PENDING", r9.data);
    }

    // T6/T7/T8/T9 — Salon X's SAME owner's branch B salon is
    // completely unaffected by everything just done to Salon X.
    {
      const branchBAfter = await Salon.findById(salonBranchB).lean();
      check("T6/T7/T8/T9 Salon branch B (same owner) untouched — step still 0", branchBAfter?.onboarding?.step === 0, branchBAfter?.onboarding);
      check("T6/T7/T8/T9 Salon branch B untouched — status still DRAFT", branchBAfter?.approval?.status === "DRAFT", branchBAfter?.approval);
      const branchBServiceCount = await Service.countDocuments({ salonId: salonBranchB._id });
      check("T6/T7/T8/T9 no Service leaked into branch B", branchBServiceCount === 0, branchBServiceCount);

      // Now mutate branch B independently — proves ownerId is NEVER
      // the selector (same owner as Salon X, different salonId).
      const rBranch = await authFetch(path(salonBranchB._id, "/basic-info"), faToken, {
        method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P2B Branch B", category: "MEN_ONLY" }),
      });
      // Phase 11K fix applies here too — step now correctly advances
      // to 1; the 200 itself is still what this test primarily cares
      // about (branch B's OWN salonId was correctly targeted).
      check("T7 branch B mutated independently via its OWN salonId -> 200", rBranch.status === 200, rBranch);
      {
        const branchBAfterBasicInfo = await Salon.findById(salonBranchB).lean();
        check("T7 branch B onboarding.step advances to 1 (Phase 11K fix)", branchBAfterBasicInfo?.onboarding?.step === 1, branchBAfterBasicInfo?.onboarding);
      }

      const salonXAfter = await Salon.findById(salonX).lean();
      check("T6/T9 mutating branch B did NOT change Salon X's step (still progressed independently)", salonXAfter?.onboarding?.step >= 7, salonXAfter?.onboarding);
      check("T6/T9 Salon X shopName unaffected by branch B's edit", salonXAfter?.basicInfo?.shopName === "ZE2E P2B Salon X", salonXAfter?.basicInfo);
    }

    // ───────────────────────────────────────────────────────────
    // T15/T16 — status-gate behavior: APPROVED vs REJECTED.
    //
    // UPDATED 2026-10-01 ("Existing Owner / Second Salon Flow" fix,
    // approved product rule): this assertion is DELIBERATELY changed
    // from its original Phase 2B value. It originally asserted
    // APPROVED was editable (matching the ORIGINAL frozen controller's
    // own [DRAFT,APPROVED] allow-list, flagged in the Phase 2B report
    // §7). That is no longer this service's behavior BY DESIGN — see
    // fieldAgentOnboarding.service.js's own EDITABLE_STATUSES header
    // comment. This is a disclosed, required update reflecting the
    // newly-approved product rule, not a silent/unrelated change. The
    // Owner-facing controller itself is untouched and still treats
    // APPROVED as editable — this divergence is Field-Agent-scoped
    // only (see scripts/e2e/verifyExistingOwnerSecondSalonFlow.js for
    // the full, dedicated test of this rule).
    // ───────────────────────────────────────────────────────────
    {
      await Salon.findByIdAndUpdate(salonX, { $set: { "approval.status": "APPROVED" } });
      const rApproved = await authFetch(path(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 3 }) });
      check(
        "T15 APPROVED salon: gated step (chairs) now BLOCKED -> 400 (Field-Agent-scoped rule, updated 2026-10-01 — see verifyExistingOwnerSecondSalonFlow.js)",
        rApproved.status === 400,
        rApproved
      );
      // Reset back to DRAFT so the rest of the suite (REJECTED/resubmit
      // flow immediately below) exercises its own intended transition,
      // not a salon stuck on APPROVED.
      await Salon.findByIdAndUpdate(salonX, { $set: { "approval.status": "DRAFT" } });

      await Salon.findByIdAndUpdate(salonX, { $set: { "approval.status": "REJECTED", "approval.rejectionReason": "Test rejection" } });
      const rRejected = await authFetch(path(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 3 }) });
      check("T16a REJECTED salon: gated step (chairs) blocked -> 400 (matches original exactly)", rRejected.status === 400, rRejected);

      const rResubmitWrong = await authFetch(path(salonBranchB._id, "/resubmit"), faToken, { method: "PATCH" });
      check("T16b resubmit on a non-REJECTED salon -> 400 (matches original exactly)", rResubmitWrong.status === 400, rResubmitWrong);

      const rResubmit = await authFetch(path(salonX, "/resubmit"), faToken, { method: "PATCH" });
      check("T16c resubmit on REJECTED salon -> 200, flips to DRAFT", rResubmit.status === 200 && rResubmit.data?.data?.status === "DRAFT", rResubmit);

      const rAfterResubmit = await authFetch(path(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 3 }) });
      check("T16d after resubmit, DRAFT salon editable again -> 200", rAfterResubmit.status === 200, rAfterResubmit);
    }

    // T17b — submit's own completeness rule, tested on a salon with no
    // data at all.
    {
      const rNoData = await authFetch(path(salonBranchB._id, "/submit"), faToken, { method: "POST" });
      check("T17b submit on incomplete salon (no services/staff/media/chairs) -> 400", rNoData.status === 400, rNoData);
    }

    // ───────────────────────────────────────────────────────────
    // T18 — idempotent mutation does not corrupt data. Fire the SAME
    // Idempotency-Key twice against saveChairs (its own delete+insert
    // pattern is exactly the kind of operation a duplicate retry could
    // corrupt).
    // ───────────────────────────────────────────────────────────
    {
      // Reset Salon X back to DRAFT + step>=3 so chairs is editable again.
      await Salon.findByIdAndUpdate(salonX, { $set: { "approval.status": "DRAFT" } });
      const idemKey = `ZE2E_P2B_IDEM_${Date.now()}`;
      const call1 = await authFetch(path(salonX, "/chairs"), faToken, {
        method: "PATCH", headers: { "Idempotency-Key": idemKey }, body: JSON.stringify({ chairCount: 4 }),
      });
      check("T18 first idempotent call -> 200", call1.status === 200, call1);
      const call2 = await authFetch(path(salonX, "/chairs"), faToken, {
        method: "PATCH", headers: { "Idempotency-Key": idemKey }, body: JSON.stringify({ chairCount: 4 }),
      });
      check("T18 retried call returns cached envelope (idempotency.middleware.js)", call2.status === 200 && call2.data?.cached === true, call2);
      const chairCountAfter = await Chair.countDocuments({ salonId: salonX });
      check("T18 exactly 4 chairs exist despite the duplicate retry (not 8)", chairCountAfter === 4, chairCountAfter);
    }

    // ───────────────────────────────────────────────────────────
    // T19/T20 — regression smoke checks (full suites re-run separately
    // right after this script, per the required test order).
    // ───────────────────────────────────────────────────────────
    {
      const resP1 = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: nextPhone("7") }),
      });
      check("T19 Phase 1 send-otp endpoint still 200", resP1.status === 200 && resP1.data?.success === true, resP1);

      const resP2A = await authFetch("/api/field-agent/acquisition/applications", faToken, { method: "GET" });
      check("T20 Phase 2A GET /applications still 200", resP2A.status === 200, resP2A);
    }

  } finally {
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } });
    await Service.deleteMany({ salonId: { $in: createdIds.salons } });
    await Staff.deleteMany({ salonId: { $in: createdIds.salons } });
    await Chair.deleteMany({ salonId: { $in: createdIds.salons } });
    await SalonMedia.deleteMany({ salonId: { $in: createdIds.salons } });
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
