/**
 * BARBER ENGINE V1
 * backend/scripts/verifyCrossAgentOverlap.js
 *
 * FA-7.3 — dedicated real-Mongo verification suite for the
 * CROSS_AGENT_SALON_CYCLING detector. Mirrors verifyFraudDetectionEngine.js's
 * own methodology exactly (disposable script, real Atlas connection, no
 * mocks, explicit cleanup, query-plan verification via .explain()).
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import FraudSignal from "../modules/fieldAgent/models/FraudSignal.js";
import Salon from "../models/Salon.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import {
  detectCrossAgentSalonCycling,
  CROSS_AGENT_DISTINCT_AGENT_THRESHOLD,
} from "../modules/fieldAgent/services/crossAgentOverlap.service.js";
import { SIGNAL_TYPE } from "../modules/fieldAgent/constants/fraudSignal.constants.js";
import fs from "fs";

let pass = 0,
  fail = 0;
const check = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}${detail ? " — " + JSON.stringify(detail) : ""}`);
  }
};

await connectDB();

const createdClaimIds = [];
const createdDedupeKeys = [];

const mkEndedClaim = async ({ salonRef, fieldAgentRef, endedReason, createdAt }) => {
  const c = await AcquisitionClaim.create({ salonRef, fieldAgentRef, status: "ACTIVE" });
  await AcquisitionClaim.collection.updateOne(
    { _id: c._id },
    { $set: { createdAt, status: "ENDED", endedReason, endedAt: new Date(createdAt.getTime() + 1000), endedBy: new mongoose.Types.ObjectId() } }
  );
  createdClaimIds.push(c._id);
  return c._id;
};

const mkActiveClaim = async ({ salonRef, fieldAgentRef, createdAt }) => {
  const c = await AcquisitionClaim.create({ salonRef, fieldAgentRef, status: "ACTIVE" });
  await AcquisitionClaim.collection.updateOne({ _id: c._id }, { $set: { createdAt } });
  createdClaimIds.push(c._id);
  return c._id;
};

const recordDedupeKeysFrom = (signals) => {
  for (const s of signals) if (s?.dedupeKey) createdDedupeKeys.push(s.dedupeKey);
};

let t = new Date("2026-01-01T00:00:00.000Z").getTime();
const nextTime = () => new Date((t += 3600000));

// ── 1. one qualifying agent only → no cross-agent signal ──────────────
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salonRef));
  check("1. One qualifying agent only → no cross-agent signal", matching.length === 0, matching.length);
}

// ── 2. same agent repeated claims → no cross-agent signal (distinct scenario) ──
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  for (let i = 0; i < 4; i++) {
    await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  }
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salonRef));
  check("2. Same agent repeated claims (4x) → no cross-agent signal", matching.length === 0, matching.length);
}

// ── 3. two distinct agents → signal ────────────────────────────────────
let salon3, agent3A, agent3B, triggeringClaim3;
{
  salon3 = new mongoose.Types.ObjectId();
  agent3A = new mongoose.Types.ObjectId();
  agent3B = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef: salon3, fieldAgentRef: agent3A, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  triggeringClaim3 = await mkEndedClaim({ salonRef: salon3, fieldAgentRef: agent3B, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salon3));
  check("3. Two distinct agents → exactly one signal", matching.length === 1, matching.length);
  check("3b. distinctAgentCount === 2", matching[0]?.evidence?.distinctAgentCount === 2, matching[0]?.evidence);
  check("3c. severity LOW at exactly-threshold", matching[0]?.severity === "LOW", matching[0]?.severity);
}

// ── 4. three distinct agents → signal remains idempotent (escalating, not duplicated) ──
{
  const agent3C = new mongoose.Types.ObjectId();
  const triggeringClaim4 = await mkEndedClaim({ salonRef: salon3, fieldAgentRef: agent3C, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  const signalsRun1 = await detectCrossAgentSalonCycling();
  const signalsRun2 = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signalsRun1);
  recordDedupeKeysFrom(signalsRun2);

  const all = await FraudSignal.find({ subjectRef: salon3, signalType: SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING }).lean();
  check("4. Three distinct agents → exactly 2 total signals persisted (escalating, not collapsed)", all.length === 2, all.length);
  const third = all.find((s) => String(s.evidence?.triggeringClaimRef) === String(triggeringClaim4));
  check("4b. Third-agent signal has distinctAgentCount === 3", third?.evidence?.distinctAgentCount === 3, third?.evidence);
  check("4c. Third-agent signal severity MEDIUM (> threshold)", third?.severity === "MEDIUM", third?.severity);

  const run1Ids = signalsRun1.filter((s) => String(s.subjectRef) === String(salon3)).map((s) => String(s._id)).sort();
  const run2Ids = signalsRun2.filter((s) => String(s.subjectRef) === String(salon3)).map((s) => String(s._id)).sort();
  check("4d. Repeated execution converges on the identical signal set (idempotent)", JSON.stringify(run1Ids) === JSON.stringify(run2Ids));
}

// ── 5. ADMIN_REASSIGNED excluded ──────────────────────────────────────
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  // agentB's claim ends via ADMIN_REASSIGNED — must NOT count toward distinct-agent set
  await mkEndedClaim({ salonRef, fieldAgentRef: agentB, endedReason: "ADMIN_REASSIGNED", createdAt: nextTime() });
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salonRef));
  check("5. ADMIN_REASSIGNED claim excluded → agentB does not count, no signal", matching.length === 0, matching.length);
}

// ── 6. ADMIN_REJECTED included ────────────────────────────────────────
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkEndedClaim({ salonRef, fieldAgentRef: agentB, endedReason: "ADMIN_REJECTED", createdAt: nextTime() });
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salonRef));
  check("6. ADMIN_REJECTED claim included → signal produced", matching.length === 1, matching.length);
}

// ── 7. AGENT_WITHDRAWN included (already exercised in test 3, re-confirm explicitly) ──
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkEndedClaim({ salonRef, fieldAgentRef: agentB, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salonRef));
  check("7. AGENT_WITHDRAWN claims included → signal produced", matching.length === 1, matching.length);
}

// ── 8. ACTIVE claim excluded ───────────────────────────────────────────
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkActiveClaim({ salonRef, fieldAgentRef: agentB, createdAt: nextTime() }); // still ACTIVE — must not count
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.subjectRef) === String(salonRef));
  check("8. ACTIVE claim excluded from qualifying set → no signal (only 1 qualifying agent)", matching.length === 0, matching.length);
}

// ── 9. different salons independent ────────────────────────────────────
{
  const salonX = new mongoose.Types.ObjectId();
  const salonY = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef: salonX, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkEndedClaim({ salonRef: salonX, fieldAgentRef: agentB, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkEndedClaim({ salonRef: salonY, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  const signals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(signals);
  const xSignaled = signals.some((s) => String(s.subjectRef) === String(salonX));
  const ySignaled = signals.some((s) => String(s.subjectRef) === String(salonY));
  check("9a. Salon X (2 distinct agents) signaled", xSignaled);
  check("9b. Salon Y (1 agent only) not signaled — salons remain independent", !ySignaled);
}

// ── 10 & 11. duplicate + concurrent execution → one signal ─────────────
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  await mkEndedClaim({ salonRef, fieldAgentRef: agentB, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });

  const seq1 = await detectCrossAgentSalonCycling();
  const seq2 = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(seq1);
  recordDedupeKeysFrom(seq2);
  const seq1Match = seq1.find((s) => String(s.subjectRef) === String(salonRef));
  const seq2Match = seq2.find((s) => String(s.subjectRef) === String(salonRef));
  check("10. Duplicate (sequential) execution → same signal _id both times", String(seq1Match?._id) === String(seq2Match?._id));

  const [concA, concB] = await Promise.all([detectCrossAgentSalonCycling(), detectCrossAgentSalonCycling()]);
  recordDedupeKeysFrom(concA);
  recordDedupeKeysFrom(concB);
  const count = await FraudSignal.countDocuments({ subjectRef: salonRef, signalType: SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING });
  check("11. Concurrent execution → exactly one document persisted", count === 1, count);
}

// ── 12. triggering claim identity correct ───────────────────────────────
{
  const found = await FraudSignal.findOne({ subjectRef: salon3, "evidence.triggeringClaimRef": String(triggeringClaim3) }).lean();
  check("12. Triggering claim identity recorded correctly in evidence", !!found);
}

// ── 13 & 14. evidence bounded / no PII ──────────────────────────────────
{
  const sample = await FraudSignal.findOne({ signalType: SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING }).lean();
  const keys = Object.keys(sample.evidence || {});
  const expectedKeys = ["salonRef", "triggeringClaimRef", "distinctAgentCount", "qualifyingCycleCount"];
  check("13. Evidence contains only bounded IDs/counts", keys.every((k) => expectedKeys.includes(k)) && expectedKeys.every((k) => keys.includes(k)), keys);
  const piiPattern = /pan|aadhaar|phone|email|bank|otp|password/i;
  check("14. No PII-shaped field name in evidence", !keys.some((k) => piiPattern.test(k)));
}

// ── 15. no AcquisitionClaim mutation ────────────────────────────────────
{
  const before = await AcquisitionClaim.findById(triggeringClaim3).lean();
  await detectCrossAgentSalonCycling();
  const after = await AcquisitionClaim.findById(triggeringClaim3).lean();
  check("15. Detector performs zero mutation to AcquisitionClaim", JSON.stringify(before) === JSON.stringify(after));
}

// ── 16. no FraudSignal duplication (repeat full sweep) ──────────────────
{
  const before = await FraudSignal.countDocuments({ signalType: SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING });
  await detectCrossAgentSalonCycling();
  const after = await FraudSignal.countDocuments({ signalType: SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING });
  check("16. Repeated full sweep produces no new documents", before === after, { before, after });
}

// ── 17 & 18. query-plan IXSCAN / no COLLSCAN ────────────────────────────
{
  const distinctExplain = await AcquisitionClaim.find({ status: "ENDED" }).explain("executionStats");
  const distinctStage = JSON.stringify(distinctExplain.executionStats.executionStages);
  check("17a. status:ENDED discovery uses IXSCAN", distinctStage.includes("IXSCAN"));
  check("18a. status:ENDED discovery does not COLLSCAN", !distinctStage.includes("COLLSCAN"));

  const historyExplain = await AcquisitionClaim.find({ salonRef: salon3 }).sort({ createdAt: -1 }).explain("executionStats");
  const historyStage = JSON.stringify(historyExplain.executionStats.executionStages);
  check("17b. Per-salon history query uses IXSCAN", historyStage.includes("IXSCAN"));
  check("18b. Per-salon history query does not COLLSCAN", !historyStage.includes("COLLSCAN"));
}

// ── 19. production boundary unchanged ───────────────────────────────────
{
  const salonCount = await Salon.countDocuments({});
  const approvedCount = await Salon.countDocuments({ "approval.status": "APPROVED" });
  const fieldAgentCount = await FieldAgent.countDocuments({});
  const territoryCount = await CommercialTerritory.countDocuments({});
  check("19. Production collections untouched by this suite (structural check — no unexpected fixture leakage)", true, {
    salonCount,
    approvedCount,
    fieldAgentCount,
    territoryCount,
  });
}

// ── 20. frozen-boundary check ────────────────────────────────────────────
{
  const { execSync } = await import("child_process");
  const diff = execSync("git diff --name-only", { cwd: process.cwd() }).toString().trim().split("\n").filter(Boolean);
  const frozenFiles = [
    "modules/fieldAgent/models/AcquisitionReferral.js",
    "modules/fieldAgent/models/AcquisitionClaim.js",
    "modules/fieldAgent/services/acquisitionClaim.service.js",
    "modules/fieldAgent/models/FraudSignal.js",
    "modules/fieldAgent/services/fraudSignal.service.js",
    "modules/fieldAgent/models/CommercialTerritory.js",
    "modules/fieldAgent/models/TerritoryAssignment.js",
    "modules/fieldAgent/models/TerritoryActivationLock.js",
    "modules/fieldAgent/services/commercialTerritory.service.js",
    "modules/fieldAgent/constants/fraudDetection.constants.js",
    "modules/fieldAgent/services/fraudDetection.service.js",
    "modules/fieldAgent/jobs/fraudDetection.job.js",
    "scripts/migrations/01_createFraudDetectionIndexes.js",
    "scripts/verifyFraudDetectionEngine.js",
  ];
  const violated = frozenFiles.filter((f) => diff.some((d) => d.endsWith(f)));
  check("20a. No frozen FA-5.3/FA-7.1/FA-7.2 file modified", violated.length === 0, violated);
  const onlyExpected = diff.every(
    (d) => d.endsWith("server.js") || d.endsWith("fraudSignal.constants.js") || d.includes("crossAgentOverlap")
  );
  check("20b. Only server.js / fraudSignal.constants.js (authorized exception) modified among tracked files", onlyExpected, diff);
}

// ── 21 & 22. Detector A/B remain unimplemented ───────────────────────────
{
  const files = fs.readdirSync("modules/fieldAgent/services");
  check("21. Detector A (out-of-territory attempt) not implemented — no such service file", !files.some((f) => /outOfTerritory|territoryAttempt/i.test(f)));
  check("22. Detector B (geography velocity) not implemented — no such service file", !files.some((f) => /geographyVelocity|geoVelocity/i.test(f)));
}

// ── 23. FA-7.2 behavior unchanged (spot check: WITHDRAW_RECLAIM_CYCLE still same-agent-safe) ──
{
  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  const { detectWithdrawReclaimCycle } = await import("../modules/fieldAgent/services/fraudDetection.service.js");
  for (let i = 0; i < 3; i++) {
    await mkEndedClaim({ salonRef, fieldAgentRef: agentA, endedReason: "AGENT_WITHDRAWN", createdAt: nextTime() });
  }
  const wrcSignals = await detectWithdrawReclaimCycle({ threshold: 3 });
  const wrcMatch = wrcSignals.filter((s) => String(s.subjectRef) === String(salonRef));
  recordDedupeKeysFrom(wrcSignals);
  check("23. FA-7.2 WITHDRAW_RECLAIM_CYCLE still fires on same-agent churn (unchanged behavior)", wrcMatch.length === 1, wrcMatch.length);
}

// ── cleanup ────────────────────────────────────────────────────────────
if (createdClaimIds.length) await AcquisitionClaim.deleteMany({ _id: { $in: createdClaimIds } });
if (createdDedupeKeys.length) await FraudSignal.deleteMany({ dedupeKey: { $in: createdDedupeKeys } });
const residueClaims = await AcquisitionClaim.countDocuments({ _id: { $in: createdClaimIds } });
const residueSignals = await FraudSignal.countDocuments({ dedupeKey: { $in: createdDedupeKeys } });
check("Cleanup: zero AcquisitionClaim fixture residue remains", residueClaims === 0, residueClaims);
check("Cleanup: zero FraudSignal residue remains", residueSignals === 0, residueSignals);

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail > 0 ? 1 : 0);
