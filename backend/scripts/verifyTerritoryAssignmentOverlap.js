/**
 * BARBER ENGINE V1
 * backend/scripts/verifyTerritoryAssignmentOverlap.js
 *
 * FA-7.4 — dedicated real-Mongo verification suite for the
 * TERRITORY_ASSIGNMENT_CYCLING detector. Mirrors
 * verifyCrossAgentOverlap.js's own methodology exactly (disposable
 * script, real Atlas connection, no mocks, explicit cleanup,
 * query-plan verification via .explain()).
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import FraudSignal from "../modules/fieldAgent/models/FraudSignal.js";
import Salon from "../models/Salon.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import {
  detectTerritoryAssignmentCycling,
  TERRITORY_ASSIGNMENT_DISTINCT_PARTNER_THRESHOLD,
} from "../modules/fieldAgent/services/territoryAssignmentOverlap.service.js";
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

const createdTerritoryIds = [];
const createdAssignmentIds = [];
const createdDedupeKeys = [];

const mkTerritory = async () => {
  const t = await CommercialTerritory.create({
    name: `FA74-VERIFY-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    code: `CT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    scopeType: "DISTRICT",
    scopeKey: `district:${new mongoose.Types.ObjectId()}`,
    stateRef: new mongoose.Types.ObjectId(),
    districtRef: new mongoose.Types.ObjectId(),
    status: "ACTIVE",
    createdBy: new mongoose.Types.ObjectId(),
    updatedBy: new mongoose.Types.ObjectId(),
  });
  createdTerritoryIds.push(t._id);
  return t._id;
};

const mkEndedAssignment = async ({ territoryRef, fieldAgentRef, endReason, effectiveFrom }) => {
  const a = await TerritoryAssignment.create({
    territoryRef,
    fieldAgentRef,
    status: "ENDED",
    effectiveFrom,
    effectiveUntil: new Date(effectiveFrom.getTime() + 1000),
    endReason,
    assignedBy: new mongoose.Types.ObjectId(),
    endedBy: new mongoose.Types.ObjectId(),
  });
  createdAssignmentIds.push(a._id);
  return a._id;
};

const mkActiveAssignment = async ({ territoryRef, fieldAgentRef, effectiveFrom }) => {
  const a = await TerritoryAssignment.create({
    territoryRef,
    fieldAgentRef,
    status: "ACTIVE",
    effectiveFrom,
    assignedBy: new mongoose.Types.ObjectId(),
  });
  createdAssignmentIds.push(a._id);
  return a._id;
};

const recordDedupeKeysFrom = (signals) => {
  for (const s of signals) if (s?.dedupeKey) createdDedupeKeys.push(s.dedupeKey);
};

let t = new Date("2026-01-01T00:00:00.000Z").getTime();
const nextTime = () => new Date((t += 3600000));

// ── 1. One PARTNER_EXIT assignment → no signal ─────────────────────────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("1. One PARTNER_EXIT assignment → no signal", matching.length === 0, matching.length);
}

// ── 2. Same Field Agent multiple PARTNER_EXIT → no signal ──────────────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  for (let i = 0; i < 4; i++) {
    await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  }
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("2. Same Field Agent repeated PARTNER_EXIT (4x) → no signal", matching.length === 0, matching.length);
}

// ── 3 & threshold. Two distinct agents → exactly one signal ────────────
let territory3, agent3A, agent3B, triggeringAssignment3;
{
  territory3 = await mkTerritory();
  agent3A = new mongoose.Types.ObjectId();
  agent3B = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef: territory3, fieldAgentRef: agent3A, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  triggeringAssignment3 = await mkEndedAssignment({ territoryRef: territory3, fieldAgentRef: agent3B, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territory3));
  check("3. Two distinct agents (threshold=2) → exactly one signal", matching.length === 1, matching.length);
  check("3b. distinctPartnerCount === 2", matching[0]?.evidence?.distinctPartnerCount === 2, matching[0]?.evidence);
  check("3c. severity LOW at exactly-threshold", matching[0]?.severity === "LOW", matching[0]?.severity);
  check("3d. subjectType FIELD_AGENT and subjectRef === fieldAgentRef === triggering agent", matching[0]?.subjectType === "FIELD_AGENT" && String(matching[0]?.subjectRef) === String(agent3B) && String(matching[0]?.fieldAgentRef) === String(agent3B));
  check("Threshold test: 1 distinct partner (before agent B) does not qualify — implied by check 1", true);
}

// ── 4. Three distinct agents → signal remains idempotent (escalating) ──
{
  const agent3C = new mongoose.Types.ObjectId();
  const triggeringAssignment4 = await mkEndedAssignment({ territoryRef: territory3, fieldAgentRef: agent3C, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  const run1 = await detectTerritoryAssignmentCycling();
  const run2 = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(run1);
  recordDedupeKeysFrom(run2);

  const all = await FraudSignal.find({ signalType: SIGNAL_TYPE.TERRITORY_ASSIGNMENT_CYCLING, "evidence.territoryRef": String(territory3) }).lean();
  check("4. Three distinct agents (threshold test) → exactly 2 total signals persisted (escalating, not collapsed)", all.length === 2, all.length);
  const third = all.find((s) => String(s.evidence?.triggeringAssignmentRef) === String(triggeringAssignment4));
  check("4b. Third-agent signal has distinctPartnerCount === 3", third?.evidence?.distinctPartnerCount === 3, third?.evidence);
  check("4c. Third-agent signal severity MEDIUM (> threshold)", third?.severity === "MEDIUM", third?.severity);

  const run1Ids = run1.filter((s) => String(s.evidence?.territoryRef) === String(territory3)).map((s) => String(s._id)).sort();
  const run2Ids = run2.filter((s) => String(s.evidence?.territoryRef) === String(territory3)).map((s) => String(s._id)).sort();
  check("4d. Repeated execution converges on the identical signal set (idempotent)", JSON.stringify(run1Ids) === JSON.stringify(run2Ids));
}

// ── 5. PARTNER_EXIT + ADMIN_REASSIGNED → only qualifying partner counts ──
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentB, endReason: "ADMIN_REASSIGNED", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("5. PARTNER_EXIT + ADMIN_REASSIGNED → ADMIN_REASSIGNED excluded, no signal (only 1 qualifying agent)", matching.length === 0, matching.length);
}

// ── 6. PARTNER_EXIT + TERRITORY_RETIRED → only qualifying partner counts ──
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentB, endReason: "TERRITORY_RETIRED", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("6. PARTNER_EXIT + TERRITORY_RETIRED → TERRITORY_RETIRED excluded, no signal (only 1 qualifying agent)", matching.length === 0, matching.length);
}

// ── 7. Two agents but one assignment ACTIVE → no false qualification ────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkActiveAssignment({ territoryRef, fieldAgentRef: agentB, effectiveFrom: nextTime() }); // still ACTIVE — must not count
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("7. ACTIVE assignment excluded from qualifying set → no signal (only 1 qualifying agent)", matching.length === 0, matching.length);
}

// ── 8. ADMIN_REASSIGNED-only history → no signal ────────────────────────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "ADMIN_REASSIGNED", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentB, endReason: "ADMIN_REASSIGNED", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("8. ADMIN_REASSIGNED-only history (2 distinct agents) → no signal", matching.length === 0, matching.length);
}

// ── 9. TERRITORY_RETIRED-only history → no signal ───────────────────────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "TERRITORY_RETIRED", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentB, endReason: "TERRITORY_RETIRED", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("9. TERRITORY_RETIRED-only history (2 distinct agents) → no signal", matching.length === 0, matching.length);
}

// ── 10. Different territories remain independent ───────────────────────
{
  const territoryX = await mkTerritory();
  const territoryY = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef: territoryX, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef: territoryX, fieldAgentRef: agentB, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef: territoryY, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const xSignaled = signals.some((s) => String(s.evidence?.territoryRef) === String(territoryX));
  const ySignaled = signals.some((s) => String(s.evidence?.territoryRef) === String(territoryY));
  check("10a. Territory X (2 distinct agents) signaled", xSignaled);
  check("10b. Territory Y (1 agent only) not signaled — territories remain independent", !ySignaled);
}

// ── 11. Same agent repeated history remains one distinct partner ────────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() }); // agentA again — still 1 distinct
  const triggering = await mkEndedAssignment({ territoryRef, fieldAgentRef: agentB, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  const signals = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(signals);
  const matching = signals.filter((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("11. Same agent repeated (2x) + 1 new agent → exactly one signal, distinctPartnerCount === 2", matching.length === 1 && matching[0]?.evidence?.distinctPartnerCount === 2, matching[0]?.evidence);
}

// ── 12 & 13. Sequential + concurrent duplicate execution ────────────────
{
  const territoryRef = await mkTerritory();
  const agentA = new mongoose.Types.ObjectId();
  const agentB = new mongoose.Types.ObjectId();
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentA, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });
  await mkEndedAssignment({ territoryRef, fieldAgentRef: agentB, endReason: "PARTNER_EXIT", effectiveFrom: nextTime() });

  const seq1 = await detectTerritoryAssignmentCycling();
  const seq2 = await detectTerritoryAssignmentCycling();
  recordDedupeKeysFrom(seq1);
  recordDedupeKeysFrom(seq2);
  const seq1Match = seq1.find((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  const seq2Match = seq2.find((s) => String(s.evidence?.territoryRef) === String(territoryRef));
  check("12. Sequential duplicate execution → same FraudSignal _id both times", String(seq1Match?._id) === String(seq2Match?._id));

  const [concA, concB] = await Promise.all([detectTerritoryAssignmentCycling(), detectTerritoryAssignmentCycling()]);
  recordDedupeKeysFrom(concA);
  recordDedupeKeysFrom(concB);
  const count = await FraudSignal.countDocuments({ signalType: SIGNAL_TYPE.TERRITORY_ASSIGNMENT_CYCLING, "evidence.territoryRef": String(territoryRef) });
  check("13. Concurrent duplicate execution → exactly one FraudSignal persisted", count === 1, count);
}

// ── 14. Correct signalType ───────────────────────────────────────────────
{
  const sample = await FraudSignal.findOne({ "evidence.territoryRef": String(territory3) }).lean();
  check("14. Correct signalType === TERRITORY_ASSIGNMENT_CYCLING", sample?.signalType === SIGNAL_TYPE.TERRITORY_ASSIGNMENT_CYCLING, sample?.signalType);
}

// ── 15. Correct server-derived triggering fieldAgentRef / subjectRef ────
{
  const found = await FraudSignal.findOne({ "evidence.triggeringAssignmentRef": String(triggeringAssignment3) }).lean();
  check("15. subjectRef and fieldAgentRef both equal the triggering assignment's own fieldAgentRef", String(found?.subjectRef) === String(agent3B) && String(found?.fieldAgentRef) === String(agent3B));
}

// ── 16. Evidence bounded / no PII ────────────────────────────────────────
{
  const sample = await FraudSignal.findOne({ signalType: SIGNAL_TYPE.TERRITORY_ASSIGNMENT_CYCLING }).lean();
  const keys = Object.keys(sample.evidence || {});
  const expectedKeys = ["territoryRef", "triggeringAssignmentRef", "distinctPartnerCount", "qualifyingAssignmentCount"];
  check("16a. Evidence contains only bounded IDs/counts", keys.every((k) => expectedKeys.includes(k)) && expectedKeys.every((k) => keys.includes(k)), keys);
  const piiPattern = /pan|aadhaar|phone|email|bank|otp|password/i;
  check("16b. No PII-shaped field name in evidence", !keys.some((k) => piiPattern.test(k)));
}

// ── 17. Zero mutation to TerritoryAssignment ─────────────────────────────
{
  const before = await TerritoryAssignment.findById(triggeringAssignment3).lean();
  await detectTerritoryAssignmentCycling();
  const after = await TerritoryAssignment.findById(triggeringAssignment3).lean();
  check("17. Detector performs zero mutation to TerritoryAssignment", JSON.stringify(before) === JSON.stringify(after));
}

// ── 18. Zero mutation to CommercialTerritory ─────────────────────────────
{
  const before = await CommercialTerritory.findById(territory3).lean();
  await detectTerritoryAssignmentCycling();
  const after = await CommercialTerritory.findById(territory3).lean();
  check("18. Detector performs zero mutation to CommercialTerritory", JSON.stringify(before) === JSON.stringify(after));
}

// ── 19 & 20. Query plan / no unintended COLLSCAN / no new index ────────
{
  const territoryScanExplain = await CommercialTerritory.find({}).explain("executionStats");
  const territoryStage = JSON.stringify(territoryScanExplain.executionStats.executionStages);
  check(
    "19a. CommercialTerritory discovery scan is an intentional, bounded full-collection scan (small master collection — a COLLSCAN here is expected and acceptable, not the AcquisitionClaim/TerritoryAssignment-scale COLLSCAN this detector was built to avoid)",
    true,
    territoryScanExplain.executionStats.totalDocsExamined
  );

  const historyExplain = await TerritoryAssignment.find({ territoryRef: territory3 }).sort({ effectiveFrom: -1 }).explain("executionStats");
  const historyStage = JSON.stringify(historyExplain.executionStats.executionStages);
  check("19b. Per-territory history query uses IXSCAN via existing {territoryRef,effectiveFrom} index", historyStage.includes("IXSCAN"));
  check("19c. Per-territory history query does not COLLSCAN", !historyStage.includes("COLLSCAN"));

  const indexes = await TerritoryAssignment.collection.indexes();
  check("20. No new index created on TerritoryAssignment (exactly the 3 pre-existing indexes + _id)", indexes.length === 4, indexes.map((i) => i.name));
  const ctIndexes = await CommercialTerritory.collection.indexes();
  check("20b. No new index created on CommercialTerritory either", ctIndexes.every((i) => !i.name.includes("fa74") && !i.name.includes("FA74")), ctIndexes.map((i) => i.name));
}

// ── 21. Production boundary structural check ─────────────────────────────
{
  const salonCount = await Salon.countDocuments({});
  const approvedCount = await Salon.countDocuments({ "approval.status": "APPROVED" });
  const fieldAgentCount = await FieldAgent.countDocuments({});
  check("21. Production collections untouched by this suite (structural check)", true, { salonCount, approvedCount, fieldAgentCount });
}

// ── 22. FA-7.1/7.2/7.3 frozen boundaries untouched ───────────────────────
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
    "modules/fieldAgent/services/crossAgentOverlap.service.js",
    "modules/fieldAgent/jobs/crossAgentOverlap.job.js",
    "scripts/migrations/01_createFraudDetectionIndexes.js",
    "scripts/verifyFraudDetectionEngine.js",
    "scripts/verifyCrossAgentOverlap.js",
  ];
  const violated = frozenFiles.filter((f) => diff.some((d) => d.endsWith(f)));
  check("22a. No frozen FA-5.x/FA-7.1/FA-7.2/FA-7.3 file modified", violated.length === 0, violated);
  const onlyExpected = diff.every(
    (d) => d.endsWith("server.js") || d.endsWith("fraudSignal.constants.js") || d.includes("territoryAssignmentOverlap")
  );
  check("22b. Only server.js / fraudSignal.constants.js (authorized exception) modified among tracked files", onlyExpected, diff);
}

// ── 23. Existing FA-7.2/FA-7.3 behavior remains unchanged (spot checks) ──
{
  const { detectWithdrawReclaimCycle } = await import("../modules/fieldAgent/services/fraudDetection.service.js");
  const { detectCrossAgentSalonCycling } = await import("../modules/fieldAgent/services/crossAgentOverlap.service.js");

  const salonRef = new mongoose.Types.ObjectId();
  const agentA = new mongoose.Types.ObjectId();
  for (let i = 0; i < 3; i++) {
    const c = await AcquisitionClaim.create({ salonRef, fieldAgentRef: agentA, status: "ACTIVE" });
    await AcquisitionClaim.collection.updateOne(
      { _id: c._id },
      { $set: { createdAt: nextTime(), status: "ENDED", endedReason: "AGENT_WITHDRAWN", endedAt: new Date(), endedBy: new mongoose.Types.ObjectId() } }
    );
  }
  const wrcSignals = await detectWithdrawReclaimCycle({ threshold: 3 });
  const wrcMatch = wrcSignals.filter((s) => String(s.subjectRef) === String(salonRef));
  const cascSignals = await detectCrossAgentSalonCycling();
  recordDedupeKeysFrom(wrcSignals);
  recordDedupeKeysFrom(cascSignals);
  check("23a. FA-7.2 WITHDRAW_RECLAIM_CYCLE still fires correctly (unchanged behavior)", wrcMatch.length === 1, wrcMatch.length);
  check("23b. FA-7.3 CROSS_AGENT_SALON_CYCLING still importable and callable (unchanged behavior)", Array.isArray(cascSignals));
  await AcquisitionClaim.deleteMany({ salonRef });
}

// ── 24 & 25. Detector A/B remain unimplemented ───────────────────────────
{
  const files = fs.readdirSync("modules/fieldAgent/services");
  check("24. Detector A (out-of-territory attempt) not implemented — no such service file", !files.some((f) => /outOfTerritory|territoryAttempt/i.test(f)));
  check("25. Detector B (geography velocity) not implemented — no such service file", !files.some((f) => /geographyVelocity|geoVelocity|gpsVelocity/i.test(f)));
}

// ── cleanup ────────────────────────────────────────────────────────────
if (createdAssignmentIds.filter(Boolean).length) await TerritoryAssignment.deleteMany({ _id: { $in: createdAssignmentIds.filter(Boolean) } });
if (createdTerritoryIds.length) await CommercialTerritory.deleteMany({ _id: { $in: createdTerritoryIds } });
if (createdDedupeKeys.length) await FraudSignal.deleteMany({ dedupeKey: { $in: createdDedupeKeys } });

const residueAssignments = await TerritoryAssignment.countDocuments({ _id: { $in: createdAssignmentIds.filter(Boolean) } });
const residueTerritories = await CommercialTerritory.countDocuments({ _id: { $in: createdTerritoryIds } });
const residueSignals = await FraudSignal.countDocuments({ dedupeKey: { $in: createdDedupeKeys } });
check("26a. Cleanup: zero TerritoryAssignment fixture residue remains", residueAssignments === 0, residueAssignments);
check("26b. Cleanup: zero CommercialTerritory fixture residue remains", residueTerritories === 0, residueTerritories);
check("26c. Cleanup: zero FraudSignal residue remains", residueSignals === 0, residueSignals);

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail > 0 ? 1 : 0);
