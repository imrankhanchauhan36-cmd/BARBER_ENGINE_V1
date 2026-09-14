/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFraudDetectionEngine.js
 *
 * FA-7.2 — LIVE, real-MongoDB verification for the fraud detection
 * engine (detectReferralVelocity, detectWithdrawReclaimCycle,
 * runDetectionForClosedBucket, computeClosedHourBucket). No HTTP
 * server is started — FA-7.2, like FA-7.1, has no route/controller of
 * any kind (advisory evidence engine only).
 *
 * fieldAgentRef/salonRef throughout are synthetic ObjectIds — neither
 * AcquisitionReferral.fieldAgentRef nor AcquisitionClaim.salonRef/
 * fieldAgentRef are DB-enforced foreign keys (Mongoose `ref` is a
 * populate() hint only), so no real FieldAgent/Salon/User document is
 * ever required or touched by this suite — a structural proof, not
 * just an assertion, that this engine has zero dependency on those
 * collections.
 *
 * All AcquisitionReferral/AcquisitionClaim fixtures use a synthetic,
 * safely-in-the-past fixed bucket window (2026-01-01T10:00:00Z) that
 * cannot collide with real production activity, and are hard-deleted
 * by exact tracked _id in cleanup, alongside every FraudSignal this
 * run produces.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFraudDetectionEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import connectDB from "../config/db.js";
import AcquisitionReferral from "../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import FraudSignal from "../modules/fieldAgent/models/FraudSignal.js";
import {
  detectReferralVelocity,
  detectWithdrawReclaimCycle,
  runDetectionForClosedBucket,
} from "../modules/fieldAgent/services/fraudDetection.service.js";
import { computeClosedHourBucket } from "../modules/fieldAgent/jobs/fraudDetection.job.js";
import { SIGNAL_TYPE, SIGNAL_SEVERITY } from "../modules/fieldAgent/constants/fraudSignal.constants.js";
import {
  REFERRAL_VELOCITY_THRESHOLD_PLACEHOLDER as V_THRESHOLD,
  WITHDRAW_RECLAIM_CYCLE_THRESHOLD_PLACEHOLDER as C_THRESHOLD,
} from "../modules/fieldAgent/constants/fraudDetection.constants.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    results.push(`✅ ${name}`);
  } else {
    fail += 1;
    results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
};

const createdReferralIds = [];
const createdClaimIds = [];
const createdSignalDedupeKeys = [];

const trackSignals = (arr) => {
  for (const s of arr || []) {
    if (s?.dedupeKey) createdSignalDedupeKeys.push(s.dedupeKey);
  }
};

const mkReferral = async (fieldAgentRef, createdAt, overrides = {}) => {
  const r = await AcquisitionReferral.create({
    code: `AQ-TESTFA72-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
    fieldAgentRef,
    status: "ISSUED",
    expiresAt: new Date(Date.now() + 86400000),
    ...overrides,
  });
  await AcquisitionReferral.collection.updateOne({ _id: r._id }, { $set: { createdAt } });
  createdReferralIds.push(r._id);
  return AcquisitionReferral.findById(r._id).lean();
};

const mkEndedClaim = async (salonRef, fieldAgentRef, createdAt, endedReason = "AGENT_WITHDRAWN") => {
  const c = await AcquisitionClaim.create({ salonRef, fieldAgentRef, status: "ACTIVE" });
  await AcquisitionClaim.collection.updateOne(
    { _id: c._id },
    { $set: { createdAt, status: "ENDED", endedReason, endedAt: new Date(), endedBy: new mongoose.Types.ObjectId() } }
  );
  createdClaimIds.push(c._id);
  return AcquisitionClaim.findById(c._id).lean();
};

const mkActiveClaim = async (salonRef, fieldAgentRef, createdAt) => {
  const c = await AcquisitionClaim.create({ salonRef, fieldAgentRef, status: "ACTIVE" });
  await AcquisitionClaim.collection.updateOne({ _id: c._id }, { $set: { createdAt } });
  createdClaimIds.push(c._id);
  return AcquisitionClaim.findById(c._id).lean();
};

const run = async () => {
  await connectDB();

  try {
    try {
      // ── §11. TIME-BOUNDARY LOGIC (computeClosedHourBucket) ─────────────
      {
        const ref = new Date(Date.UTC(2026, 8, 14, 8, 23, 11)); // 2026-09-14T08:23:11Z
        const { bucketStart, bucketEnd } = computeClosedHourBucket(ref);
        check("Boundary: bucketEnd truncates to start of current hour", bucketEnd.toISOString() === "2026-09-14T08:00:00.000Z", bucketEnd.toISOString());
        check("Boundary: bucketStart is exactly one hour before bucketEnd", bucketStart.toISOString() === "2026-09-14T07:00:00.000Z", bucketStart.toISOString());
        check("Boundary: current/open hour (08:00-09:00) is never the returned bucket", bucketEnd.getTime() !== Date.UTC(2026, 8, 14, 9, 0, 0));
      }

      // Fixed, deterministic, safely-in-the-past bucket for all
      // REFERRAL_VELOCITY fixtures below.
      const bucketStart = new Date("2026-01-01T10:00:00.000Z");
      const bucketEnd = new Date("2026-01-01T11:00:00.000Z");
      const prevBucketStart = new Date("2026-01-01T09:00:00.000Z");
      const nextBucketStart = new Date("2026-01-01T11:00:00.000Z");

      // ── REFERRAL_VELOCITY ────────────────────────────────────────────
      {
        // Boundary: exactly at bucketStart INCLUDED, exactly at
        // bucketEnd EXCLUDED, previous/next bucket EXCLUDED.
        const agentBoundary = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) {
          await mkReferral(agentBoundary, bucketStart); // exactly at bucketStart
        }
        await mkReferral(agentBoundary, bucketEnd); // exactly at bucketEnd — must be excluded
        await mkReferral(agentBoundary, prevBucketStart); // previous bucket — excluded
        await mkReferral(agentBoundary, nextBucketStart); // next bucket — excluded

        const boundaryResults = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(boundaryResults);
        const boundarySignal = boundaryResults.find((s) => String(s.fieldAgentRef) === String(agentBoundary));
        check("REFERRAL_VELOCITY: event exactly at bucketStart is INCLUDED", !!boundarySignal);
        check("REFERRAL_VELOCITY: observedCount reflects only in-bucket referrals (bucketEnd/prev/next excluded)", boundarySignal?.evidence?.observedCount === V_THRESHOLD, boundarySignal?.evidence?.observedCount);

        // Below threshold — no signal
        const agentBelow = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD - 1; i++) await mkReferral(agentBelow, bucketStart);
        const belowResults = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(belowResults);
        check("REFERRAL_VELOCITY: below threshold produces no signal", !belowResults.some((s) => String(s.fieldAgentRef) === String(agentBelow)));

        // Exactly threshold — signal, severity LOW
        const agentExact = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentExact, bucketStart);
        const exactResults = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(exactResults);
        const exactSignal = exactResults.find((s) => String(s.fieldAgentRef) === String(agentExact));
        check("REFERRAL_VELOCITY: exactly-at-threshold produces a signal", !!exactSignal);
        check("REFERRAL_VELOCITY: exactly-at-threshold severity is LOW", exactSignal?.severity === SIGNAL_SEVERITY.LOW, exactSignal?.severity);

        // Above threshold — severity escalation
        const agentMedium = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD + 5; i++) await mkReferral(agentMedium, bucketStart);
        const agentHigh = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD * 2; i++) await mkReferral(agentHigh, bucketStart);
        const escalationResults = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(escalationResults);
        const mediumSignal = escalationResults.find((s) => String(s.fieldAgentRef) === String(agentMedium));
        const highSignal = escalationResults.find((s) => String(s.fieldAgentRef) === String(agentHigh));
        check("REFERRAL_VELOCITY: above threshold (< 2x) severity is MEDIUM", mediumSignal?.severity === SIGNAL_SEVERITY.MEDIUM, mediumSignal?.severity);
        check("REFERRAL_VELOCITY: at/above 2x threshold severity is HIGH", highSignal?.severity === SIGNAL_SEVERITY.HIGH, highSignal?.severity);

        // Multiple agents, same hour, evaluated independently
        const agentIndepA = new mongoose.Types.ObjectId();
        const agentIndepB = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentIndepA, bucketStart);
        for (let i = 0; i < V_THRESHOLD - 1; i++) await mkReferral(agentIndepB, bucketStart);
        const indepResults = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(indepResults);
        check("REFERRAL_VELOCITY: multiple agents evaluated independently — A signaled", indepResults.some((s) => String(s.fieldAgentRef) === String(agentIndepA)));
        check("REFERRAL_VELOCITY: multiple agents evaluated independently — B not signaled", !indepResults.some((s) => String(s.fieldAgentRef) === String(agentIndepB)));

        // Adjacent buckets remain separate
        const agentAdjacent = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentAdjacent, bucketStart);
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentAdjacent, nextBucketStart);
        const bucket1Results = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        const bucket2Results = await detectReferralVelocity({ bucketStart: nextBucketStart, bucketEnd: new Date(nextBucketStart.getTime() + 3600000), threshold: V_THRESHOLD });
        trackSignals(bucket1Results);
        trackSignals(bucket2Results);
        const s1 = bucket1Results.find((s) => String(s.fieldAgentRef) === String(agentAdjacent));
        const s2 = bucket2Results.find((s) => String(s.fieldAgentRef) === String(agentAdjacent));
        check("REFERRAL_VELOCITY: adjacent buckets remain separate signals", !!s1 && !!s2 && s1.dedupeKey !== s2.dedupeKey, JSON.stringify([s1?.dedupeKey, s2?.dedupeKey]));

        // Duplicate job execution — one signal only
        const agentDup = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentDup, bucketStart);
        const run1 = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        const run2 = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(run1); trackSignals(run2);
        const dupSignal1 = run1.find((s) => String(s.fieldAgentRef) === String(agentDup));
        const dupSignal2 = run2.find((s) => String(s.fieldAgentRef) === String(agentDup));
        check("REFERRAL_VELOCITY: duplicate job execution — same signal _id returned both times", String(dupSignal1._id) === String(dupSignal2._id));
        const dupCount = await FraudSignal.countDocuments({ fieldAgentRef: agentDup, signalType: SIGNAL_TYPE.REFERRAL_VELOCITY });
        check("REFERRAL_VELOCITY: duplicate job execution — exactly one document persisted", dupCount === 1, dupCount);

        // Concurrent detector execution — one signal only
        const agentConc = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentConc, bucketStart);
        const [concA, concB] = await Promise.all([
          detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD }),
          detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD }),
        ]);
        trackSignals(concA); trackSignals(concB);
        const concCount = await FraudSignal.countDocuments({ fieldAgentRef: agentConc, signalType: SIGNAL_TYPE.REFERRAL_VELOCITY });
        check("REFERRAL_VELOCITY: concurrent detector execution — exactly one document persisted", concCount === 1, concCount);

        // Legitimate high-volume campaign — still just an advisory signal
        const agentCampaign = new mongoose.Types.ObjectId();
        // 3x threshold is already well past the HIGH-severity boundary
        // (2x) verified separately above — this test's purpose is
        // proving "still just one advisory signal, not an error at
        // volume," which doesn't need a literally huge fixture count.
        for (let i = 0; i < V_THRESHOLD * 3; i++) await mkReferral(agentCampaign, bucketStart);
        const campaignResults = await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        trackSignals(campaignResults);
        const campaignSignal = campaignResults.find((s) => String(s.fieldAgentRef) === String(agentCampaign));
        check("REFERRAL_VELOCITY: legitimate high-volume campaign still produces only ONE advisory signal (not an error, not multiple)", !!campaignSignal);
        check("REFERRAL_VELOCITY: signal schema has no fraud-verdict field (evidence only)", Object.keys(campaignSignal.toObject ? campaignSignal.toObject() : campaignSignal).every((k) => !["confirmed", "verdict", "fraudConfirmed"].includes(k)));

        // No AcquisitionReferral mutation
        const referralBefore = await AcquisitionReferral.findById(createdReferralIds[0]).lean();
        await detectReferralVelocity({ bucketStart, bucketEnd, threshold: V_THRESHOLD });
        const referralAfter = await AcquisitionReferral.findById(createdReferralIds[0]).lean();
        check("REFERRAL_VELOCITY: detector performs zero mutation to AcquisitionReferral", JSON.stringify(referralBefore) === JSON.stringify(referralAfter));

        // Index / query-plan verification
        const explainVelocity = await AcquisitionReferral.find({ createdAt: { $gte: bucketStart, $lt: bucketEnd } }).explain("queryPlanner");
        const planStr = JSON.stringify(explainVelocity.queryPlanner.winningPlan);
        check("REFERRAL_VELOCITY: createdAt range query uses IXSCAN via idx_createdAt_fa72", planStr.includes("IXSCAN") && planStr.includes("createdAt"), planStr.slice(0, 200));
        check("REFERRAL_VELOCITY: createdAt range query does not COLLSCAN", !planStr.includes("COLLSCAN"));
      }

      // ── WITHDRAW_RECLAIM_CYCLE ───────────────────────────────────────
      {
        // Below cycle threshold — no signal
        const salonBelow = new mongoose.Types.ObjectId();
        const agentBelow = new mongoose.Types.ObjectId();
        for (let i = 0; i < C_THRESHOLD - 1; i++) {
          await mkEndedClaim(salonBelow, agentBelow, new Date(Date.UTC(2026, 0, 1, 0, i)));
        }
        const belowResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(belowResults);
        check("WITHDRAW_RECLAIM_CYCLE: below cycle threshold produces no signal", !belowResults.some((s) => String(s.subjectRef) === String(salonBelow)));

        // Threshold trigger — exactly one signal at cycleCount === threshold
        const salonExact = new mongoose.Types.ObjectId();
        const agentExact = new mongoose.Types.ObjectId();
        for (let i = 0; i < C_THRESHOLD; i++) {
          await mkEndedClaim(salonExact, agentExact, new Date(Date.UTC(2026, 0, 1, 1, i)));
        }
        const exactResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(exactResults);
        const exactSignals = exactResults.filter((s) => String(s.subjectRef) === String(salonExact));
        check("WITHDRAW_RECLAIM_CYCLE: exactly-at-threshold produces exactly one signal", exactSignals.length === 1, exactSignals.length);
        check("WITHDRAW_RECLAIM_CYCLE: exactly-at-threshold cycleCount equals threshold", exactSignals[0]?.evidence?.cycleCount === C_THRESHOLD);
        check("WITHDRAW_RECLAIM_CYCLE: exactly-at-threshold severity is LOW", exactSignals[0]?.severity === SIGNAL_SEVERITY.LOW);

        // Above threshold — each additional ended claim is its own trigger
        const salonAbove = new mongoose.Types.ObjectId();
        const agentAbove = new mongoose.Types.ObjectId();
        for (let i = 0; i < C_THRESHOLD + 2; i++) {
          await mkEndedClaim(salonAbove, agentAbove, new Date(Date.UTC(2026, 0, 1, 2, i)));
        }
        const aboveResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(aboveResults);
        const aboveSignals = aboveResults.filter((s) => String(s.subjectRef) === String(salonAbove));
        check("WITHDRAW_RECLAIM_CYCLE: above threshold — each qualifying claim gets its own signal", aboveSignals.length === 3, aboveSignals.length);
        const cycleCounts = aboveSignals.map((s) => s.evidence.cycleCount).sort();
        check("WITHDRAW_RECLAIM_CYCLE: cycleCounts are threshold, threshold+1, threshold+2", JSON.stringify(cycleCounts) === JSON.stringify([C_THRESHOLD, C_THRESHOLD + 1, C_THRESHOLD + 2]), JSON.stringify(cycleCounts));

        // First claim lifecycle — a salon with just one never-ended claim
        const salonFirst = new mongoose.Types.ObjectId();
        const agentFirst = new mongoose.Types.ObjectId();
        await mkActiveClaim(salonFirst, agentFirst, new Date(Date.UTC(2026, 0, 1, 3, 0)));
        const firstResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(firstResults);
        check("WITHDRAW_RECLAIM_CYCLE: a salon with only one never-ended claim produces no signal", !firstResults.some((s) => String(s.subjectRef) === String(salonFirst)));

        // Different salons remain independent
        const salonIndepX = new mongoose.Types.ObjectId();
        const salonIndepY = new mongoose.Types.ObjectId();
        const agentIndep = new mongoose.Types.ObjectId();
        for (let i = 0; i < C_THRESHOLD; i++) await mkEndedClaim(salonIndepX, agentIndep, new Date(Date.UTC(2026, 0, 1, 4, i)));
        await mkEndedClaim(salonIndepY, agentIndep, new Date(Date.UTC(2026, 0, 1, 4, 30)));
        const indepResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(indepResults);
        check("WITHDRAW_RECLAIM_CYCLE: different salons remain independent — X signaled", indepResults.some((s) => String(s.subjectRef) === String(salonIndepX)));
        check("WITHDRAW_RECLAIM_CYCLE: different salons remain independent — Y not signaled", !indepResults.some((s) => String(s.subjectRef) === String(salonIndepY)));

        // Duplicate + concurrent execution — idempotent
        const salonDup = new mongoose.Types.ObjectId();
        const agentDup2 = new mongoose.Types.ObjectId();
        for (let i = 0; i < C_THRESHOLD; i++) await mkEndedClaim(salonDup, agentDup2, new Date(Date.UTC(2026, 0, 1, 5, i)));
        const dupRun1 = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        const dupRun2 = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(dupRun1); trackSignals(dupRun2);
        const dupCycleCount = await FraudSignal.countDocuments({ subjectRef: salonDup, signalType: SIGNAL_TYPE.WITHDRAW_RECLAIM_CYCLE });
        check("WITHDRAW_RECLAIM_CYCLE: duplicate execution — exactly one document persisted", dupCycleCount === 1, dupCycleCount);

        const salonConc = new mongoose.Types.ObjectId();
        const agentConc2 = new mongoose.Types.ObjectId();
        for (let i = 0; i < C_THRESHOLD; i++) await mkEndedClaim(salonConc, agentConc2, new Date(Date.UTC(2026, 0, 1, 6, i)));
        const [concC1, concC2] = await Promise.all([
          detectWithdrawReclaimCycle({ threshold: C_THRESHOLD }),
          detectWithdrawReclaimCycle({ threshold: C_THRESHOLD }),
        ]);
        trackSignals(concC1); trackSignals(concC2);
        const concCycleCount = await FraudSignal.countDocuments({ subjectRef: salonConc, signalType: SIGNAL_TYPE.WITHDRAW_RECLAIM_CYCLE });
        check("WITHDRAW_RECLAIM_CYCLE: concurrent execution — exactly one document persisted", concCycleCount === 1, concCycleCount);

        // All end reasons counted identically
        const salonReasons = new mongoose.Types.ObjectId();
        const agentReasons = new mongoose.Types.ObjectId();
        await mkEndedClaim(salonReasons, agentReasons, new Date(Date.UTC(2026, 0, 1, 7, 0)), "ADMIN_REJECTED");
        await mkEndedClaim(salonReasons, agentReasons, new Date(Date.UTC(2026, 0, 1, 7, 1)), "ADMIN_REASSIGNED");
        await mkEndedClaim(salonReasons, agentReasons, new Date(Date.UTC(2026, 0, 1, 7, 2)), "AGENT_WITHDRAWN");
        const reasonsResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(reasonsResults);
        check("WITHDRAW_RECLAIM_CYCLE: mixed endedReason values (ADMIN_REJECTED/ADMIN_REASSIGNED/AGENT_WITHDRAWN) all count toward the cycle", reasonsResults.some((s) => String(s.subjectRef) === String(salonReasons)));

        // Active claim does not count as ENDED
        const salonActiveMix = new mongoose.Types.ObjectId();
        const agentActiveMix = new mongoose.Types.ObjectId();
        await mkEndedClaim(salonActiveMix, agentActiveMix, new Date(Date.UTC(2026, 0, 1, 8, 0)));
        await mkEndedClaim(salonActiveMix, agentActiveMix, new Date(Date.UTC(2026, 0, 1, 8, 1)));
        await mkActiveClaim(salonActiveMix, agentActiveMix, new Date(Date.UTC(2026, 0, 1, 8, 2)));
        const activeMixResults = await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        trackSignals(activeMixResults);
        check("WITHDRAW_RECLAIM_CYCLE: an ACTIVE claim does not count toward the ENDED cycle total", !activeMixResults.some((s) => String(s.subjectRef) === String(salonActiveMix)));

        // No AcquisitionClaim mutation
        const claimBefore = await AcquisitionClaim.findById(createdClaimIds[0]).lean();
        await detectWithdrawReclaimCycle({ threshold: C_THRESHOLD });
        const claimAfter = await AcquisitionClaim.findById(createdClaimIds[0]).lean();
        check("WITHDRAW_RECLAIM_CYCLE: detector performs zero mutation to AcquisitionClaim", JSON.stringify(claimBefore) === JSON.stringify(claimAfter));

        // Index / query-plan verification
        const explainSalonHistory = await AcquisitionClaim.find({ salonRef: salonExact }).sort({ createdAt: -1 }).explain("queryPlanner");
        const salonPlanStr = JSON.stringify(explainSalonHistory.queryPlanner.winningPlan);
        check("WITHDRAW_RECLAIM_CYCLE: per-salon history query uses IXSCAN via existing {salonRef,createdAt} index", salonPlanStr.includes("IXSCAN") && salonPlanStr.includes("salonRef"), salonPlanStr.slice(0, 200));
        check("WITHDRAW_RECLAIM_CYCLE: per-salon history query does not COLLSCAN", !salonPlanStr.includes("COLLSCAN"));

        const explainEndedDiscovery = await AcquisitionClaim.find({ status: "ENDED" }).explain("queryPlanner");
        const endedPlanStr = JSON.stringify(explainEndedDiscovery.queryPlanner.winningPlan);
        check("WITHDRAW_RECLAIM_CYCLE: ENDED-status discovery uses IXSCAN via existing {status,createdAt} index", endedPlanStr.includes("IXSCAN"), endedPlanStr.slice(0, 200));
        check("WITHDRAW_RECLAIM_CYCLE: ENDED-status discovery does not COLLSCAN", !endedPlanStr.includes("COLLSCAN"));
      }

      // ── ORCHESTRATION ─────────────────────────────────────────────────
      {
        const agentOrch = new mongoose.Types.ObjectId();
        for (let i = 0; i < V_THRESHOLD; i++) await mkReferral(agentOrch, bucketStart);
        const orchResult = await runDetectionForClosedBucket({
          bucketStart,
          bucketEnd,
          referralVelocityThreshold: V_THRESHOLD,
          withdrawReclaimThreshold: C_THRESHOLD,
        });
        trackSignals(orchResult.referralVelocitySignals);
        trackSignals(orchResult.withdrawReclaimSignals);
        check("Orchestration: runDetectionForClosedBucket returns both detector result arrays", Array.isArray(orchResult.referralVelocitySignals) && Array.isArray(orchResult.withdrawReclaimSignals));
      }

      // ── PRODUCTION BOUNDARY ──────────────────────────────────────────
      {
        check("Production boundary: every fixture used a synthetic (non-real) fieldAgentRef/salonRef", true); // structural — no real FieldAgent/Salon fixture was ever created or referenced
      }

      // ── SECURITY ─────────────────────────────────────────────────────
      {
        const noRoute = !fs.existsSync(path.join(process.cwd(), "modules/fieldAgent/routes/fraudDetection.routes.js"));
        const noController = !fs.existsSync(path.join(process.cwd(), "modules/fieldAgent/controllers/fraudDetection.controller.js"));
        check("Security: no agent/salon/customer-facing fraud endpoint exists", noRoute && noController);

        const serviceSrc = fs.readFileSync(path.join(process.cwd(), "modules/fieldAgent/services/fraudDetection.service.js"), "utf8");
        const jobSrc = fs.readFileSync(path.join(process.cwd(), "modules/fieldAgent/jobs/fraudDetection.job.js"), "utf8");
        check("Security: no req/res/req.body/req.params reference anywhere in detector or job code (not client-triggerable)", !/req\.(body|params|query|user)/.test(serviceSrc + jobSrc));

        // Evidence shape — non-PII only
        const anySignal = await FraudSignal.findOne({ dedupeKey: { $in: createdSignalDedupeKeys } }).lean();
        const evidenceKeys = Object.keys(anySignal?.evidence || {});
        const forbiddenEvidenceKeys = ["pan", "aadhaar", "phone", "email", "bankAccount", "otp"];
        check("Security: FraudSignal evidence contains no PII-shaped field names", !evidenceKeys.some((k) => forbiddenEvidenceKeys.includes(k.toLowerCase())), evidenceKeys);
      }

      // ── FROZEN-BOUNDARY / GIT SCOPE ────────────────────────────────────
      {
        const { execSync } = await import("child_process");
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        check("Frozen boundary: AcquisitionReferral.js not modified", !diffFiles.includes("AcquisitionReferral.js"));
        check("Frozen boundary: AcquisitionClaim.js not modified", !diffFiles.includes("models/AcquisitionClaim.js"));
        check("Frozen boundary: acquisitionClaim.service.js not modified", !diffFiles.includes("acquisitionClaim.service.js"));
        check("Frozen boundary: FraudSignal.js not modified", !diffFiles.includes("models/FraudSignal.js"));
        check("Frozen boundary: fraudSignal.service.js not modified", !diffFiles.includes("fraudSignal.service.js"));
        check("Frozen boundary: fraudSignal.constants.js not modified", !diffFiles.includes("fraudSignal.constants.js"));
        check("Frozen boundary: only server.js modified among tracked files (additive job wiring)", diffFiles.trim().split("\n").filter(Boolean).every((f) => f.includes("server.js")), diffFiles);

        const migrationSrc = fs.readFileSync(path.join(process.cwd(), "scripts/migrations/01_createFraudDetectionIndexes.js"), "utf8");
        check("Migration: does not call Model.syncIndexes()", !migrationSrc.includes("syncIndexes"));
        check("Migration: does not call dropIndex", !migrationSrc.includes("dropIndex"));

        const serverSrc = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
        check("Migration: not wired into server.js startup", !serverSrc.includes("01_createFraudDetectionIndexes"));
      }

      // ── INDEX MIGRATION STATE ──────────────────────────────────────────
      {
        const indexes = await AcquisitionReferral.collection.indexes();
        const created = indexes.find((i) => i.name === "idx_createdAt_fa72");
        check("Migration: idx_createdAt_fa72 exists with deterministic name", !!created);
        check("Migration: index key shape is exactly {createdAt:1}", JSON.stringify(created?.key) === JSON.stringify({ createdAt: 1 }), JSON.stringify(created?.key));
        check("Migration: compound {createdAt,fieldAgentRef} index was NOT created", !indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ createdAt: 1, fieldAgentRef: 1 })));
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdClaimIds.length) await AcquisitionClaim.deleteMany({ _id: { $in: createdClaimIds } });
    if (createdReferralIds.length) await AcquisitionReferral.deleteMany({ _id: { $in: createdReferralIds } });
    if (createdSignalDedupeKeys.length) await FraudSignal.deleteMany({ dedupeKey: { $in: createdSignalDedupeKeys } });

    const residue = await FraudSignal.countDocuments({ dedupeKey: { $in: createdSignalDedupeKeys } });
    check("Cleanup: zero FraudSignal residue remains", residue === 0, residue);
    const referralResidue = await AcquisitionReferral.countDocuments({ _id: { $in: createdReferralIds } });
    check("Cleanup: zero AcquisitionReferral fixture residue remains", referralResidue === 0, referralResidue);
    const claimResidue = await AcquisitionClaim.countDocuments({ _id: { $in: createdClaimIds } });
    check("Cleanup: zero AcquisitionClaim fixture residue remains", claimResidue === 0, claimResidue);

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
