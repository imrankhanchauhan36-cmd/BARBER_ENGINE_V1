/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentAttributionCommission.js
 *
 * FIELD AGENT ATTRIBUTION & COMMISSION AUDIT — live verification.
 *
 * Proves, against the real Atlas-backed dev server, that a Salon
 * created via Phase 1's REAL assisted-onboarding flow is correctly
 * attributed to the real Field Agent through the PRE-EXISTING,
 * unmodified FA-9 earning engine (AcquisitionClaim -> Booking
 * completion -> FieldAgentEarningLedger / AcquisitionEarningProgress)
 * — no new attribution system, no new commission system, no backend
 * change.
 *
 * FIXTURE METHODOLOGY (disclosed, reused — not reinvented): the
 * CommercialPolicyVersion and direct-Booking-document fixture shapes
 * are copied from the existing, already-proven
 * scripts/verifyFieldAgentEarningEngine.js (confirmed by reading it)
 * — same "HOLD, then raw collection.updateOne to COMPLETED+completedAt"
 * trick, same policy field shape. This script differs from that one
 * only in HOW the AcquisitionClaim is created: here it is created
 * through the REAL, live Phase 1 /assisted-onboarding/start endpoint
 * (not a direct AcquisitionClaim.create), since the entire point of
 * this audit is proving the NEW Phase 1-2C claim-creation path feeds
 * correctly into the OLD, frozen FA-9 earning engine.
 *
 * `processCompletedBooking` is called DIRECTLY (the same function
 * fieldAgentEarning.job.js's own background tick calls) rather than
 * running the full job tick — this avoids racing the REAL background
 * job (already running in this dev server's own separate process,
 * confirmed by server boot logs: "[FieldAgentEarningJob] Started")
 * over the same shared checkpoint document, while exercising the
 * exact same unit of work that job calls. Disclosed, not a different
 * code path.
 *
 * FA-9 PHASE A UPDATE: every claim here (A-E) needs to STAY in
 * ACTIVE_RECOVERY so the real per-booking attribution/commission
 * engine below has something to credit against — that is this
 * script's entire subject. adminApproveClaim is no longer the right
 * setup tool for that: Phase A now takes it straight through to
 * COMPLETED (paying the one-time Acquisition Reward and ending the
 * relationship) in one transaction, so claims A-E are pushed into
 * ACTIVE_RECOVERY directly instead (forceActiveRecovery, below) — the
 * same AcquisitionEarningProgress snapshot adminApproveClaim itself
 * would have created, just without also paying the reward/completing
 * the claim. adminApproveClaim itself is untouched, and is exercised
 * for real, for both the ACTIVE_RECOVERY and COMPLETED paths, by
 * verifyFieldAgentAcquisitionRewardPhaseA.js.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentAttributionCommission.js
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
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], policies: [], bookings: [], progress: [] };

// FA-9 PHASE A — see file header. Mirrors adminApproveClaim's own
// first step exactly (the conditional PENDING_APPROVAL ->
// ACTIVE_RECOVERY update), minus the reward-credit/COMPLETED half
// this script deliberately doesn't want.
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

const mkBooking = async (salon, { commissionAmountInPaise = 10000, completedAt = new Date() } = {}) => {
  const booking = await Booking.create({
    userRef: oid(), salonRef: salon, chairRef: oid(), serviceRefs: [oid()],
    bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000),
    serviceDuration: 30, status: BOOKING_STATUS.HOLD, commissionAmountInPaise,
  });
  await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.COMPLETED, completedAt } });
  createdIds.bookings.push(booking._id);
  return { _id: booking._id, salonRef: salon, commissionAmountInPaise, completedAt };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    // ═══════════════════════════════════════════════════════════
    // SETUP — a real, disposable, PUBLISHED CommercialPolicyVersion
    // (10% acquisition commission, ₹200 target — the exact real
    // "₹200 rule" value, mirrored from verifyFieldAgentEarningEngine.js's
    // own proven fixture), published in the past so every booking
    // below resolves it.
    // ═══════════════════════════════════════════════════════════
    const policy = await CommercialPolicyVersion.create({
      versionNumber: 900001 + Math.floor(Math.random() * 100000),
      status: "PUBLISHED",
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 20000, // "₹200"
      acquisitionRewardAmountInPaise: 20000, // FA-9 Phase A — ₹200, required since this field was introduced
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
      createdBy: oid(),
      publishedBy: oid(),
      publishedAt: new Date(Date.now() - 365 * 24 * 3600 * 1000),
      obligations: [{ key: "ZE2E_ATTRIBUTION_AUDIT", description: "Disposable audit fixture — safe to delete." }],
    });
    createdIds.policies.push(policy._id);

    const faA = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "ATTR_A");
    createdIds.users.push(faA.agentUser._id); createdIds.applications.push(faA.application._id); createdIds.fieldAgents.push(faA.fieldAgent._id);
    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "ATTR_B");
    createdIds.users.push(faB.agentUser._id); createdIds.applications.push(faB.application._id); createdIds.fieldAgents.push(faB.fieldAgent._id);

    const startAssisted = async (token, phone, { otp = "123456", createNewBranch = true } = {}) => {
      await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", token, { method: "POST", body: JSON.stringify({ phone }) });
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", token, {
        method: "POST", body: JSON.stringify({ phone, otp, createNewBranch }),
      });
      return res;
    };

    // ═══════════════════════════════════════════════════════════
    // SECTION 1-3 — real attribution via the real Phase 1 flow.
    // Agent A: Salon A (owner A), Salon B (owner A, same owner, same
    // agent). Agent B: Salon C (owner C, different owner).
    // ═══════════════════════════════════════════════════════════
    const ownerPhoneA = nextPhone("7");
    const startA = await startAssisted(faA.token, ownerPhoneA);
    const salonA = startA.data?.data?.salonId;
    const claimAId = startA.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonA); createdIds.claims.push(claimAId); createdIds.users.push(startA.data?.data?.ownerId);
    check("1.1 Salon A created via REAL Phase 1 flow, claim status PENDING_APPROVAL", !!salonA && startA.data?.data?.acquisitionClaim?.status === "PENDING_APPROVAL", startA.data?.data);
    {
      const claimDoc = await AcquisitionClaim.findById(claimAId).lean();
      check("2.1 AcquisitionClaim.salonRef === exact Salon A._id", String(claimDoc?.salonRef) === String(salonA), claimDoc);
      check("2.2 AcquisitionClaim.fieldAgentRef === authenticated Field Agent A._id", String(claimDoc?.fieldAgentRef) === String(faA.fieldAgent._id), claimDoc);
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
      const salonDoc = await Salon.findById(salonA).lean();
      check("2.3 Salon has NO fieldAgentId field (confirmed absent)", !("fieldAgentId" in (salonDoc || {})), Object.keys(salonDoc || {}));
    }
    // Forced to ACTIVE_RECOVERY + AcquisitionEarningProgress snapshot
    // (not adminApproveClaim — see file header: this script needs the
    // claim to STAY in ACTIVE_RECOVERY for its own per-booking subject).
    const { claim: approvedA, progress: progressA } = await forceActiveRecovery(claimAId, salonA);
    check("1.2 Claim A forced to ACTIVE_RECOVERY", approvedA?.status === "ACTIVE_RECOVERY", approvedA);
    check("7.1 AcquisitionEarningProgress snapshotted: target = ₹200 (20000 paise)", progressA?.targetInPaise === 20000, progressA);
    if (progressA?._id) createdIds.progress.push(progressA._id);

    await new Promise((r) => setTimeout(r, 31000)); // real OTP resend cooldown, same owner phone reused for branch

    const startB = await startAssisted(faA.token, ownerPhoneA); // SAME owner, SAME agent, NEW branch
    const salonB = startB.data?.data?.salonId;
    const claimBId = startB.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonB); createdIds.claims.push(claimBId);
    check("3.1 Salon B created for SAME owner, SAME agent (independent branch)", !!salonB && String(salonB) !== String(salonA) && startB.data?.data?.ownerId === startA.data?.data?.ownerId, { salonA, salonB });
    {
      const claimDoc = await AcquisitionClaim.findById(claimBId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    const { claim: approvedB } = await forceActiveRecovery(claimBId, salonB);
    check("3.2 Salon B's claim independently forced to ACTIVE_RECOVERY", approvedB?.status === "ACTIVE_RECOVERY", approvedB);

    const ownerPhoneC = nextPhone("7");
    const startC = await startAssisted(faB.token, ownerPhoneC);
    const salonC = startC.data?.data?.salonId;
    const claimCId = startC.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonC); createdIds.claims.push(claimCId); createdIds.users.push(startC.data?.data?.ownerId);
    check("3.3 Salon C created for Agent B (different owner, different agent)", !!salonC && String(claimCId) !== String(claimAId), startC.data?.data);
    {
      const claimDoc = await AcquisitionClaim.findById(claimCId).lean();
      check("2.4 Claim C correctly attributes Salon C -> Field Agent B (not A)", String(claimDoc?.fieldAgentRef) === String(faB.fieldAgent._id), claimDoc);
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    const { claim: approvedC } = await forceActiveRecovery(claimCId, salonC);
    check("3.4 Salon C's claim forced to ACTIVE_RECOVERY", approvedC?.status === "ACTIVE_RECOVERY", approvedC);

    // ═══════════════════════════════════════════════════════════
    // SECTION 8 — Owner X, two branches, TWO DIFFERENT agents.
    // ═══════════════════════════════════════════════════════════
    const ownerPhoneX = nextPhone("7");
    const startD = await startAssisted(faA.token, ownerPhoneX);
    const salonD = startD.data?.data?.salonId;
    const claimDId = startD.data?.data?.acquisitionClaim?.id;
    const ownerX = startD.data?.data?.ownerId;
    createdIds.salons.push(salonD); createdIds.claims.push(claimDId); createdIds.users.push(ownerX);
    {
      const claimDoc = await AcquisitionClaim.findById(claimDId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    await forceActiveRecovery(claimDId, salonD);

    await new Promise((r) => setTimeout(r, 31000));

    const startE = await startAssisted(faB.token, ownerPhoneX); // SAME owner X, DIFFERENT agent (B)
    const salonE = startE.data?.data?.salonId;
    const claimEId = startE.data?.data?.acquisitionClaim?.id;
    createdIds.salons.push(salonE); createdIds.claims.push(claimEId);
    check("8.1 Owner X's second branch (Salon E) attributed to Agent B, independent of Salon D/Agent A", startE.data?.data?.ownerId === ownerX && String(salonE) !== String(salonD), { ownerX, startEOwner: startE.data?.data?.ownerId, salonD, salonE });
    {
      const claimDoc = await AcquisitionClaim.findById(claimEId).lean();
      check("8.2 Claim E -> Field Agent B (Claim D remains -> Field Agent A)", String(claimDoc?.fieldAgentRef) === String(faB.fieldAgent._id), claimDoc);
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    const { claim: approvedE } = await forceActiveRecovery(claimEId, salonE);
    check("8.3 Salon E's claim forced to ACTIVE_RECOVERY", approvedE?.status === "ACTIVE_RECOVERY", approvedE);
    {
      const claimDDoc = await AcquisitionClaim.findById(claimDId).lean();
      check("8.4 Salon D's claim UNCHANGED (still Agent A) after Agent B's unrelated action", String(claimDDoc?.fieldAgentRef) === String(faA.fieldAgent._id), claimDDoc);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 4-7 — Booking -> Transaction -> Commission ->
    // Field Agent earning, for Salon A (the primary trace).
    // ═══════════════════════════════════════════════════════════
    const bookingA1 = await mkBooking(salonA, { commissionAmountInPaise: 100000 }); // platform commission ₹1000
    const outcomeA1 = await processCompletedBooking(bookingA1);
    check("4.1 processCompletedBooking -> CREDITED", outcomeA1.outcome === "CREDITED", outcomeA1);
    check("6.1 Field Agent A credited correctly (10% of ₹1000 commission = ₹100 = 10000 paise)", outcomeA1.creditedAmountInPaise === 10000, outcomeA1);
    {
      const ledgerRow = await FieldAgentEarningLedger.findOne({ bookingRef: bookingA1._id }).lean();
      check("5.1 Transaction/ledger row created: FieldAgentEarningLedger", !!ledgerRow, ledgerRow);
      check("5.2 Ledger row's fieldAgentRef === Field Agent A (not B)", String(ledgerRow?.fieldAgentRef) === String(faA.fieldAgent._id), ledgerRow);
      check("5.3 Ledger row's acquisitionClaimRef === Claim A", String(ledgerRow?.acquisitionClaimRef) === String(claimAId), ledgerRow);
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claimAId }).lean();
      check("7.2 AcquisitionEarningProgress.earnedInPaise updated to 10000", progress?.earnedInPaise === 10000, progress);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 9 — Duplicate earning protection: reprocess the SAME
    // booking (simulating a crash-retry / overlapping job tick).
    // ═══════════════════════════════════════════════════════════
    const outcomeA1Retry = await processCompletedBooking(bookingA1);
    check("9.1 Reprocessing the SAME booking returns the cached/idempotent outcome (alreadyProcessed)", outcomeA1Retry.alreadyProcessed === true, outcomeA1Retry);
    {
      const ledgerCount = await FieldAgentEarningLedger.countDocuments({ bookingRef: bookingA1._id });
      check("9.2 Exactly ONE ledger row exists despite reprocessing (no duplicate)", ledgerCount === 1, ledgerCount);
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claimAId }).lean();
      check("9.3 earnedInPaise NOT double-incremented (still 10000, not 20000)", progress?.earnedInPaise === 10000, progress);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 7 (cap) — a second Salon-A booking pushes past the
    // ₹200 target cap (200 remaining after the first ₹100 credit).
    // ═══════════════════════════════════════════════════════════
    const bookingA2 = await mkBooking(salonA, { commissionAmountInPaise: 500000, completedAt: new Date(bookingA1.completedAt.getTime() + 1000) }); // 10% = ₹500, way over the ₹100 remaining
    const outcomeA2 = await processCompletedBooking(bookingA2);
    check("7.3 Second booking CREDITED, capped at remaining target (not the full 10%)", outcomeA2.outcome === "CREDITED" && outcomeA2.creditedAmountInPaise === 10000, outcomeA2); // 20000 target - 10000 already earned = 10000 remaining
    {
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claimAId }).lean();
      check("7.4 Progress reaches TARGET_REACHED at exactly 20000 paise (₹200), never exceeds", progress?.earnedInPaise === 20000 && progress?.status === "TARGET_REACHED", progress);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 10 — CROSS-AGENT ISOLATION: complete a Salon C booking
    // (Agent B's salon) and verify Agent A receives ZERO attribution,
    // then a Salon B booking (Agent A's 2nd salon) and verify Agent B
    // receives ZERO attribution from it.
    // ═══════════════════════════════════════════════════════════
    const bookingC1 = await mkBooking(salonC, { commissionAmountInPaise: 50000 });
    const outcomeC1 = await processCompletedBooking(bookingC1);
    check("10.1 Salon C booking credited to Agent B", outcomeC1.outcome === "CREDITED" && String(outcomeC1.fieldAgentRef) === String(faB.fieldAgent._id), outcomeC1);
    {
      const agentALedgerFromC = await FieldAgentEarningLedger.countDocuments({ bookingRef: bookingC1._id, fieldAgentRef: faA.fieldAgent._id });
      check("10.2 Agent A receives ZERO ledger rows from Salon C's booking", agentALedgerFromC === 0, agentALedgerFromC);
    }

    const bookingB1 = await mkBooking(salonB, { commissionAmountInPaise: 50000 });
    const outcomeB1 = await processCompletedBooking(bookingB1);
    check("10.3 Salon B booking credited to Agent A (Salon B is Agent A's 2nd salon)", outcomeB1.outcome === "CREDITED" && String(outcomeB1.fieldAgentRef) === String(faA.fieldAgent._id), outcomeB1);
    {
      const agentBLedgerFromB = await FieldAgentEarningLedger.countDocuments({ bookingRef: bookingB1._id, fieldAgentRef: faB.fieldAgent._id });
      check("10.4 Agent B receives ZERO ledger rows from Salon B's booking", agentBLedgerFromB === 0, agentBLedgerFromB);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 11 — Same-owner-multi-salon-multi-agent isolation
    // (Owner X: Salon D -> Agent A, Salon E -> Agent B).
    // ═══════════════════════════════════════════════════════════
    const bookingD1 = await mkBooking(salonD, { commissionAmountInPaise: 50000 });
    const outcomeD1 = await processCompletedBooking(bookingD1);
    check("11.1 Owner X's Salon D booking credited ONLY to Agent A", outcomeD1.outcome === "CREDITED" && String(outcomeD1.fieldAgentRef) === String(faA.fieldAgent._id), outcomeD1);

    const bookingE1 = await mkBooking(salonE, { commissionAmountInPaise: 50000 });
    const outcomeE1 = await processCompletedBooking(bookingE1);
    check("11.2 Owner X's Salon E booking credited ONLY to Agent B", outcomeE1.outcome === "CREDITED" && String(outcomeE1.fieldAgentRef) === String(faB.fieldAgent._id), outcomeE1);
    check("11.3 Same owner (X), different agents per branch, both correctly isolated", String(outcomeD1.fieldAgentRef) !== String(outcomeE1.fieldAgentRef), { d: outcomeD1.fieldAgentRef, e: outcomeE1.fieldAgentRef });

  } finally {
    // FieldAgentEarningLedger rows are intentionally immutable at the
    // Mongoose level (a pre-hook blocks update/delete via the ORM —
    // confirmed live, a real and correct financial-integrity guard).
    // Same established precedent as verifyFieldAgentEarningEngine.js's
    // own cleanup: bypass the ORM guard via the raw driver collection,
    // exactly like mkBooking's own HOLD->COMPLETED transition already
    // does for the same reason.
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
