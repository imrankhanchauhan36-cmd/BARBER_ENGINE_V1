/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyExistingOwnerSecondSalonFlow.js
 *
 * "Existing Owner / Second Salon Flow" fix — focused backend
 * verification (2026-10-01), Part 9 of the implementation ticket.
 * Live, real Mongo (Atlas) + real Redis + real HTTP (app.listen(0)) +
 * real JWT. No mocks. Every document created is tracked by exact _id
 * and purged in the `finally` block.
 *
 * Covers exactly the 10 Part-9 items:
 *   1. APPROVED write rejected (every gated step + the two previously-
 *      ungated steps: basic-info, location)
 *   2. DRAFT write allowed
 *   3. PENDING — C.4-P1-1 (2026-10-06): ALL steps are blocked,
 *      including basic-info/location, which now share the exact same
 *      EDITABLE_STATUSES=["DRAFT"] guard as every other step. Verifies
 *      the previously-disclosed gap (basic-info/location ungated,
 *      inherited from the frozen Owner controller) is closed for the
 *      Field-Agent-scoped service, and that a rejected attempt leaves
 *      the salon's status/data completely unchanged.
 *   4. REJECTED — same C.4-P1-1 guard applies; basic-info/location are
 *      blocked until the explicit resubmit flow runs; resubmit still
 *      works exactly as before, and the salon becomes editable again
 *      (including basic-info/location) once back at DRAFT.
 *   5. Cross-agent blocking (FA-B cannot touch FA-A's claimed salon)
 *   6. Same-owner-multi-salon isolation (4 salons, 4 different
 *      statuses, independently addressable)
 *   7. createNewBranch -> fresh salonId, via the REAL
 *      assisted-onboarding start endpoint (not a fixture)
 *   8. Existing salons (A-D) unchanged after the new branch (E) is
 *      created
 *   9. Exactly one AcquisitionClaim exists for the new branch
 *   10. No schema change — satisfied structurally (no model file in
 *       this diff; verified separately via `git diff --stat`, not a
 *       runtime assertion) + the new branch's Salon document carries
 *       no fieldAgentId field (confirms the "no Salon.fieldAgentId"
 *       invariant was not violated by this fix)
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyExistingOwnerSecondSalonFlow.js
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

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch, requireField } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };

const REAL_LAT = 9.1833;
const REAL_LNG = 92.7667;

const fullWeekTimings = () => {
  const day = { open: "09:00", close: "20:00", isClosed: false, isOpen24Hours: false, breaks: [] };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
};

// Same direct-fixture pattern Phase 2B used — a bare salon + CONSUMED
// referral + a claim at a GIVEN status, for a given owner+fieldAgent.
const makeClaimedSalon = async ({ ownerId, fieldAgentId, approvalStatus, label }) => {
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId, "onboarding.step": approvalStatus === "DRAFT" ? 0 : 7, "approval.status": approvalStatus, "basicInfo.shopName": `ZE2E_EOSS_${label}` } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  const referral = await AcquisitionReferral.create({
    code: `ZE2EEOSS-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  const claimStatus = approvalStatus === "APPROVED" ? "ACTIVE_RECOVERY" : "PENDING_APPROVAL";
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: claimStatus });
  return { salon, referral, claim };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);
  const onboardingPath = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "EOSS_A");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "EOSS_B");
    createdIds.users.push(faB.agentUser._id);
    createdIds.applications.push(faB.application._id);
    createdIds.fieldAgents.push(faB.fieldAgent._id);
    const faBToken = faB.token;

    // One owner, phone known up front — reused later for the REAL
    // assisted-onboarding /start call (Phase 1's own createOrFindUser
    // resolves an owner by phone, so the real endpoint will find this
    // exact owner and this exact set of existing salons).
    const ownerPhone = nextPhone("7");
    const owner = await User.create({ name: "ZE2E_EOSS_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(owner._id);

    // Four pre-existing salons for this owner, four different
    // statuses, all claimed by FA A.
    const fixA = await makeClaimedSalon({ ownerId: owner._id, fieldAgentId: fa.fieldAgent._id, approvalStatus: "DRAFT", label: "A" });
    const fixB = await makeClaimedSalon({ ownerId: owner._id, fieldAgentId: fa.fieldAgent._id, approvalStatus: "PENDING", label: "B" });
    const fixC = await makeClaimedSalon({ ownerId: owner._id, fieldAgentId: fa.fieldAgent._id, approvalStatus: "REJECTED", label: "C" });
    const fixD = await makeClaimedSalon({ ownerId: owner._id, fieldAgentId: fa.fieldAgent._id, approvalStatus: "APPROVED", label: "D" });
    for (const f of [fixA, fixB, fixC, fixD]) {
      createdIds.salons.push(f.salon._id);
      createdIds.referrals.push(f.referral._id);
      createdIds.claims.push(f.claim._id);
    }
    const salonA = fixA.salon._id, salonB = fixB.salon._id, salonC = fixC.salon._id, salonD = fixD.salon._id;

    // ───────────────────────────────────────────────────────────
    // ITEM 1 — APPROVED (Salon D) write rejected, every write path.
    // ───────────────────────────────────────────────────────────
    {
      const rBasic = await authFetch(onboardingPath(salonD, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "Should Not Save", category: "UNISEX" }) });
      check("1a APPROVED salon: saveBasicInfo -> 400 (new guard)", rBasic.status === 400, rBasic);

      const rLoc = await authFetch(onboardingPath(salonD, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "x", lat: REAL_LAT, lng: REAL_LNG }) });
      check("1b APPROVED salon: saveLocation -> 400 (new guard)", rLoc.status === 400, rLoc);

      const rServices = await authFetch(onboardingPath(salonD, "/services"), faToken, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
      check("1c APPROVED salon: saveServices -> 400", rServices.status === 400, rServices);

      const rChairs = await authFetch(onboardingPath(salonD, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("1d APPROVED salon: saveChairs -> 400", rChairs.status === 400, rChairs);

      const rTimings = await authFetch(onboardingPath(salonD, "/timings"), faToken, { method: "PATCH", body: JSON.stringify({ timings: fullWeekTimings() }) });
      check("1e APPROVED salon: saveTimings -> 400", rTimings.status === 400, rTimings);

      const rStaff = await authFetch(onboardingPath(salonD, "/staff"), faToken, { method: "PATCH", body: JSON.stringify({ isOwnerOnly: true }) });
      check("1f APPROVED salon: saveStaff -> 400", rStaff.status === 400, rStaff);

      const rPhotos = await authFetch(onboardingPath(salonD, "/photos"), faToken, { method: "PATCH", body: JSON.stringify({ photos: [{ url: "https://example.com/p.jpg", type: "COVER" }] }) });
      check("1g APPROVED salon: savePhotos -> 400", rPhotos.status === 400, rPhotos);

      const rSubmit = await authFetch(onboardingPath(salonD, "/submit"), faToken, { method: "POST" });
      check("1h APPROVED salon: submit -> 400", rSubmit.status === 400, rSubmit);

      // Read access (getReview) is NOT a write — must remain allowed,
      // this is how the Existing Salons -> "View" action works.
      const rReview = await authFetch(onboardingPath(salonD, "/review"), faToken, { method: "GET" });
      check("1i APPROVED salon: getReview (read-only) still -> 200", rReview.status === 200, rReview);
    }

    // ───────────────────────────────────────────────────────────
    // ITEM 2 — DRAFT (Salon A) write allowed.
    // ───────────────────────────────────────────────────────────
    {
      const rBasic = await authFetch(onboardingPath(salonA, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E EOSS Salon A", category: "UNISEX" }) });
      check("2a DRAFT salon: saveBasicInfo -> 200", rBasic.status === 200, rBasic);

      // saveLocation first — saveChairs inherits the ORIGINAL frozen
      // controller's own step-threshold gate ("Complete previous
      // steps first", requires onboarding.step >= 2). saveBasicInfo
      // alone only reaches step 1 (Phase 11K fix — previously a
      // $max-nesting bug meant it never advanced the step at all, see
      // Phase 2B's report §7); saveLocation is still required here to
      // reach step 2, exactly like every other happy-path walk in
      // Phase 2B/2C-4's own scripts.
      const rLoc = await authFetch(onboardingPath(salonA, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "ZE2E EOSS A", lat: REAL_LAT, lng: REAL_LNG }) });
      check("2a2 DRAFT salon: saveLocation -> 200, step 2", rLoc.status === 200 && rLoc.data?.data?.onboardingStep === 2, rLoc);

      // saveChairs's own step-threshold gate requires step >= 3
      // (i.e. services done first) — same inherited, unmodified
      // original-controller requirement as saveServices requiring
      // step >= 2. Services called here purely to satisfy that
      // pre-existing threshold, not itself the thing under test.
      const rServices = await authFetch(onboardingPath(salonA, "/services"), faToken, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
      check("2a3 DRAFT salon: saveServices -> 200, step 3", rServices.status === 200 && rServices.data?.data?.onboardingStep === 3, rServices);

      const rChairs = await authFetch(onboardingPath(salonA, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("2b DRAFT salon: saveChairs -> 200", rChairs.status === 200, rChairs);
    }

    // ───────────────────────────────────────────────────────────
    // ITEM 3 — PENDING (Salon B): ALL steps blocked, including
    // basic-info/location, since C.4-P1-1 closed the gap by moving
    // both onto the same DRAFT-only assertEditable(salon) guard every
    // other step already used. Previously these two returned 200 and
    // (for basic-info only) silently flipped the salon back to DRAFT —
    // see git history for that prior behavior. Now both are rejected
    // and the salon's status/data are left completely unchanged.
    // ───────────────────────────────────────────────────────────
    {
      const bBefore = await Salon.findById(salonB).lean();

      const rChairs = await authFetch(onboardingPath(salonB, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("3a PENDING salon: saveChairs (gated step) -> 400", rChairs.status === 400, rChairs);

      const rBasic = await authFetch(onboardingPath(salonB, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E EOSS Salon B edited", category: "UNISEX" }) });
      check("3b C.4-P1-1: PENDING salon saveBasicInfo -> 400 (gap closed)", rBasic.status === 400, rBasic);

      const rLoc = await authFetch(onboardingPath(salonB, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "edited", lat: REAL_LAT, lng: REAL_LNG }) });
      check("3c C.4-P1-1: PENDING salon saveLocation -> 400 (gap closed)", rLoc.status === 400, rLoc);

      // Verify the rejected attempts had NO effect whatsoever: status
      // stays PENDING (not silently flipped to DRAFT the way the old
      // saveBasicInfo behavior used to), and shopName/address are
      // byte-for-byte unchanged from before the rejected calls.
      const bAfter = await Salon.findById(salonB).lean();
      check("3d PENDING salon: status remains PENDING after rejected Basic Info + Location attempts", bAfter?.approval?.status === "PENDING", bAfter?.approval);
      check("3e PENDING salon: shopName unchanged after rejected Basic Info attempt", bAfter?.basicInfo?.shopName === bBefore?.basicInfo?.shopName, { before: bBefore?.basicInfo?.shopName, after: bAfter?.basicInfo?.shopName });
      check("3f PENDING salon: location unchanged after rejected Location attempt", JSON.stringify(bAfter?.location) === JSON.stringify(bBefore?.location), { before: bBefore?.location, after: bAfter?.location });
    }

    // ───────────────────────────────────────────────────────────
    // ITEM 4 — REJECTED (Salon C): ALL steps blocked, including
    // basic-info/location (C.4-P1-1) — must stay read-only until the
    // explicit resubmit flow runs; resubmit still works exactly as
    // before.
    // ───────────────────────────────────────────────────────────
    {
      const cBefore = await Salon.findById(salonC).lean();

      const rBlocked = await authFetch(onboardingPath(salonC, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("4a REJECTED salon: saveChairs blocked -> 400", rBlocked.status === 400, rBlocked);

      const rBasic = await authFetch(onboardingPath(salonC, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E EOSS Salon C edited", category: "UNISEX" }) });
      check("4b C.4-P1-1: REJECTED salon saveBasicInfo -> 400 (gap closed)", rBasic.status === 400, rBasic);

      const rLoc = await authFetch(onboardingPath(salonC, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "edited", lat: REAL_LAT, lng: REAL_LNG }) });
      check("4c C.4-P1-1: REJECTED salon saveLocation -> 400 (gap closed)", rLoc.status === 400, rLoc);

      const cAfter = await Salon.findById(salonC).lean();
      check("4d REJECTED salon: status remains REJECTED after rejected Basic Info + Location attempts", cAfter?.approval?.status === "REJECTED", cAfter?.approval);
      check("4e REJECTED salon: shopName unchanged after rejected Basic Info attempt", cAfter?.basicInfo?.shopName === cBefore?.basicInfo?.shopName, { before: cBefore?.basicInfo?.shopName, after: cAfter?.basicInfo?.shopName });

      const rResubmit = await authFetch(onboardingPath(salonC, "/resubmit"), faToken, { method: "PATCH" });
      check("4f REJECTED salon: resubmit -> 200, flips to DRAFT", rResubmit.status === 200 && rResubmit.data?.data?.status === "DRAFT", rResubmit);

      const rAfter = await authFetch(onboardingPath(salonC, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("4g after resubmit, DRAFT salon editable again -> 200", rAfter.status === 200, rAfter);

      // Explicit resubmit flow: once DRAFT (post-resubmit), basic-info/
      // location must be editable again too (same DRAFT-only gate as
      // every other step — not a special case).
      const rBasicAfterResubmit = await authFetch(onboardingPath(salonC, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E EOSS Salon C resubmitted", category: "UNISEX" }) });
      check("4h after resubmit, DRAFT salon saveBasicInfo -> 200", rBasicAfterResubmit.status === 200, rBasicAfterResubmit);
    }

    // ───────────────────────────────────────────────────────────
    // ITEM 5 — cross-agent blocking (FA-B vs FA-A's claimed Salon A).
    // ───────────────────────────────────────────────────────────
    {
      const rCross = await authFetch(onboardingPath(salonA, "/basic-info"), faBToken, { method: "PATCH", body: JSON.stringify({ shopName: "x", category: "UNISEX" }) });
      check("5 FA-B cannot touch FA-A's claimed Salon A -> 404", rCross.status === 404, rCross);
    }

    // ───────────────────────────────────────────────────────────
    // ITEM 6 — same-owner-multi-salon isolation. Mutating A (items 2/3
    // above) must not have touched B/C/D's own independent fields.
    // ───────────────────────────────────────────────────────────
    {
      const bDoc = await Salon.findById(salonB).lean();
      check("6a Salon B shopName still its original fixture value (C.4-P1-1 rejected the edit; Salon A's own edits never leaked across), not by Salon A's edits", bDoc?.basicInfo?.shopName === "ZE2E_EOSS_B", bDoc?.basicInfo);
      const dDoc = await Salon.findById(salonD).lean();
      check("6b Salon D (APPROVED) completely untouched — status still APPROVED", dDoc?.approval?.status === "APPROVED", dDoc?.approval);
      check("6c Salon D (APPROVED) shopName never changed by the rejected write attempts", dDoc?.basicInfo?.shopName === "ZE2E_EOSS_D", dDoc?.basicInfo);
    }

    // ───────────────────────────────────────────────────────────
    // ITEMS 7/8/9/10 — REAL assisted-onboarding /start endpoint:
    // ambiguous result -> existing salons A-D listed -> "+ Add Another
    // Salon" (createNewBranch:true via the returned token) -> fresh
    // salonId E -> A-D unchanged -> exactly one claim for E -> no
    // Salon.fieldAgentId anywhere.
    // ───────────────────────────────────────────────────────────
    let salonE;
    {
      const otpRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhone }),
      });
      check("7a send-otp for the real, existing owner phone -> 200", otpRes.status === 200, otpRes);
      const devOtp = otpRes.data?.data?.devOtp;
      check("7a devOtp echoed (ALLOW_FIXED_OTP=true)", !!devOtp, otpRes.data);

      const startRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhone, otp: devOtp }),
      });
      check("7b plain start (no createNewBranch) -> 200, requiresSalonSelection:true", startRes.status === 200 && startRes.data?.data?.requiresSalonSelection === true, startRes);

      const listed = startRes.data?.data?.existingSalons || [];
      const listedIds = listed.map((s) => String(s.id)).sort();
      const expectedIds = [salonA, salonB, salonC, salonD].map(String).sort();
      check("7c existingSalons lists exactly Salon A/B/C/D, no more, no fewer", JSON.stringify(listedIds) === JSON.stringify(expectedIds), listedIds);

      const dEntry = listed.find((s) => String(s.id) === String(salonD));
      check("7d existingSalons reports Salon D's real approvalStatus (APPROVED)", dEntry?.approvalStatus === "APPROVED", dEntry);
      const bEntry = listed.find((s) => String(s.id) === String(salonB));
      // C.4-P1-1: Salon B's basic-info/location edit attempts in item 3
      // were both rejected (400), so unlike the prior behavior, B's
      // status is still PENDING here — never silently flipped to DRAFT.
      check("7e existingSalons reports Salon B's real, current approvalStatus (still PENDING — C.4-P1-1 rejected the edit attempts)", bEntry?.approvalStatus === "PENDING", bEntry);

      const assistedToken = requireField(startRes.data, "data.assistedOnboardingToken", "start (ambiguous) response");

      const addRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ assistedOnboardingToken: assistedToken, createNewBranch: true }),
      });
      check("7f start w/ token + createNewBranch:true -> 201", addRes.status === 201, addRes);
      salonE = addRes.data?.data?.salonId;
      check("7g a genuinely NEW salonId was returned (not any of A-D)", !!salonE && ![salonA, salonB, salonC, salonD].map(String).includes(String(salonE)), { salonE, salonA, salonB, salonC, salonD });
      if (salonE) createdIds.salons.push(salonE);

      const claimForE = await AcquisitionClaim.find({ salonRef: salonE }).lean();
      check("9 exactly one AcquisitionClaim exists for new branch E", claimForE.length === 1, claimForE);
      if (claimForE[0]) createdIds.claims.push(claimForE[0]._id);
      check("9b the one claim for E belongs to FA A (the calling agent), status PENDING_APPROVAL", String(claimForE[0]?.fieldAgentRef) === String(fa.fieldAgent._id) && claimForE[0]?.status === "PENDING_APPROVAL", claimForE[0]);
      const referralForE = await AcquisitionReferral.findOne({ consumedSalonRef: salonE }).lean();
      if (referralForE) createdIds.referrals.push(referralForE._id);

      const eDoc = await Salon.findById(salonE).lean();
      check("8a Salon E belongs to the SAME owner", String(eDoc?.ownerId) === String(owner._id), eDoc?.ownerId);
      check("8b Salon E starts DRAFT, step 0", eDoc?.approval?.status === "DRAFT" && (eDoc?.onboarding?.step ?? 0) === 0, eDoc);
      check("10 Salon E carries no fieldAgentId field (frozen invariant, never added)", eDoc?.fieldAgentId === undefined, eDoc?.fieldAgentId);

      // ITEM 8 — A-D completely unaffected by E's creation.
      const aAfter = await Salon.findById(salonA).lean();
      const bAfter = await Salon.findById(salonB).lean();
      const cAfter = await Salon.findById(salonC).lean();
      const dAfter = await Salon.findById(salonD).lean();
      check("8c Salon A unchanged by E's creation (still has A's own post-item-2 state)", aAfter?.basicInfo?.shopName === "ZE2E EOSS Salon A" && (aAfter?.onboarding?.step ?? 0) >= 2, aAfter);
      check("8d Salon B unchanged by E's creation", bAfter?.basicInfo?.shopName === "ZE2E_EOSS_B", bAfter?.basicInfo);
      check("8e Salon C unchanged by E's creation (still DRAFT from item 4's resubmit)", cAfter?.approval?.status === "DRAFT", cAfter?.approval);
      check("8f Salon D unchanged by E's creation (still APPROVED)", dAfter?.approval?.status === "APPROVED", dAfter?.approval);

      // The new branch itself must be reachable + editable (DRAFT),
      // proving "+ Add Another Salon" lands somewhere real and usable.
      const rNewBasic = await authFetch(onboardingPath(salonE, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E EOSS Salon E", category: "UNISEX" }) });
      check("7h new branch E is immediately writable (DRAFT) -> 200", rNewBasic.status === 200, rNewBasic);
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
