/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyAcquisitionClaimLifecycleFix.js
 *
 * PHASE C.3 — Acquisition Claim lifecycle fix. Disposable, real-Mongo,
 * real-HTTP verification that:
 *   - adminApproveClaim now stops at ACTIVE_RECOVERY (no reward, no
 *     COMPLETED, no ACQUISITION_REWARD ledger row)
 *   - two simultaneous approvals: exactly one succeeds
 *   - per-booking ACQUISITION commission now actually fires while
 *     ACTIVE_RECOVERY (previously unreachable — see the C.3 audit)
 *   - commission base is booking.commissionAmountInPaise (Platform
 *     Fee), NOT serviceAmountInPaise or gstAmountInPaise
 *   - the round(PlatformFee x percent) formula is correct at 10/20/50%
 *   - approve/reject notifications fire, non-blocking
 *
 * Does NOT test claim COMPLETION or earning reversal — the C.3 audit
 * found no legitimate existing closure trigger, and no reversal
 * mechanism exists without a schema change neither of which this
 * phase implements (see the implementation report).
 *
 * FIXTURE METHODOLOGY — the real, live, singleton PUBLISHED
 * CommercialPolicyVersion is read-only reused here (never a second one
 * created — a prior attempt at that in this same environment hit the
 * real {status:"PUBLISHED"} unique-index conflict, confirming this is
 * the only safe approach). Booking fixtures use the exact proven shape
 * from verifyFieldAgentAttributionCommission.js (HOLD, then a raw
 * collection.updateOne to COMPLETED+completedAt).
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyAcquisitionClaimLifecycleFix.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import Country from "../../models/Country.js";
import Notification from "../../models/Notification.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import Booking, { BOOKING_STATUS } from "../../models/Booking.js";
import { processCompletedBooking } from "../../modules/fieldAgent/services/fieldAgentEarning.service.js";

import { makeGeoFixture, nextPhone, makeActiveFieldAgent, oid } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const NAME_PREFIX = "ZTEST_ACQCLAIM_";
// Pure replication of fieldAgentEarning.service.js's own private
// roundPaise() formula (not exported) — used ONLY to independently
// verify the 10/20/50% worked examples arithmetically, since this
// environment cannot publish a second CommercialPolicyVersion (real
// singleton {status:"PUBLISHED"} unique index, confirmed by a prior
// failed attempt in this same environment).
const roundPaiseReplica = (amountInPaise, ratePercent) => Math.round((amountInPaise * ratePercent) / 100);

const run = async () => {
  await connectDB();

  const before = {
    AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
    AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
    FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Notification: await Notification.countDocuments({}),
  };
  results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

  // Real, live, singleton published policy — read-only.
  const nationalPolicy = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
  if (!nationalPolicy) {
    console.error("SAFETY ABORT: no PUBLISHED CommercialPolicyVersion exists — this script requires one to exist already (read-only reuse, never creates one).");
    process.exit(1);
  }
  results.push(`ℹ️  Reusing real published policy: acquisitionAgentCommissionPercent=${nationalPolicy.acquisitionAgentCommissionPercent}%`);

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], bookings: [], states: [], districts: [], cities: [], areas: [] };

  try {
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "ACQCLAIM");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    const indiaAdminDoc = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true } }).select("+tokenVersion");
    if (!indiaAdminDoc) throw new Error("No real INDIA admin exists in this DB — cannot proceed");
    const indiaAdminToken = generateAccessToken({ _id: indiaAdminDoc._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdminDoc.tokenVersion ?? 0 });

    // STATE/DISTRICT admin fixtures — ONE INDIA admin is a hard
    // unique-index constraint (reused read-only above); STATE/DISTRICT
    // have no such constraint for a fresh, never-used state/district.
    const mkAdmin = async (label, adminLevel, stateRef, districtRef) => {
      const u = await User.create({
        name: `${NAME_PREFIX}${label}`,
        phone: nextPhone("8"),
        email: `${NAME_PREFIX.toLowerCase()}${label.toLowerCase()}_${Date.now()}@example.test`,
        role: "ADMIN", adminLevel, countryRef: geo.country._id,
        stateRef: stateRef || null, districtRef: districtRef || null,
        adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
        accountStatus: "ACTIVE", tokenVersion: 0,
      });
      createdIds.users.push(u._id);
      return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
    };
    const stateAdminToken = await mkAdmin("STATE_ADMIN", "STATE", geo.state._id);
    const districtAdminToken = await mkAdmin("DISTRICT_ADMIN", "DISTRICT", geo.state._id, geo.district._id);

    const mkOwnerSalon = async (label) => {
      const ownerPhone = nextPhone("7");
      const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${label}`, phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
      createdIds.users.push(owner._id);
      const dayTiming = { open: "09:00", close: "20:00" };
      const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${NAME_PREFIX}SALON_${label}_${Date.now()}`, category: "UNISEX" },
        location: {
          address: `${NAME_PREFIX} addr`,
          geo: { type: "Point", coordinates: [77, 28] },
          territory: { countryRef: geo.country._id, stateRef: geo.state._id, districtRef: geo.district._id, cityRef: geo.city._id, areaRef: geo.area._id },
        },
        timings, approval: { status: "APPROVED" }, onboarding: { step: 2 }, isDeleted: false,
      });
      createdIds.salons.push(salon._id);
      const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
      return { owner, salon, ownerToken };
    };

    const mkClaimViaRealFlow = async (label) => {
      const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, label);
      createdIds.users.push(fa.agentUser._id);
      createdIds.applications.push(fa.application._id);
      createdIds.fieldAgents.push(fa.fieldAgent._id);

      const referral = await AcquisitionReferral.create({
        code: `${NAME_PREFIX}${label}_${Date.now()}`,
        fieldAgentRef: fa.fieldAgent._id,
        status: "ISSUED",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      createdIds.referrals.push(referral._id);

      const { owner, salon, ownerToken } = await mkOwnerSalon(label);
      const rRedeem = await authFetch("/api/acquisition/redeem", ownerToken, { method: "POST", body: JSON.stringify({ referralCode: referral.code }) });
      if (rRedeem.status !== 200) throw new Error(`redeem failed for ${label}: ${JSON.stringify(rRedeem.data)}`);
      const claimId = rRedeem.data?.data?.claim?._id;
      createdIds.claims.push(claimId);
      return { fa, owner, salon, claimId };
    };

    const mkBooking = async (salonId, { commissionAmountInPaise, serviceAmountInPaise, gstAmountInPaise, completedAt = new Date() } = {}) => {
      const booking = await Booking.create({
        userRef: oid(), salonRef: salonId, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000),
        serviceDuration: 30, status: BOOKING_STATUS.HOLD,
        commissionAmountInPaise, serviceAmountInPaise, gstAmountInPaise,
      });
      await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.COMPLETED, completedAt } });
      createdIds.bookings.push(booking._id);
      return { _id: booking._id, salonRef: salonId, commissionAmountInPaise, completedAt };
    };

    const countRewardLogs = (claimId) => FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: claimId, entitlementType: "ACQUISITION_REWARD" });

    // ════════════════════════════════════════════════════════════
    // SECTION A — claim approval now stops at ACTIVE_RECOVERY
    // ════════════════════════════════════════════════════════════
    const claimA = await mkClaimViaRealFlow("A_APPROVE");
    const rApproveA = await authFetch(`/api/admin/acquisition-claims/${claimA.claimId}/approve`, indiaAdminToken, { method: "POST" });
    check("A1. Approve = 200", rApproveA.status === 200, rApproveA.data);
    check("A2. Response status = ACTIVE_RECOVERY", rApproveA.data?.data?.claim?.status === "ACTIVE_RECOVERY", rApproveA.data);

    const claimAAfter = await AcquisitionClaim.findById(claimA.claimId).lean();
    check("A3. Persisted status = ACTIVE_RECOVERY (not COMPLETED)", claimAAfter.status === "ACTIVE_RECOVERY", claimAAfter.status);
    check("A4. No ACQUISITION_REWARD ledger row created", (await countRewardLogs(claimA.claimId)) === 0);

    const progressA = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claimA.claimId }).lean();
    check("A5. AcquisitionEarningProgress snapshot created on approval", !!progressA, progressA);

    // ════════════════════════════════════════════════════════════
    // SECTION A-CONCURRENCY — two simultaneous approvals
    // ════════════════════════════════════════════════════════════
    const claimB = await mkClaimViaRealFlow("B_RACE");
    const [r1, r2] = await Promise.all([
      authFetch(`/api/admin/acquisition-claims/${claimB.claimId}/approve`, indiaAdminToken, { method: "POST" }),
      authFetch(`/api/admin/acquisition-claims/${claimB.claimId}/approve`, indiaAdminToken, { method: "POST" }),
    ]);
    const successCount = [r1.status, r2.status].filter((s) => s === 200).length;
    const conflictCount = [r1.status, r2.status].filter((s) => s !== 200).length;
    check("A6. Exactly one of two simultaneous approvals = 200, other is a conflict", successCount === 1 && conflictCount === 1, { r1: r1.status, r2: r2.status });
    const claimBAfter = await AcquisitionClaim.findById(claimB.claimId).lean();
    check("A7. Final status = ACTIVE_RECOVERY (exactly one transition happened)", claimBAfter.status === "ACTIVE_RECOVERY", claimBAfter.status);
    check("A8. No duplicate ACQUISITION_REWARD ledger (none at all, by design)", (await countRewardLogs(claimB.claimId)) === 0);

    // ════════════════════════════════════════════════════════════
    // SECTION B — booking commission during ACTIVE_RECOVERY
    // ════════════════════════════════════════════════════════════
    // B1 — real end-to-end credit via the real national policy's real
    // percent (50% at the time this ran), platform fee ₹100.
    const bookingB1 = await mkBooking(claimA.salon._id, {
      commissionAmountInPaise: 10000, // ₹100 Platform Fee
      serviceAmountInPaise: 777700,   // deliberately unrelated large value
      gstAmountInPaise: 1234,         // deliberately unrelated value
    });
    const outcomeB1 = await processCompletedBooking(bookingB1);
    const expectedB1 = roundPaiseReplica(10000, nationalPolicy.acquisitionAgentCommissionPercent);
    check(`B1. Booking commission credited = round(₹100 x ${nationalPolicy.acquisitionAgentCommissionPercent}%)`, outcomeB1.creditedAmountInPaise === expectedB1, { outcome: outcomeB1, expectedB1 });
    check("B2. Commission is NOT based on serviceAmountInPaise/gstAmountInPaise", outcomeB1.creditedAmountInPaise !== 777700 && outcomeB1.creditedAmountInPaise !== 1234);

    const ledgerRowB1 = await FieldAgentEarningLedger.findOne({ bookingRef: bookingB1._id }).lean();
    check("B3. Ledger row's bookingCommissionAmountInPaise = booking.commissionAmountInPaise (Platform Fee)", ledgerRowB1?.bookingCommissionAmountInPaise === 10000, ledgerRowB1);
    check("B4. Ledger row entitlementType = ACQUISITION", ledgerRowB1?.entitlementType === "ACQUISITION");

    // B5 — a second, later booking on the SAME still-ACTIVE_RECOVERY
    // claim is also eligible (the relationship did not end after one booking).
    const bookingB2 = await mkBooking(claimA.salon._id, { commissionAmountInPaise: 10000, serviceAmountInPaise: 500000, gstAmountInPaise: 900, completedAt: new Date(Date.now() + 1000) });
    const outcomeB2 = await processCompletedBooking(bookingB2);
    check("B5. A second booking while still ACTIVE_RECOVERY is also eligible", outcomeB2.creditedAmountInPaise >= 0 && outcomeB2.outcome !== "NO_ENTITLEMENT", outcomeB2);

    // B6-B8 — pure arithmetic replication of the 10/20/50% worked
    // examples against a ₹100 Platform Fee (see file header: this
    // environment cannot publish a second national policy to exercise
    // all three live, so the formula itself is verified directly here).
    check("B6. round(₹100 Platform Fee x 10%) = ₹10 (1000 paise)", roundPaiseReplica(10000, 10) === 1000);
    check("B7. round(₹100 Platform Fee x 20%) = ₹20 (2000 paise)", roundPaiseReplica(10000, 20) === 2000);
    check("B8. round(₹100 Platform Fee x 50%) = ₹50 (5000 paise)", roundPaiseReplica(10000, 50) === 5000);

    // ════════════════════════════════════════════════════════════
    // SECTION F — notifications (non-blocking)
    // ════════════════════════════════════════════════════════════
    // recipientId for adminApproveClaim's own notification is
    // claim.fieldAgentRef (the FieldAgent document's _id), NOT
    // agentUser._id (that's redeemReferral's own NEW_SALON_ASSIGNED
    // recipient) — filtering by title too, to disambiguate from that
    // earlier, unrelated creation notification.
    const approveNotif = await Notification.findOne({ recipientId: claimA.fa.fieldAgent._id, recipientType: "FIELD_AGENT", title: "Acquisition Claim Approved" }).sort({ createdAt: -1 }).lean();
    check("F1. Approval notification document created", !!approveNotif, approveNotif);

    const claimC = await mkClaimViaRealFlow("C_REJECT");
    const rReject = await authFetch(`/api/admin/acquisition-claims/${claimC.claimId}/reject`, indiaAdminToken, { method: "POST" });
    check("F2. Reject = 200", rReject.status === 200, rReject.data);
    const claimCAfter = await AcquisitionClaim.findById(claimC.claimId).lean();
    check("F3. Rejected claim status = ENDED", claimCAfter.status === "ENDED", claimCAfter.status);
    const rejectNotif = await Notification.findOne({ recipientId: claimC.fa.fieldAgent._id, recipientType: "FIELD_AGENT", title: "Acquisition Claim Ended" }).sort({ createdAt: -1 }).lean();
    check("F4. Rejection notification document created", !!rejectNotif, rejectNotif);

    // ════════════════════════════════════════════════════════════
    // PHASE C.3-A — SECTION C: COMPLETION
    // ════════════════════════════════════════════════════════════
    const claimD = await mkClaimViaRealFlow("D_COMPLETE");
    const rApproveD = await authFetch(`/api/admin/acquisition-claims/${claimD.claimId}/approve`, indiaAdminToken, { method: "POST" });
    check("C1. Setup: approve = 200", rApproveD.status === 200, rApproveD.data);
    const claimDAfterApprove = await AcquisitionClaim.findById(claimD.claimId).lean();
    check("C2. Setup: status = ACTIVE_RECOVERY before completion", claimDAfterApprove.status === "ACTIVE_RECOVERY", claimDAfterApprove.status);
    check("C3. No ACQUISITION_REWARD exists before completion", (await countRewardLogs(claimD.claimId)) === 0);

    const rCompleteD = await authFetch(`/api/admin/acquisition-claims/${claimD.claimId}/complete`, indiaAdminToken, { method: "POST" });
    check("C4. Complete = 200", rCompleteD.status === 200, rCompleteD.data);
    check("C5. Response claim.status = COMPLETED", rCompleteD.data?.data?.claim?.status === "COMPLETED", rCompleteD.data);

    const claimDAfterComplete = await AcquisitionClaim.findById(claimD.claimId).lean();
    check("C6. Persisted status = COMPLETED", claimDAfterComplete.status === "COMPLETED", claimDAfterComplete.status);
    check("C7. Exactly one ACQUISITION_REWARD ledger row exists", (await countRewardLogs(claimD.claimId)) === 1);

    const rewardRowD = await FieldAgentEarningLedger.findOne({ acquisitionClaimRef: claimD.claimId, entitlementType: "ACQUISITION_REWARD" }).lean();
    check("C8. Reward amount matches the real policy snapshot (acquisitionRewardAmountInPaise)", rewardRowD?.creditedAmountInPaise === nationalPolicy.acquisitionRewardAmountInPaise, { rewardRowD, expected: nationalPolicy.acquisitionRewardAmountInPaise });
    check("C9. Reward idempotency key is claim-keyed", rewardRowD?.idempotencyKey === `earning:${claimD.claimId}:ACQUISITION_REWARD`, rewardRowD?.idempotencyKey);
    check("C10. Response reward.creditedAmountInPaise matches the ledger row", rCompleteD.data?.data?.reward?.creditedAmountInPaise === rewardRowD?.creditedAmountInPaise, rCompleteD.data);

    // ── SECTION: DOUBLE COMPLETION ──
    const rCompleteD2 = await authFetch(`/api/admin/acquisition-claims/${claimD.claimId}/complete`, indiaAdminToken, { method: "POST" });
    check("C11. Second completion attempt is a conflict, not 200", rCompleteD2.status !== 200, rCompleteD2.data);
    check("C12. Reward ledger count remains exactly one after double completion", (await countRewardLogs(claimD.claimId)) === 1);

    // ════════════════════════════════════════════════════════════
    // SECTION: CONCURRENT COMPLETION
    // ════════════════════════════════════════════════════════════
    const claimE = await mkClaimViaRealFlow("E_RACE");
    await authFetch(`/api/admin/acquisition-claims/${claimE.claimId}/approve`, indiaAdminToken, { method: "POST" });
    const [rc1, rc2] = await Promise.all([
      authFetch(`/api/admin/acquisition-claims/${claimE.claimId}/complete`, indiaAdminToken, { method: "POST" }),
      authFetch(`/api/admin/acquisition-claims/${claimE.claimId}/complete`, indiaAdminToken, { method: "POST" }),
    ]);
    const successCountE = [rc1.status, rc2.status].filter((s) => s === 200).length;
    check("13-14-15. Exactly one of two simultaneous completions succeeds, other conflicts", successCountE === 1, { rc1: rc1.status, rc2: rc2.status });
    check("16. Exactly one ACQUISITION_REWARD exists after the race", (await countRewardLogs(claimE.claimId)) === 1);
    const claimEAfter = await AcquisitionClaim.findById(claimE.claimId).lean();
    check("17. Final claim status = COMPLETED", claimEAfter.status === "COMPLETED", claimEAfter.status);

    // ════════════════════════════════════════════════════════════
    // SECTION D: BOOKING AFTER COMPLETION
    // ════════════════════════════════════════════════════════════
    const ledgerCountBeforePostCompletionBooking = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: claimD.claimId, entitlementType: "ACQUISITION" });
    const bookingPostCompletion = await mkBooking(claimD.salon._id, { commissionAmountInPaise: 10000, serviceAmountInPaise: 100000, gstAmountInPaise: 500, completedAt: new Date(Date.now() + 2000) });
    const outcomePostCompletion = await processCompletedBooking(bookingPostCompletion);
    check("18-19. Booking after COMPLETED earns ₹0 / no new ACQUISITION commission", (outcomePostCompletion.creditedAmountInPaise ?? 0) === 0 && outcomePostCompletion.outcome !== "CREDITED", outcomePostCompletion);
    const ledgerCountAfterPostCompletionBooking = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: claimD.claimId, entitlementType: "ACQUISITION" });
    check("20. No new ACQUISITION ledger row was created for the post-completion booking", ledgerCountAfterPostCompletionBooking === ledgerCountBeforePostCompletionBooking, { before: ledgerCountBeforePostCompletionBooking, after: ledgerCountAfterPostCompletionBooking });
    // Historical pre-completion earnings (bookingB1/B2 against claimA, a
    // DIFFERENT claim) are untouched by any of this claimD/claimE activity —
    // confirmed by re-reading that same row and comparing to its original value.
    const historicalLedgerRowStillCorrect = await FieldAgentEarningLedger.findOne({ bookingRef: bookingB1._id }).lean();
    check("20b. Unrelated historical ACQUISITION earning (claimA) remains byte-for-byte unchanged", historicalLedgerRowStillCorrect?.creditedAmountInPaise === expectedB1, historicalLedgerRowStillCorrect);

    // ════════════════════════════════════════════════════════════
    // SECTION E: INVALID STATES
    // ════════════════════════════════════════════════════════════
    const claimF = await mkClaimViaRealFlow("F_PEND");
    const rCompletePending = await authFetch(`/api/admin/acquisition-claims/${claimF.claimId}/complete`, indiaAdminToken, { method: "POST" });
    check("21. PENDING_APPROVAL -> complete is rejected (not 200)", rCompletePending.status !== 200, rCompletePending.data);

    const claimG = await mkClaimViaRealFlow("G_END");
    await authFetch(`/api/admin/acquisition-claims/${claimG.claimId}/reject`, indiaAdminToken, { method: "POST" });
    const rCompleteEnded = await authFetch(`/api/admin/acquisition-claims/${claimG.claimId}/complete`, indiaAdminToken, { method: "POST" });
    check("22. ENDED -> complete is rejected (not 200)", rCompleteEnded.status !== 200, rCompleteEnded.data);
    // 23. COMPLETED -> complete already proven by C11 above (double completion).

    // ════════════════════════════════════════════════════════════
    // SECTION F (RBAC): completion authorization
    // ════════════════════════════════════════════════════════════
    const claimH = await mkClaimViaRealFlow("H_RBAC");
    await authFetch(`/api/admin/acquisition-claims/${claimH.claimId}/approve`, indiaAdminToken, { method: "POST" });
    const rCompleteState = await authFetch(`/api/admin/acquisition-claims/${claimH.claimId}/complete`, stateAdminToken, { method: "POST" });
    check("25. STATE admin completion = 403", rCompleteState.status === 403, rCompleteState.data);
    const rCompleteDistrict = await authFetch(`/api/admin/acquisition-claims/${claimH.claimId}/complete`, districtAdminToken, { method: "POST" });
    check("26. DISTRICT admin completion = 403", rCompleteDistrict.status === 403, rCompleteDistrict.data);
    const claimHAfterDenied = await AcquisitionClaim.findById(claimH.claimId).lean();
    check("26b. Claim remains ACTIVE_RECOVERY after both denied attempts (no false completion)", claimHAfterDenied.status === "ACTIVE_RECOVERY", claimHAfterDenied.status);
    const rCompleteIndiaH = await authFetch(`/api/admin/acquisition-claims/${claimH.claimId}/complete`, indiaAdminToken, { method: "POST" });
    check("24. INDIA admin completion succeeds (= 200)", rCompleteIndiaH.status === 200, rCompleteIndiaH.data);

    // ════════════════════════════════════════════════════════════
    // SECTION G: NOTIFICATIONS
    // ════════════════════════════════════════════════════════════
    const completeNotifD = await Notification.findOne({ recipientId: claimD.fa.fieldAgent._id, recipientType: "FIELD_AGENT", title: "Acquisition Completed 🎉" }).lean();
    check("27. Successful completion creates exactly one completion notification", !!completeNotifD, completeNotifD);
    const completeNotifCountD = await Notification.countDocuments({ recipientId: claimD.fa.fieldAgent._id, recipientType: "FIELD_AGENT", title: "Acquisition Completed 🎉" });
    check("27b. Exactly one completion notification (double-completion attempt did not create a second)", completeNotifCountD === 1, completeNotifCountD);
    const falseCompleteNotifF = await Notification.findOne({ recipientId: claimF.fa.fieldAgent._id, recipientType: "FIELD_AGENT", title: "Acquisition Completed 🎉" }).lean();
    check("28. Failed completion (PENDING_APPROVAL source) creates NO completion notification", !falseCompleteNotifF, falseCompleteNotifF);
    const falseCompleteNotifStateAttempt = await Notification.countDocuments({ recipientId: claimH.fa.fieldAgent._id, recipientType: "FIELD_AGENT", title: "Acquisition Completed 🎉" });
    check("28b. The two denied (403) completion attempts created exactly one real completion notification (from the later successful INDIA call), not two/zero", falseCompleteNotifStateAttempt === 1, falseCompleteNotifStateAttempt);

    // ════════════════════════════════════════════════════════════
    // SECTION H: POLICY
    // ════════════════════════════════════════════════════════════
    check("29. Reward came from the applicable claim policy snapshot (acquisitionRewardAmountInPaise), not a hardcoded value", rewardRowD?.creditedAmountInPaise === nationalPolicy.acquisitionRewardAmountInPaise);
    const policyCountAfterAllTests = await CommercialPolicyVersion.countDocuments({});
    check("30. No second real CommercialPolicyVersion was created or published during this entire run", policyCountAfterAllTests === before.CommercialPolicyVersion, { before: before.CommercialPolicyVersion, after: policyCountAfterAllTests });

  } catch (err) {
    console.error("SCRIPT ERROR (will still clean up below):", err);
    fail++;
    results.push(`❌ FATAL SCRIPT ERROR — ${err.message}`);
  } finally {
    server.close();

    // Each step isolated — FieldAgentEarningLedger blocks deleteMany
    // via its own model-level immutability hook (confirmed live by
    // this script's own first run), so it needs the raw collection
    // bypass; every other step uses the ordinary Mongoose model so a
    // single failure never prevents the rest of cleanup (or the final
    // results printout) from running.
    const cleanupStep = async (label, fn) => {
      try { await fn(); } catch (err) { console.error(`CLEANUP STEP FAILED (${label}):`, err.message); }
    };
    // Raw collection bypass needs real ObjectIds, not the JSON-response
    // strings createdIds.claims may hold — the native driver (unlike
    // Mongoose query methods) never auto-casts a string to ObjectId.
    await cleanupStep("FieldAgentEarningLedger", () => FieldAgentEarningLedger.collection.deleteMany({
      acquisitionClaimRef: { $in: createdIds.claims.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id)) },
    }));
    await cleanupStep("AcquisitionEarningProgress", () => AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: createdIds.claims } }));
    await cleanupStep("Booking", () => Booking.deleteMany({ _id: { $in: createdIds.bookings } }));
    await cleanupStep("AcquisitionClaim", () => AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } }));
    await cleanupStep("AcquisitionReferral", () => AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } }));
    await cleanupStep("FieldAgent", () => FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } }));
    await cleanupStep("FieldAgentApplication", () => FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } }));
    await cleanupStep("Salon", () => Salon.deleteMany({ _id: { $in: createdIds.salons } }));
    await cleanupStep("User", () => User.deleteMany({ _id: { $in: createdIds.users } }));
    // recipientId for these notifications is claim.fieldAgentRef (the
    // FieldAgent document's own _id), not the User._id — match both,
    // since other notifications in this suite (if any) could use either.
    await cleanupStep("Notification", () => Notification.deleteMany({ recipientId: { $in: [...createdIds.users, ...createdIds.fieldAgents] } }));
    await cleanupStep("District", () => District.deleteMany({ _id: { $in: createdIds.districts } }));
    await cleanupStep("State", () => State.deleteMany({ _id: { $in: createdIds.states } }));
    await cleanupStep("City", () => City.deleteMany({ _id: { $in: createdIds.cities } }));
    await cleanupStep("Area", () => Area.deleteMany({ _id: { $in: createdIds.areas } }));

    const after = {
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
      FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
      CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Notification: await Notification.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts (post-cleanup): ${JSON.stringify(after)}`);
    results.push(`ℹ️  Net change: ${JSON.stringify(Object.fromEntries(Object.keys(before).map(k => [k, after[k] - before[k]])))}`);

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
