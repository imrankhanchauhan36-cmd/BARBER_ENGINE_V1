/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyAcquisitionBookingSummary.js
 *
 * PHASE 2 — "Acquisition Booking/Commission Aggregation API" live
 * verification. Proves the new, additive `bookingRecoverySummary`
 * field on GET /api/field-agent/acquisition/recovery/:claimId against
 * the REAL earning engine (processCompletedBooking — the exact
 * function fieldAgentEarning.job.js's own tick calls), not hand-
 * fabricated ledger rows, so the test matrix below exercises the
 * genuine CREDITED / ZERO_TARGET_REACHED / cap behavior the real
 * engine actually produces.
 *
 * FIXTURE METHODOLOGY — same proven pattern as
 * verifyFieldAgentAttributionCommission.js: real, disposable PUBLISHED
 * CommercialPolicyVersion (10% commission, ₹200 target), real Field
 * Agent fixtures, salon/claim created via the REAL assisted-onboarding
 * HTTP flow (not AcquisitionClaim.create directly), bookings completed
 * via the same HOLD->raw-collection-update->COMPLETED trick already
 * proven there. The only addition here is `totalAmountInPaise` on each
 * booking fixture (needed to exercise the new totalBookingValueInPaise
 * figure — the Attribution script never needed it).
 *
 * FA-9 PHASE A UPDATE: this script's entire point is proving
 * bookingRecoverySummary aggregates REAL per-booking ACQUISITION-type
 * ledger rows correctly while a claim accrues commission — that only
 * happens while a claim is ACTIVE_RECOVERY. Since Phase A's
 * adminApproveClaim now transitions PENDING_APPROVAL straight through
 * to COMPLETED in one transaction (paying the one-time Acquisition
 * Reward and ending the relationship), it is no longer the right tool
 * to reach ACTIVE_RECOVERY for a test that specifically needs to STAY
 * there. claims X/Y/Z are now pushed into ACTIVE_RECOVERY directly
 * (forceActiveRecovery, below) — the same claim-progress snapshot
 * adminApproveClaim itself would have created, just without also
 * paying the reward and completing the claim. This is a test-fixture
 * change only; adminApproveClaim itself is untouched and is exercised
 * for real, for both the ACTIVE_RECOVERY and COMPLETED paths, by
 * verifyFieldAgentAcquisitionRewardPhaseA.js.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyAcquisitionBookingSummary.js
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
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import Booking, { BOOKING_STATUS } from "../../models/Booking.js";
import { createAcquisitionEarningProgressForClaim, processCompletedBooking } from "../../modules/fieldAgent/services/fieldAgentEarning.service.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch, oid } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 500) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], policies: [], bookings: [], progress: [] };

// Distinct from the Attribution script's mkBooking: also sets
// totalAmountInPaise, the one new field this phase's aggregation
// reads, and accepts an explicit userRef so the privacy check below
// can prove that exact customer id never leaks into the response.
// FA-9 PHASE A — pushes a claim straight to ACTIVE_RECOVERY + its
// AcquisitionEarningProgress snapshot, bypassing adminApproveClaim
// (which would also pay the reward and complete the claim). See file
// header. Mirrors adminApproveClaim's own first step exactly (the
// conditional PENDING_APPROVAL -> ACTIVE_RECOVERY update) minus the
// reward-credit/COMPLETED half this test deliberately doesn't want.
const forceActiveRecovery = async (claimId, salonId) => {
  const claim = await AcquisitionClaim.findOneAndUpdate(
    { _id: claimId, status: "PENDING_APPROVAL" },
    { $set: { status: "ACTIVE_RECOVERY" } },
    { new: true }
  ).lean();
  const salon = await Salon.findById(salonId).lean();
  const progress = await createAcquisitionEarningProgressForClaim({ claim, salon });
  return { claim, progress };
};

const mkBooking = async (salon, { commissionAmountInPaise, totalAmountInPaise, completedAt = new Date(), userRef = oid() } = {}) => {
  const booking = await Booking.create({
    userRef, salonRef: salon, chairRef: oid(), serviceRefs: [oid()],
    bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000),
    serviceDuration: 30, status: BOOKING_STATUS.HOLD, commissionAmountInPaise, totalAmountInPaise,
  });
  await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.COMPLETED, completedAt } });
  createdIds.bookings.push(booking._id);
  return { _id: booking._id, salonRef: salon, commissionAmountInPaise, completedAt, userRef };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    const policy = await CommercialPolicyVersion.create({
      versionNumber: 900001 + Math.floor(Math.random() * 100000),
      status: "PUBLISHED",
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 20000, // ₹200
      acquisitionRewardAmountInPaise: 20000, // FA-9 Phase A — ₹200, required since this field was introduced
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
      createdBy: oid(),
      publishedBy: oid(),
      publishedAt: new Date(Date.now() - 365 * 24 * 3600 * 1000),
      obligations: [{ key: "ZE2E_BOOKING_SUMMARY_AUDIT", description: "Disposable audit fixture — safe to delete." }],
    });
    createdIds.policies.push(policy._id);

    const faA = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "BKSUM_A");
    createdIds.users.push(faA.agentUser._id); createdIds.applications.push(faA.application._id); createdIds.fieldAgents.push(faA.fieldAgent._id);
    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "BKSUM_B");
    createdIds.users.push(faB.agentUser._id); createdIds.applications.push(faB.application._id); createdIds.fieldAgents.push(faB.fieldAgent._id);

    const startAssisted = async (token, phone, { otp = "123456", createNewBranch = true } = {}) => {
      await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", token, { method: "POST", body: JSON.stringify({ phone }) });
      return authFetch("/api/field-agent/acquisition/assisted-onboarding/start", token, {
        method: "POST", body: JSON.stringify({ phone, otp, createNewBranch }),
      });
    };

    // ═══════════════════════════════════════════════════════════
    // CLAIM X — Agent A, Salon X. Three bookings: two CREDITED
    // (second capped) then one ZERO_TARGET_REACHED.
    // ═══════════════════════════════════════════════════════════
    const ownerPhoneX = nextPhone("7");
    const startX = await startAssisted(faA.token, ownerPhoneX);
    const salonX = startX.data?.data?.salonId;
    const claimXId = startX.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonX); createdIds.claims.push(claimXId); createdIds.users.push(startX.data?.data?.ownerId);
    check("SETUP.1 Claim X created via real assisted-onboarding flow", !!salonX && !!claimXId, startX.data);
    {
      const claimDoc = await AcquisitionClaim.findById(claimXId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    const { claim: approvedX, progress: progressX } = await forceActiveRecovery(claimXId, salonX);
    check("SETUP.2 Claim X forced to ACTIVE_RECOVERY (direct fixture, not adminApproveClaim — this script tests the pre-completion booking-commission path, see file header)", approvedX?.status === "ACTIVE_RECOVERY", approvedX);
    if (progressX?._id) createdIds.progress.push(progressX._id);

    const custX1 = oid();
    const bX1 = await mkBooking(salonX, { commissionAmountInPaise: 100000, totalAmountInPaise: 1000000, userRef: custX1 }); // ₹1000 commission, ₹10000 total -> 10% = ₹100 = 10000 paise CREDITED
    const outX1 = await processCompletedBooking(bX1);
    check("1.1 Booking X1 CREDITED, 10000 paise", outX1.outcome === "CREDITED" && outX1.creditedAmountInPaise === 10000, outX1);

    const bX2 = await mkBooking(salonX, { commissionAmountInPaise: 500000, totalAmountInPaise: 2000000, completedAt: new Date(bX1.completedAt.getTime() + 1000) }); // 10% = ₹500 = 50000 paise, remaining is only 10000 -> capped
    const outX2 = await processCompletedBooking(bX2);
    check("1.2 Booking X2 CREDITED, capped at remaining 10000 paise (target now full)", outX2.outcome === "CREDITED" && outX2.creditedAmountInPaise === 10000, outX2);
    {
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claimXId }).lean();
      check("1.3 Progress reaches TARGET_REACHED at exactly 20000 paise", progress?.earnedInPaise === 20000 && progress?.status === "TARGET_REACHED", progress);
    }

    const bX3 = await mkBooking(salonX, { commissionAmountInPaise: 100000, totalAmountInPaise: 500000, completedAt: new Date(bX2.completedAt.getTime() + 1000) }); // target already full -> ZERO_TARGET_REACHED
    const outX3 = await processCompletedBooking(bX3);
    // NOTE: processCompletedBooking's own TOP-LEVEL return reflects the
    // (now-retired) territory-partner fallthrough outcome
    // (TERRITORY_PATH_RETIRED), not the acquisition ledger row's own
    // outcome — confirmed by reading fieldAgentEarning.service.js
    // directly (attemptAcquisitionCredit already wrote the
    // ZERO_TARGET_REACHED ledger row before that fallthrough runs).
    // The real assertion is the ledger row itself, read directly.
    const ledgerX3 = await FieldAgentEarningLedger.findOne({ bookingRef: bX3._id }).lean();
    check("2.1 Booking X3's ledger row -> ZERO_TARGET_REACHED, 0 paise credited", ledgerX3?.creditOutcome === "ZERO_TARGET_REACHED" && ledgerX3?.creditedAmountInPaise === 0, ledgerX3);

    // ═══════════════════════════════════════════════════════════
    // Part 13 test matrix, against the REAL HTTP detail endpoint.
    // ═══════════════════════════════════════════════════════════
    const detailXRes = await authFetch(`/api/field-agent/acquisition/recovery/${claimXId}`, faA.token, { method: "GET" });
    const detailX = detailXRes.data?.data;
    const summaryX = detailX?.bookingRecoverySummary;

    check("3.1 Detail response HTTP 200 + success", detailXRes.status === 200 && detailXRes.data?.success === true, detailXRes);
    check("4.1 [Matrix #1] qualifyingBookingCount === 3 (2 credited + 1 zero-target)", summaryX?.qualifyingBookingCount === 3, summaryX);
    check("4.2 [Matrix #1] totalBookingValueInPaise === sum of all 3 bookings' totalAmountInPaise (1000000+2000000+500000=3500000)", summaryX?.totalBookingValueInPaise === 3500000, summaryX);
    check("4.3 [Matrix #1] totalPlatformCommissionInPaise === sum of all 3 bookings' commission (100000+500000+100000=700000)", summaryX?.totalPlatformCommissionInPaise === 700000, summaryX);
    check("4.4 [Matrix #1] fieldAgentEarningInPaise === sum of CREDITED amounts only (10000+10000+0=20000)", summaryX?.fieldAgentEarningInPaise === 20000, summaryX);

    check("5.1 [Matrix #2] ZERO_TARGET_REACHED row counted in qualifyingBookingCount (not excluded)", summaryX?.qualifyingBookingCount === 3, summaryX);
    check("5.2 [Matrix #2] ZERO_TARGET_REACHED row's booking value (500000) included in totalBookingValueInPaise", summaryX?.totalBookingValueInPaise >= 3500000, summaryX);
    check("5.3 [Matrix #2] ZERO_TARGET_REACHED row's commission (100000) included in totalPlatformCommissionInPaise", summaryX?.totalPlatformCommissionInPaise === 700000, summaryX);
    check("5.4 [Matrix #2] ZERO_TARGET_REACHED row contributes 0 to fieldAgentEarningInPaise (20000, not 30000)", summaryX?.fieldAgentEarningInPaise === 20000, summaryX);

    check("8.1 [Matrix #6] ₹200 cap integrity: fieldAgentEarningInPaise (20000) equals actual capped recoveredAmount", summaryX?.fieldAgentEarningInPaise === detailX?.recoveredAmount, { summary: summaryX?.fieldAgentEarningInPaise, recoveredAmount: detailX?.recoveredAmount });
    check("8.2 [Matrix #6] fieldAgentEarningInPaise never exceeds the ₹200 (20000 paise) target", summaryX?.fieldAgentEarningInPaise <= 20000, summaryX);

    check("9.1 [Matrix #7] Customer privacy: response contains no customer userRef (X1's customer id absent)", !JSON.stringify(detailXRes.data).includes(String(custX1)), { custX1 });
    check("9.2 [Matrix #7] Response has no 'userRef'/'phone' key anywhere under bookingRecoverySummary", !("userRef" in (summaryX || {})) && !("phone" in (summaryX || {})) && !("bookingRefs" in (summaryX || {})), summaryX);

    // NOTE: assisted-onboarding's own /start step only creates a bare
    // DRAFT salon shell (basicInfo.shopName is filled in by a later
    // onboarding step, out of this fixture's scope) — so presence is
    // checked via `_id`/`ownerId` (the fields this phase and Phase 1
    // actually depend on), not `basicInfo.shopName`.
    check("10.1 [Matrix #8] Existing field `salon` unchanged/still present", !!detailX?.salon?._id && !!detailX?.salon?.ownerId, detailX?.salon);
    check("10.2 [Matrix #8] Existing field `status` unchanged/still present", typeof detailX?.status === "string", detailX?.status);
    check("10.3 [Matrix #8] Existing field `targetAmount` === 20000 (unchanged derivation)", detailX?.targetAmount === 20000, detailX?.targetAmount);
    check("10.4 [Matrix #8] Existing field `recoveredAmount` === 20000 (unchanged derivation)", detailX?.recoveredAmount === 20000, detailX?.recoveredAmount);
    check("10.5 [Matrix #8] Existing field `remainingAmount` === 0 (unchanged derivation)", detailX?.remainingAmount === 0, detailX?.remainingAmount);
    check("10.6 [Matrix #8] Existing field `progressPercent` === 100 (unchanged derivation)", detailX?.progressPercent === 100, detailX?.progressPercent);
    check("10.7 [Matrix #8] Existing field `bookingRecoveryLedger` unchanged, still has exactly 3 rows", Array.isArray(detailX?.bookingRecoveryLedger) && detailX.bookingRecoveryLedger.length === 3, detailX?.bookingRecoveryLedger);

    // ═══════════════════════════════════════════════════════════
    // CLAIM Y — Agent A, Salon Y (different salon, same agent):
    // NO completed bookings at all -> explicit zeros.
    // ═══════════════════════════════════════════════════════════
    const ownerPhoneY = nextPhone("7");
    const startY = await startAssisted(faA.token, ownerPhoneY);
    const salonY = startY.data?.data?.salonId;
    const claimYId = startY.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonY); createdIds.claims.push(claimYId); createdIds.users.push(startY.data?.data?.ownerId);
    {
      const claimDoc = await AcquisitionClaim.findById(claimYId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    {
      const { progress } = await forceActiveRecovery(claimYId, salonY);
      if (progress?._id) createdIds.progress.push(progress._id);
    }

    const detailYRes = await authFetch(`/api/field-agent/acquisition/recovery/${claimYId}`, faA.token, { method: "GET" });
    const summaryY = detailYRes.data?.data?.bookingRecoverySummary;
    check("6.1 [Matrix #3] Claim with zero ledger rows -> qualifyingBookingCount === 0", summaryY?.qualifyingBookingCount === 0, summaryY);
    check("6.2 [Matrix #3] Claim with zero ledger rows -> totalBookingValueInPaise === 0", summaryY?.totalBookingValueInPaise === 0, summaryY);
    check("6.3 [Matrix #3] Claim with zero ledger rows -> totalPlatformCommissionInPaise === 0", summaryY?.totalPlatformCommissionInPaise === 0, summaryY);
    check("6.4 [Matrix #3] Claim with zero ledger rows -> fieldAgentEarningInPaise === 0", summaryY?.fieldAgentEarningInPaise === 0, summaryY);
    check("7.1 Same-owner-two-salon isolation: Claim Y's summary unaffected by Claim X's bookings", summaryY?.qualifyingBookingCount === 0 && summaryX?.qualifyingBookingCount === 3, { summaryX, summaryY });

    // ═══════════════════════════════════════════════════════════
    // CLAIM Z — Agent B, Salon Z: cross-agent isolation.
    // ═══════════════════════════════════════════════════════════
    const ownerPhoneZ = nextPhone("7");
    const startZ = await startAssisted(faB.token, ownerPhoneZ);
    const salonZ = startZ.data?.data?.salonId;
    const claimZId = startZ.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonZ); createdIds.claims.push(claimZId); createdIds.users.push(startZ.data?.data?.ownerId);
    {
      const claimDoc = await AcquisitionClaim.findById(claimZId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    {
      const { progress } = await forceActiveRecovery(claimZId, salonZ);
      if (progress?._id) createdIds.progress.push(progress._id);
    }
    const bZ1 = await mkBooking(salonZ, { commissionAmountInPaise: 50000, totalAmountInPaise: 800000 });
    const outZ1 = await processCompletedBooking(bZ1);
    check("SETUP.3 Booking Z1 CREDITED to Agent B", outZ1.outcome === "CREDITED" && String(outZ1.fieldAgentRef) === String(faB.fieldAgent._id), outZ1);

    const detailZByA = await authFetch(`/api/field-agent/acquisition/recovery/${claimZId}`, faA.token, { method: "GET" });
    check("11.1 Cross-agent isolation: Agent A CANNOT read Agent B's claim Z detail (404, not leaked)", detailZByA.status === 404, detailZByA);

    const detailZByB = await authFetch(`/api/field-agent/acquisition/recovery/${claimZId}`, faB.token, { method: "GET" });
    const summaryZ = detailZByB.data?.data?.bookingRecoverySummary;
    check("11.2 Cross-agent isolation: Agent B's own claim Z summary correct (1 booking, 5000 paise earned)", summaryZ?.qualifyingBookingCount === 1 && summaryZ?.fieldAgentEarningInPaise === 5000, summaryZ);
    check("11.3 Cross-agent isolation: Claim X's summary (Agent A) unaffected by Agent B's Claim Z booking", summaryX?.qualifyingBookingCount === 3, summaryX);

    // ═══════════════════════════════════════════════════════════
    // Matrix #9 / #10 — existing LIST + My Applications unchanged.
    // ═══════════════════════════════════════════════════════════
    const listRes = await authFetch(`/api/field-agent/acquisition/recovery?limit=50`, faA.token, { method: "GET" });
    // NOTE: the list controller's own response key is `data.salons`
    // (see fieldAgentAcquisitionRecovery.controller.js), not
    // `data.items` — confirmed by reading the controller directly.
    const listItemX = (listRes.data?.data?.salons || []).find((i) => String(i.claimId) === String(claimXId));
    check("12.1 [Matrix #9] Recovery LIST still 200 + contains Claim X", listRes.status === 200 && !!listItemX, { status: listRes.status, found: !!listItemX });
    check("12.2 [Matrix #9] Recovery LIST item does NOT carry bookingRecoverySummary (detail-only, additive)", listItemX && !("bookingRecoverySummary" in listItemX), listItemX);
    check("12.3 [Matrix #9] Recovery LIST item's existing fields intact (targetAmount/recoveredAmount/progressPercent)", listItemX?.targetAmount === 20000 && listItemX?.recoveredAmount === 20000 && listItemX?.progressPercent === 100, listItemX);

    const applicationsRes = await authFetch(`/api/field-agent/acquisition/applications?limit=50`, faA.token, { method: "GET" });
    check("13.1 [Matrix #10] My Applications endpoint still 200 (untouched this phase)", applicationsRes.status === 200 && applicationsRes.data?.success === true, applicationsRes.status);

  } finally {
    await FieldAgentEarningLedger.collection.deleteMany({ bookingRef: { $in: createdIds.bookings } });
    await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: createdIds.claims.filter(Boolean) } });
    await Booking.deleteMany({ _id: { $in: createdIds.bookings } });
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
    await CommercialPolicyVersion.deleteMany({ _id: { $in: createdIds.policies } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });

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
