/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentAcquisitionRewardPhaseA.js
 *
 * FA-9 PHASE A — Field Agent fixed, one-time Salon Acquisition Reward.
 * Real Mongo Atlas, real service-layer calls (createDraftPolicyVersion/
 * publishPolicyVersion/issueReferral/redeemReferral/adminApproveClaim/
 * processCompletedBooking) — no HTTP server needed, since every
 * function under test is a plain backend service function, exactly
 * the same direct-function-call methodology already proven safe in
 * this suite's earlier Platform-Fee-slab verification scripts.
 *
 * SAFETY (the Platform Fee incident lesson, never to be repeated):
 * before touching CommercialPolicyVersion.status=PUBLISHED at all,
 * this script aborts immediately if ANY PUBLISHED CommercialPolicyVersion
 * already exists in this environment — publishing a test draft would
 * otherwise retire a REAL admin's live policy as a side effect. The
 * read-only audit earlier this phase confirmed this count is 0 today;
 * this guard makes that assumption load-bearing instead of implicit.
 *
 * Test matrix (A-L from the implementation ticket):
 *   A. Policy field acceptance (real createDraftPolicyVersion/publish)
 *   B. Snapshot-at-creation, never re-resolved from a newer policy
 *   C. One-time reward credited on approval
 *   D. Duplicate approval attempt -> rejected, no second reward
 *   E. Concurrent approval attempts -> exactly one reward
 *   F. Claim -> COMPLETED on success
 *   G. Claim NOT completed on simulated reward-resolution failure
 *   H. Booking commission normal while (legacy) ACTIVE_RECOVERY
 *   I. ₹0 booking commission after COMPLETED
 *   J. No double-payment between the reward and the old cumulative
 *      mechanism, for both a real Phase-A claim and a simulated legacy one
 *   K. Historical policy document (missing the new field) handled safely
 *   L. Historical (booking-keyed) ledger rows remain unchanged in shape
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentAcquisitionRewardPhaseA.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../../models/Booking.js";

import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../../modules/fieldAgent/models/CommercialPolicyOverride.js";

import { generateAccessToken } from "../../services/token.service.js";
import { makeGeoFixture, makeSalonFixture, makeActiveFieldAgent, nextPhone, oid } from "./fieldAgentE2EHelpers.js";

import { createDraftPolicyVersion, publishPolicyVersion, retirePolicyVersion } from "../../modules/fieldAgent/services/commercialPolicy.service.js";
import { issueReferral, redeemReferral, adminApproveClaim } from "../../modules/fieldAgent/services/acquisitionClaim.service.js";
import { createAcquisitionEarningProgressForClaim, creditAcquisitionRewardForClaim, processCompletedBooking } from "../../modules/fieldAgent/services/fieldAgentEarning.service.js";
import { listPolicyVersions, getPolicyVersionDetail } from "../../modules/fieldAgent/services/commercialPolicy.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail, (k, v) => (v instanceof Date ? v.toISOString() : v)).slice(0, 500) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], policies: [], progress: [], ledger: [], bookings: [] };

const mkClaim = async (label, geo) => {
  const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, label);
  createdIds.users.push(fa.agentUser._id);
  createdIds.applications.push(fa.application._id);
  createdIds.fieldAgents.push(fa.fieldAgent._id);

  const { owner, salon } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
  createdIds.salons.push(salon._id);

  const referral = await issueReferral({ userId: fa.agentUser._id });
  createdIds.referrals.push(referral._id);

  const { claim } = await redeemReferral({ ownerId: owner._id, referralCode: referral.code });
  createdIds.claims.push(claim._id);

  return { fa, owner, salon, claim };
};

const mkBooking = async (salonId, commissionAmountInPaise, completedAt = new Date()) => {
  const booking = await Booking.create({
    userRef: oid(), salonRef: salonId, chairRef: oid(), serviceRefs: [oid()],
    bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000),
    serviceDuration: 30, status: BOOKING_STATUS.HOLD, commissionAmountInPaise,
  });
  await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.COMPLETED, completedAt } });
  createdIds.bookings.push(booking._id);
  return { _id: booking._id, salonRef: salonId, commissionAmountInPaise, completedAt };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  await connectDB();
  let geo = null;

  try {
    // ═══════════════════════════════════════════════════════════
    // SAFETY GUARD — see file header. Never repeat the Platform Fee
    // incident: refuse to publish anything if a real policy already
    // lives in this environment.
    // ═══════════════════════════════════════════════════════════
    const preExistingPublished = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    const preExistingTotal = await CommercialPolicyVersion.countDocuments({});
    if (preExistingPublished !== 0) {
      throw new Error(`SAFETY ABORT: ${preExistingPublished} PUBLISHED CommercialPolicyVersion document(s) already exist — refusing to run (would retire a real live policy). Audit manually first.`);
    }
    results.push(`ℹ️  Pre-existing CommercialPolicyVersion count: ${preExistingTotal} (0 published, confirmed safe to proceed)`);

    const before = {
      CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
      CommercialPolicyOverride: await CommercialPolicyOverride.countDocuments({}),
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
      FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    };
    results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

    const adminId = oid();
    geo = await makeGeoFixture({ Country, State, District, City, Area }, `PHASEA${Date.now() % 100000}`);

    // ═══════════════════════════════════════════════════════════
    // A — POLICY FIELD ACCEPTANCE (real service/validator-reachable
    // path: createDraftPolicyVersion + publishPolicyVersion, not a
    // raw .create()).
    // ═══════════════════════════════════════════════════════════
    const draftV1 = await createDraftPolicyVersion({
      adminId,
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 100000,
      acquisitionRewardAmountInPaise: 20000, // ₹200
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
    });
    createdIds.policies.push(draftV1._id);
    check("A1. createDraftPolicyVersion accepts acquisitionRewardAmountInPaise and persists it", draftV1.acquisitionRewardAmountInPaise === 20000, draftV1.acquisitionRewardAmountInPaise);

    const v1 = await publishPolicyVersion({ versionId: draftV1._id, adminId });
    check("A2. publishPolicyVersion succeeds with the new field present", v1.status === "PUBLISHED" && v1.acquisitionRewardAmountInPaise === 20000, v1);

    await sleep(20); // ensure claim.createdAt is strictly after V1.publishedAt

    // ═══════════════════════════════════════════════════════════
    // C/F — ONE-TIME REWARD ON APPROVAL, CLAIM -> COMPLETED (happy path)
    // ═══════════════════════════════════════════════════════════
    const s1 = await mkClaim("PA1", geo);
    check("setup. claim1 created PENDING_APPROVAL", s1.claim.status === "PENDING_APPROVAL", s1.claim.status);

    const approved1 = await adminApproveClaim({ adminId, claimId: s1.claim._id });
    check("F1. adminApproveClaim transitions claim -> COMPLETED (not ACTIVE_RECOVERY)", approved1.status === "COMPLETED", approved1.status);

    const ledgerRows1 = await FieldAgentEarningLedger.find({ acquisitionClaimRef: s1.claim._id }).lean();
    createdIds.ledger.push(...ledgerRows1.map((r) => r._id));
    check("C1. Exactly one ledger row created for claim1", ledgerRows1.length === 1, ledgerRows1.length);
    const reward1 = ledgerRows1[0];
    check("C2. entitlementType === ACQUISITION_REWARD", reward1?.entitlementType === "ACQUISITION_REWARD", reward1?.entitlementType);
    check("C3. creditedAmountInPaise === 20000 (V1's reward, correctly snapshotted)", reward1?.creditedAmountInPaise === 20000, reward1?.creditedAmountInPaise);
    check("C4. idempotencyKey is claim-keyed, not booking-keyed", reward1?.idempotencyKey === `earning:${s1.claim._id}:ACQUISITION_REWARD`, reward1?.idempotencyKey);
    check("C5. bookingRef is null (not booking-keyed)", reward1?.bookingRef === null || reward1?.bookingRef === undefined, reward1?.bookingRef);
    check("C6. appliedRatePercent/bookingCommissionAmountInPaise/rawEligibleAmountInPaise/bookingCompletedAt all null", [reward1?.appliedRatePercent, reward1?.bookingCommissionAmountInPaise, reward1?.rawEligibleAmountInPaise, reward1?.bookingCompletedAt].every((v) => v === null || v === undefined), reward1);
    check("C7. fieldAgentRef matches the claim's own agent", String(reward1?.fieldAgentRef) === String(s1.fa.fieldAgent._id), reward1?.fieldAgentRef);

    // ═══════════════════════════════════════════════════════════
    // D — DUPLICATE APPROVAL ATTEMPT
    // ═══════════════════════════════════════════════════════════
    let duplicateErr = null;
    try { await adminApproveClaim({ adminId, claimId: s1.claim._id }); } catch (err) { duplicateErr = err; }
    check("D1. Re-approving an already-COMPLETED claim throws (conflict)", !!duplicateErr, duplicateErr?.message);
    const ledgerRowsAfterDuplicate = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: s1.claim._id });
    check("D2. Still exactly one ledger row after the duplicate attempt", ledgerRowsAfterDuplicate === 1, ledgerRowsAfterDuplicate);

    // ═══════════════════════════════════════════════════════════
    // B — SNAPSHOT AT CREATION, NEVER RE-RESOLVED FROM A NEWER POLICY.
    // claim1b is created while V1 is still the sole PUBLISHED policy;
    // V2 (a different reward amount) is then published BEFORE claim1b
    // is approved. Approval must NOT silently use V2's value — the
    // resolver is pinned to claim.createdAt, so once V1 is retired it
    // can no longer resolve ANYTHING for claim1b (GAP, not a wrong
    // value) — approval must abort, never credit ₹500.
    // ═══════════════════════════════════════════════════════════
    const s1b = await mkClaim("PA1B", geo);

    const draftV2 = await createDraftPolicyVersion({
      adminId,
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 100000,
      acquisitionRewardAmountInPaise: 50000, // ₹500 — deliberately different from V1's ₹200
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
    });
    createdIds.policies.push(draftV2._id);
    const v2 = await publishPolicyVersion({ versionId: draftV2._id, adminId }); // retires V1 atomically
    check("setup. publishing V2 retires V1", v2.status === "PUBLISHED", v2.status);
    const v1Retired = await CommercialPolicyVersion.findById(v1._id).lean();
    check("setup. V1 is now RETIRED", v1Retired?.status === "RETIRED", v1Retired?.status);

    let snapshotErr = null;
    try { await adminApproveClaim({ adminId, claimId: s1b.claim._id }); } catch (err) { snapshotErr = err; }
    check("B1. Approving claim1b (created under V1, now retired) ABORTS rather than crediting V2's ₹500", !!snapshotErr, snapshotErr?.message);
    const claim1bAfter = await AcquisitionClaim.findById(s1b.claim._id).lean();
    check("B2. claim1b remains PENDING_APPROVAL (full rollback, not left ACTIVE_RECOVERY)", claim1bAfter?.status === "PENDING_APPROVAL", claim1bAfter?.status);
    const ledgerRows1b = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: s1b.claim._id });
    check("B3. Zero ledger rows for claim1b (never credited ₹500, or anything)", ledgerRows1b === 0, ledgerRows1b);

    // ═══════════════════════════════════════════════════════════
    // E — CONCURRENT APPROVAL ATTEMPTS (claim2, created under V2)
    // ═══════════════════════════════════════════════════════════
    const s2 = await mkClaim("PA2", geo);
    const concurrentResults = await Promise.allSettled([
      adminApproveClaim({ adminId, claimId: s2.claim._id }),
      adminApproveClaim({ adminId, claimId: s2.claim._id }),
    ]);
    const fulfilled = concurrentResults.filter((r) => r.status === "fulfilled");
    const rejected = concurrentResults.filter((r) => r.status === "rejected");
    check("E1. Exactly one concurrent approval attempt succeeds", fulfilled.length === 1, concurrentResults.map((r) => r.status));
    check("E2. Exactly one concurrent approval attempt is rejected", rejected.length === 1, concurrentResults.map((r) => r.status));
    const ledgerRows2 = await FieldAgentEarningLedger.find({ acquisitionClaimRef: s2.claim._id }).lean();
    createdIds.ledger.push(...ledgerRows2.map((r) => r._id));
    check("E3. Exactly one ledger row for claim2 despite the race", ledgerRows2.length === 1, ledgerRows2.length);
    check("E4. claim2's credited reward is V2's ₹500", ledgerRows2[0]?.creditedAmountInPaise === 50000, ledgerRows2[0]?.creditedAmountInPaise);

    // ═══════════════════════════════════════════════════════════
    // G — NO APPLICABLE POLICY AT ALL -> ABORT, CLAIM NOT COMPLETED
    // ═══════════════════════════════════════════════════════════
    await retirePolicyVersion({ versionId: v2._id, adminId, reason: "ZE2E_PHASEA — temporarily retiring to test the no-policy-at-all path" });
    const publishedCountNow = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("setup. Zero PUBLISHED policies now (V2 retired, confirms test isolation)", publishedCountNow === 0, publishedCountNow);

    const s3 = await mkClaim("PA3", geo);
    let noPolicyErr = null;
    try { await adminApproveClaim({ adminId, claimId: s3.claim._id }); } catch (err) { noPolicyErr = err; }
    check("G1. Approving claim3 with NO published policy at all throws", !!noPolicyErr, noPolicyErr?.message);
    const claim3After = await AcquisitionClaim.findById(s3.claim._id).lean();
    check("G2. claim3 remains PENDING_APPROVAL (not ACTIVE_RECOVERY, not COMPLETED)", claim3After?.status === "PENDING_APPROVAL", claim3After?.status);
    const ledgerRows3 = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: s3.claim._id });
    check("G3. Zero ledger rows for claim3", ledgerRows3 === 0, ledgerRows3);

    // ═══════════════════════════════════════════════════════════
    // K — HISTORICAL POLICY DOCUMENT MISSING THE NEW FIELD
    // Inserted directly (bypassing Mongoose validation) to simulate a
    // real pre-Phase-A document — the exact shape a historical
    // CommercialPolicyVersion would have. No other PUBLISHED policy
    // exists right now (confirmed above), so this is safe to insert
    // as the sole PUBLISHED policy without touching anything real.
    // ═══════════════════════════════════════════════════════════
    const legacyPolicyId = new mongoose.Types.ObjectId();
    await CommercialPolicyVersion.collection.insertOne({
      _id: legacyPolicyId,
      versionNumber: 999001 + Math.floor(Math.random() * 1000),
      status: "PUBLISHED",
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 100000,
      // acquisitionRewardAmountInPaise intentionally OMITTED — simulates a document created before this field existed.
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
      obligations: [], performanceFactors: [], coverageRules: [],
      minimumPayoutInPaise: 10000, autoPayoutEnabled: false,
      createdBy: adminId, publishedBy: adminId, retiredBy: null,
      publishedAt: new Date(Date.now() - 60000), retiredAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    createdIds.policies.push(legacyPolicyId);

    let listThrew = false, detailThrew = false;
    try { await listPolicyVersions({ page: 1, limit: 10 }); } catch { listThrew = true; }
    try { await getPolicyVersionDetail(legacyPolicyId); } catch { detailThrew = true; }
    check("K1. listPolicyVersions() does not throw with a legacy-shaped document present", !listThrew);
    check("K2. getPolicyVersionDetail() does not throw reading the legacy document directly", !detailThrew);

    const s4 = await mkClaim("PA4", geo);
    const legacyReward = await creditAcquisitionRewardForClaim({ claim: s4.claim, salon: s4.salon });
    check("K3. creditAcquisitionRewardForClaim returns null for a policy missing the field (never invents 0/NaN)", legacyReward === null, legacyReward);

    let legacyApproveErr = null;
    try { await adminApproveClaim({ adminId, claimId: s4.claim._id }); } catch (err) { legacyApproveErr = err; }
    check("K4. Full adminApproveClaim also aborts for a legacy policy missing the field", !!legacyApproveErr, legacyApproveErr?.message);
    const claim4After = await AcquisitionClaim.findById(s4.claim._id).lean();
    check("K5. claim4 remains PENDING_APPROVAL", claim4After?.status === "PENDING_APPROVAL", claim4After?.status);

    await CommercialPolicyVersion.deleteOne({ _id: legacyPolicyId }); // raw-inserted fixture, not append-only, safe to delete directly

    // ═══════════════════════════════════════════════════════════
    // H/I/J/L — OLD PER-BOOKING MECHANISM BACKWARD COMPATIBILITY,
    // and proof the OLD mechanism never double-pays a COMPLETED claim.
    // claim5 is pushed into ACTIVE_RECOVERY directly (never through
    // adminApproveClaim), simulating a legacy claim that predates
    // Phase A — exactly the state the OLD engine was designed around.
    // ═══════════════════════════════════════════════════════════
    const draftV3 = await createDraftPolicyVersion({
      adminId,
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 100000,
      acquisitionRewardAmountInPaise: 20000,
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
    });
    createdIds.policies.push(draftV3._id);
    await publishPolicyVersion({ versionId: draftV3._id, adminId });

    const s5 = await mkClaim("PA5", geo);
    await AcquisitionClaim.findOneAndUpdate({ _id: s5.claim._id }, { $set: { status: "ACTIVE_RECOVERY" } });
    const claim5Active = await AcquisitionClaim.findById(s5.claim._id).lean();
    const progress5 = await createAcquisitionEarningProgressForClaim({ claim: claim5Active, salon: s5.salon });
    check("setup. claim5 forced to ACTIVE_RECOVERY + progress snapshotted (simulated legacy state)", claim5Active?.status === "ACTIVE_RECOVERY" && !!progress5, { status: claim5Active?.status, progress: !!progress5 });

    const booking1 = await mkBooking(s5.salon._id, 10000); // ₹100 commission
    const outcome1 = await processCompletedBooking(booking1);
    check("H1. processCompletedBooking CREDITS normally while claim is ACTIVE_RECOVERY", outcome1.outcome === "CREDITED", outcome1);
    const ledgerRowsH = await FieldAgentEarningLedger.find({ acquisitionClaimRef: s5.claim._id }).lean();
    createdIds.ledger.push(...ledgerRowsH.map((r) => r._id));
    check("H2. Exactly one ACQUISITION ledger row created for booking1", ledgerRowsH.length === 1 && ledgerRowsH[0]?.entitlementType === "ACQUISITION", ledgerRowsH);
    check("L1. Historical/booking-keyed ledger row still has ALL booking-shaped fields populated (bookingRef/appliedRatePercent/bookingCommissionAmountInPaise/rawEligibleAmountInPaise/bookingCompletedAt)", !!ledgerRowsH[0]?.bookingRef && ledgerRowsH[0]?.appliedRatePercent === 10 && ledgerRowsH[0]?.bookingCommissionAmountInPaise === 10000 && ledgerRowsH[0]?.rawEligibleAmountInPaise === 1000 && !!ledgerRowsH[0]?.bookingCompletedAt, ledgerRowsH[0]);
    check("L2. creditedAmountInPaise === 1000 (10% of ₹100 commission, unaffected by the schema change)", ledgerRowsH[0]?.creditedAmountInPaise === 1000, ledgerRowsH[0]?.creditedAmountInPaise);

    // Now simulate Phase A's own end-state for this claim and confirm the OLD mechanism stops paying.
    await AcquisitionClaim.findOneAndUpdate({ _id: s5.claim._id }, { $set: { status: "COMPLETED" } });
    const booking2 = await mkBooking(s5.salon._id, 10000);
    const outcome2 = await processCompletedBooking(booking2);
    // No ACTIVE_RECOVERY claim exists for this salon anymore (claim5 is
    // COMPLETED) -> the unmodified fallthrough below correctly lands on
    // the pre-existing (and separately retired) Territory Partner path,
    // never on an acquisition credit. Either way, zero paise move.
    check("I1. processCompletedBooking credits ZERO once the claim is COMPLETED (no code change needed)", outcome2.outcome !== "CREDITED" && (outcome2.creditedAmountInPaise ?? 0) === 0, outcome2);
    const ledgerCount5After = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: s5.claim._id });
    check("J1. Ledger count for claim5 still exactly 1 — booking2 produced no second row (no double-payment)", ledgerCount5After === 1, ledgerCount5After);

    // And the symmetric check on the REAL Phase-A-approved claim1 (COMPLETED via adminApproveClaim, not simulated).
    const booking3 = await mkBooking(s1.salon._id, 10000);
    const outcome3 = await processCompletedBooking(booking3);
    check("J2. A REAL Phase-A-completed claim (claim1) also credits ZERO from the OLD mechanism — never double-paid", outcome3.outcome !== "CREDITED" && (outcome3.creditedAmountInPaise ?? 0) === 0, outcome3);
    const ledgerCount1After = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: s1.claim._id });
    check("J3. claim1's ledger count still exactly 1 (the ACQUISITION_REWARD row only)", ledgerCount1After === 1, ledgerCount1After);

    // ═══════════════════════════════════════════════════════════
    // CLEANUP — only this script's own tracked fixtures.
    // FieldAgentEarningLedger is append-only (blockMutation hooks) —
    // the native collection.deleteMany bypass is the established
    // idiom across this entire test suite.
    // ═══════════════════════════════════════════════════════════
    await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.ledger.filter(Boolean) } });
    // Covers every AcquisitionEarningProgress doc created for any of
    // this script's own claims, however it was created (explicitly via
    // createAcquisitionEarningProgressForClaim, or implicitly inside
    // adminApproveClaim's own transaction) — broader and more correct
    // than tracking individual _ids, since several call sites create
    // one without this script ever seeing the returned document.
    await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: createdIds.claims.filter(Boolean) } });
    await Booking.deleteMany({ _id: { $in: createdIds.bookings.filter(Boolean) } });
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents.filter(Boolean) } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications.filter(Boolean) } });
    await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });
    await CommercialPolicyVersion.deleteMany({ _id: { $in: createdIds.policies.filter(Boolean) } });
    await State.deleteOne({ _id: geo.state._id });
    await District.deleteOne({ _id: geo.district._id });
    await City.deleteOne({ _id: geo.city._id });
    await Area.deleteOne({ _id: geo.area._id });

    const after = {
      CommercialPolicyVersion: await CommercialPolicyVersion.countDocuments({}),
      CommercialPolicyOverride: await CommercialPolicyOverride.countDocuments({}),
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
      FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts: ${JSON.stringify(after)}`);
    check("CLEANUP. All 5 collection counts returned exactly to their BEFORE values", JSON.stringify(before) === JSON.stringify(after), { before, after });
    check("CLEANUP. CommercialPolicyOverride untouched (Phase A never writes it)", before.CommercialPolicyOverride === after.CommercialPolicyOverride && after.CommercialPolicyOverride === 0, after.CommercialPolicyOverride);
  } catch (err) {
    console.error("FATAL ERROR DURING FIELD AGENT ACQUISITION REWARD PHASE A E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.ledger.filter(Boolean) } });
      await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: createdIds.claims.filter(Boolean) } });
      await Booking.deleteMany({ _id: { $in: createdIds.bookings.filter(Boolean) } });
      await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
      await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
      await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents.filter(Boolean) } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications.filter(Boolean) } });
      await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });
      await CommercialPolicyVersion.deleteMany({ _id: { $in: createdIds.policies.filter(Boolean) } });
      if (geo) {
        await State.deleteOne({ _id: geo.state._id });
        await District.deleteOne({ _id: geo.district._id });
        await City.deleteOne({ _id: geo.city._id });
        await Area.deleteOne({ _id: geo.area._id });
      }
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nFIELD-AGENT-ACQUISITION-REWARD-PHASE-A-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
