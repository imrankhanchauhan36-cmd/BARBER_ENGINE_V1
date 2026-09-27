/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentEarningsDashboard.js
 *
 * FA-P4-B Step 3 — disposable real-Mongo / real-HTTP verification of
 * the Field Agent Earnings Dashboard counts:
 *   Active Recovery = AcquisitionEarningProgress IN_PROGRESS
 *   Completed       = AcquisitionEarningProgress TARGET_REACHED
 *   availablePayout / zemishPending calculations unchanged.
 * Fixtures are tracked by id and always removed in `finally`.
 *
 * Run:  cd backend && node scripts/verifyFieldAgentEarningsDashboard.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import { computeAvailableBalance } from "../modules/fieldAgent/services/fieldAgentPayout.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_FAP4B3_";
const oid = () => new mongoose.Types.ObjectId();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;

const ids = { users: [], apps: [], agents: [], claims: [], progress: [], ledger: [] };

const cleanup = async () => {
  await AcquisitionEarningProgress.deleteMany({ _id: { $in: ids.progress } });
  await AcquisitionClaim.deleteMany({ _id: { $in: ids.claims } });
  // Ledger is append-only at the schema level — raw driver for fixture removal.
  await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: ids.ledger } });
  await FieldAgent.deleteMany({ _id: { $in: ids.agents } });
  await FieldAgentApplication.deleteMany({ _id: { $in: ids.apps } });
  await User.deleteMany({ _id: { $in: ids.users } });
};

const purgeByPrefix = async () => {
  const users = await User.find({ name: new RegExp(`^${NAME_PREFIX}`) }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const agents = await FieldAgent.find({ userRef: { $in: userIds } }).select("_id applicationRef").lean();
  const agentIds = agents.map((a) => a._id);
  const claimIds = await AcquisitionClaim.distinct("_id", { fieldAgentRef: { $in: agentIds } });
  await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: claimIds } });
  await AcquisitionClaim.deleteMany({ _id: { $in: claimIds } });
  await FieldAgentEarningLedger.collection.deleteMany({ fieldAgentRef: { $in: agentIds } });
  await FieldAgent.deleteMany({ _id: { $in: agentIds } });
  await FieldAgentApplication.deleteMany({ _id: { $in: agents.map((a) => a.applicationRef) } });
  await User.deleteMany({ _id: { $in: userIds } });
};

const run = async () => {
  await connectDB();
  await purgeByPrefix();
  const server = app.listen(0);
  const { port } = server.address();
  const get = (path, token) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  try {
    const mkAgent = async (label) => {
      const user = await User.create({ name: `${NAME_PREFIX}${label}`, phone: phone("8"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      ids.users.push(user._id);
      const application = await FieldAgentApplication.create({ userRef: oid(), phone: phone("9"), status: "APPROVED", nonTerminal: false });
      ids.apps.push(application._id);
      const agent = await FieldAgent.create({
        userRef: user._id, applicationRef: application._id,
        agentCode: `ZFP4B3-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT",
      });
      ids.agents.push(agent._id);
      return { user, agent, token: generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: 0 }) };
    };
    const mkClaim = async (agent, status, progress) => {
      const claim = await AcquisitionClaim.create({ salonRef: oid(), fieldAgentRef: agent._id, status });
      ids.claims.push(claim._id);
      if (progress) {
        const p = await AcquisitionEarningProgress.create({
          acquisitionClaimRef: claim._id, salonRef: claim.salonRef,
          targetInPaise: progress.target, earnedInPaise: progress.earned, status: progress.status,
        });
        ids.progress.push(p._id);
      }
      return claim;
    };

    const A = await mkAgent("A");
    const B = await mkAgent("B");

    // Agent A: 1 pending, 2 IN_PROGRESS, 1 TARGET_REACHED, 1 approved-but-no-earning-yet
    await mkClaim(A.agent, "PENDING_APPROVAL");
    const act1 = await mkClaim(A.agent, "ACTIVE_RECOVERY", { target: 20000, earned: 5000, status: "IN_PROGRESS" });
    const act2 = await mkClaim(A.agent, "ACTIVE_RECOVERY", { target: 20000, earned: 8000, status: "IN_PROGRESS" });
    const done = await mkClaim(A.agent, "ACTIVE_RECOVERY", { target: 20000, earned: 20000, status: "TARGET_REACHED" });
    const noProg = await mkClaim(A.agent, "ACTIVE_RECOVERY");
    // Agent B: one TARGET_REACHED + one IN_PROGRESS — must never leak into A.
    await mkClaim(B.agent, "ACTIVE_RECOVERY", { target: 20000, earned: 20000, status: "TARGET_REACHED" });
    await mkClaim(B.agent, "ACTIVE_RECOVERY", { target: 20000, earned: 1000, status: "IN_PROGRESS" });

    const row = await FieldAgentEarningLedger.create({
      bookingRef: oid(), entitlementType: "ACQUISITION", idempotencyKey: `${NAME_PREFIX}LEDGER_${oid()}`,
      fieldAgentRef: A.agent._id, policySource: "NATIONAL", policyVersionRef: oid(), appliedRatePercent: 10,
      bookingCommissionAmountInPaise: 30000, rawEligibleAmountInPaise: 30000, creditedAmountInPaise: 30000,
      creditOutcome: "CREDITED", bookingCompletedAt: new Date(),
    });
    ids.ledger.push(row._id);

    // ── Dashboard (real HTTP) ─────────────────────────────────
    const dash = await get("/api/field-agent/acquisition/dashboard", A.token);
    const d = dash.body?.data || {};
    check("D1 dashboard 200", dash.status === 200, dash);
    check("D2 activeRecoveryCount = progress IN_PROGRESS (2), not claim.status (4)", d.activeRecoveryCount === 2, d);
    check("D3 completedCount = progress TARGET_REACHED (1), not claim.status COMPLETED (0)", d.completedCount === 1, d);
    check("D4 availablePayout unchanged = computeAvailableBalance (30000)",
      d.availablePayout === (await computeAvailableBalance(A.agent._id)).availableInPaise && d.availablePayout === 30000, d);
    check("D5 zemishPending unchanged = Σ(target-earned) over IN_PROGRESS (15000+12000=27000)", d.zemishPending === 27000, d);
    check("D6 pendingApprovalCount still claim.status (1)", d.pendingApprovalCount === 1, d);

    const dashB = await get("/api/field-agent/acquisition/dashboard", B.token);
    check("D7 agent isolation: B sees own counts (1 active, 1 completed)",
      dashB.body?.data?.activeRecoveryCount === 1 && dashB.body?.data?.completedCount === 1, dashB.body?.data);

    // ── Completed tab / Active tab consistency ────────────────
    const comp = await get("/api/field-agent/acquisition/recovery?status=COMPLETED&page=1&limit=20", A.token);
    const compItems = comp.body?.data?.salons || [];
    check("L1 Completed tab lists exactly the TARGET_REACHED claim",
      compItems.length === 1 && String(compItems[0].claimId) === String(done._id), compItems);
    check("L2 Completed item shows status COMPLETED, 100% progress",
      compItems[0]?.status === "COMPLETED" && compItems[0]?.progressPercent === 100, compItems[0]);
    check("L3 Completed tab count matches dashboard card", comp.body?.pagination?.total === d.completedCount, comp.body?.pagination);

    const act = await get("/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=1&limit=20", A.token);
    const actIds = (act.body?.data?.salons || []).map((s) => String(s.claimId)).sort();
    check("L4 Active tab excludes the TARGET_REACHED claim, keeps in-progress + not-yet-earning",
      JSON.stringify(actIds) === JSON.stringify([act1._id, act2._id, noProg._id].map(String).sort()), actIds);

    const pend = await get("/api/field-agent/acquisition/recovery?status=PENDING_APPROVAL&page=1&limit=20", A.token);
    check("L5 Pending tab unchanged (1)", (pend.body?.data?.salons || []).length === 1, pend.body?.data);

    const all = await get("/api/field-agent/acquisition/recovery?page=1&limit=20", A.token);
    check("L6 unfiltered list unchanged (5 claims)", (all.body?.data?.salons || []).length === 5, all.body?.pagination);

    const noAuth = await fetch(`http://127.0.0.1:${port}/api/field-agent/acquisition/dashboard`);
    check("S1 unauthenticated request rejected", noAuth.status === 401, noAuth.status);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await cleanup().catch((e) => results.push(`⚠️ cleanup error ${e.message}`));
    await purgeByPrefix().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    const left = await AcquisitionClaim.countDocuments({ _id: { $in: ids.claims } });
    const leftUsers = await User.countDocuments({ name: new RegExp(`^${NAME_PREFIX}`) });
    check("Z1 fixtures cleaned up (claims, users)", left === 0 && leftUsers === 0, { left, leftUsers });
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
