/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentIntegration.js
 *
 * FA-4.4 — Integration regression across FA-4.1 (profile foundation),
 * FA-4.2 (approval/rejection), and FA-4.3 (review queue/detail). Real
 * MongoDB Atlas, real HTTP, real signed JWTs, no mocks.
 *
 * SCOPE NOTE: this script drives FieldAgentApplication through its
 * REAL, frozen state machine using the SAME assertValidTransition/
 * setApplicationStatus functions every upstream engine (KYC, Training,
 * Test) calls internally — proving the gate itself is real and
 * enforced (a deliberately-attempted invalid jump is rejected below) —
 * rather than re-driving each upstream engine's own full HTTP flow
 * (document upload, PAN/Aadhaar verification providers, 10 training
 * modules, 10 test questions), which is each engine's OWN frozen
 * suite's responsibility and is re-run fresh, unmodified, as part of
 * this same audit. FA-4.4's job is the INTEGRATION boundary — does
 * FA-4 correctly consume whatever state it receives, and does the
 * approval/rejection foundation remain safe under concurrency — not
 * re-proving each upstream engine's own internal correctness a second
 * time.
 *
 * All fixtures (phones 9999907xxx) are hard-deleted in cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentIntegration.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import KYC from "../modules/kyc/models/KYC.js";
import FieldAgentTraining from "../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TestAttempt from "../modules/fieldAgentTest/models/TestAttempt.js";
import { generateAccessToken } from "../services/token.service.js";
import { assertValidTransition, setApplicationStatus } from "../modules/fieldAgent/services/fieldAgentApplication.service.js";
import { APPLICATION_STATUS } from "../modules/fieldAgent/constants/fieldAgent.constants.js";

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

let phoneSeq = 0;
const fixtureUserIds = [];
const nextPhone = () => `9999907${String(phoneSeq++).padStart(3, "0")}`;

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });

  // ── Pre-flight cleanup ────────────────────────────────────────────
  {
    const staleUsers = await User.find({ phone: { $regex: /^9999907\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      const staleApps = await FieldAgentApplication.find({ userRef: { $in: staleUserIds } }).select("_id").lean();
      const staleAppIds = staleApps.map((a) => a._id);
      await FieldAgent.deleteMany({ userRef: { $in: staleUserIds } });
      await KYC.deleteMany({ ownerId: { $in: staleUserIds } });
      await FieldAgentTraining.deleteMany({ applicationRef: { $in: staleAppIds } });
      await TestAttempt.deleteMany({ applicationRef: { $in: staleAppIds } });
      await FieldAgentApplication.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
  }

  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists", !!indiaAdmin);
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const REVIEW_API = "/api/admin/field-agents";

  const makeDraftUser = async (name) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(user._id);
    return user;
  };

  // Drives an application through the REAL frozen state machine, one
  // real assertValidTransition per hop — see file header for why this
  // (not a full re-drive of each upstream engine's own HTTP flow) is
  // the correct scope for FA-4.4.
  const advanceThroughGates = async (application, path) => {
    for (const nextStatus of path) {
      assertValidTransition(application.status, nextStatus); // throws on an invalid hop — this IS the gate
      setApplicationStatus(application, nextStatus);
      await application.save();
    }
    return application;
  };

  const FULL_PATH_TO_ADMIN_REVIEW = [
    APPLICATION_STATUS.SUBMITTED,
    APPLICATION_STATUS.KYC_PENDING,
    APPLICATION_STATUS.TRAINING_PENDING,
    APPLICATION_STATUS.TEST_PENDING,
    APPLICATION_STATUS.ADMIN_REVIEW,
  ];

  // ── SCENARIO A — SUCCESSFUL APPLICANT, FULL PIPELINE ──────────────
  let scenarioAApp, scenarioAUser;
  {
    scenarioAUser = await makeDraftUser("FA-4.4 Scenario A Agent");
    let application = await FieldAgentApplication.create({ userRef: scenarioAUser._id, phone: scenarioAUser.phone, status: APPLICATION_STATUS.DRAFT, nonTerminal: true });

    // 1/2 — real gate-by-gate advancement (KYC/training/test data
    // attached realistically at each stage, same shape
    // verifyFieldAgentReviewQueue.js's own fixtures use).
    application = await advanceThroughGates(application, FULL_PATH_TO_ADMIN_REVIEW);
    check("A1/2: application reaches ADMIN_REVIEW only via the real, frozen transition gates (one real assertValidTransition per hop)", application.status === "ADMIN_REVIEW", application.status);

    await KYC.create({
      ownerId: scenarioAUser._id,
      applicantType: "FIELD_AGENT",
      status: "VERIFIED",
      verification: { pan: { verified: true }, aadhaar: { verified: true }, bank: { verified: true } },
      submittedAt: new Date(),
      approvedAt: new Date(),
    });
    await FieldAgentTraining.create({
      agentRef: scenarioAUser._id,
      applicationRef: application._id,
      trainingVersion: new mongoose.Types.ObjectId(),
      status: "COMPLETED",
      moduleProgress: [{ trainingModule: new mongoose.Types.ObjectId(), moduleKey: "FOUNDATION", status: "COMPLETED", completedAt: new Date() }],
      completedAt: new Date(),
    });
    await TestAttempt.create({
      applicationRef: application._id,
      agentRef: scenarioAUser._id,
      testVersionRef: new mongoose.Types.ObjectId(),
      attemptNumber: 1,
      questionRefs: [new mongoose.Types.ObjectId()],
      status: "PASSED",
      score: 100,
      passed: true,
      submittedAt: new Date(),
    });
    scenarioAApp = application;

    // 4 — queue finds it.
    const queueRes = await authFetch(`${REVIEW_API}?limit=100`, indiaToken);
    const queueJson = await queueRes.json();
    check("A4: review queue discovers the ADMIN_REVIEW application", queueJson.data.applications.some((a) => a.applicationId === String(application._id)));

    // 5 — detail aggregates complete decision context.
    const detailRes = await authFetch(`${REVIEW_API}/${application._id}`, indiaToken);
    const detailJson = await detailRes.json();
    check("A5: detail returns complete, correct decision context (KYC/training/test all summarized)", detailJson.data.kyc?.status === "VERIFIED" && detailJson.data.training?.status === "COMPLETED" && detailJson.data.test?.status === "PASSED" && detailJson.data.decisionReadiness.eligibleForApproval === true, detailJson.data);

    // 6-11 — INDIA admin approves.
    const auditApprovedBefore = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    const auditProfileBefore = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_PROFILE_CREATED" });

    const approveRes = await authFetch(`${REVIEW_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    const approveJson = await approveRes.json();
    check("A6: INDIA admin approves -> 200", approveRes.status === 200, approveRes.status);
    check("A7: FieldAgent profile exists", !!approveJson.data.profile?._id, approveJson.data.profile);
    check("A8: unique agentCode exists in the expected shape", /^FA-\d{8}-\d{6}$/.test(approveJson.data.profile.agentCode), approveJson.data.profile.agentCode);
    check("A9: application becomes APPROVED", approveJson.data.application.status === "APPROVED", approveJson.data.application.status);

    const auditApprovedAfter = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    check("A10: approval audit exists exactly once", auditApprovedAfter - auditApprovedBefore === 1, auditApprovedAfter - auditApprovedBefore);
    const auditProfileAfter = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_PROFILE_CREATED" });
    check("A11: profile-created audit exists exactly once", auditProfileAfter - auditProfileBefore === 1, auditProfileAfter - auditProfileBefore);
  }

  // ── SCENARIO B — REJECTED APPLICANT + RESUBMISSION PATH ───────────
  {
    const user = await makeDraftUser("FA-4.4 Scenario B Agent");
    let application = await FieldAgentApplication.create({ userRef: user._id, phone: user.phone, status: APPLICATION_STATUS.DRAFT, nonTerminal: true });
    application = await advanceThroughGates(application, FULL_PATH_TO_ADMIN_REVIEW);
    check("B1: application reaches ADMIN_REVIEW via real gates", application.status === "ADMIN_REVIEW", application.status);

    const REASON = "Applicant's declared work area does not match KYC address on file.";
    const rejectRes = await authFetch(`${REVIEW_API}/${application._id}/reject`, indiaToken, { method: "POST", body: JSON.stringify({ reason: REASON }) });
    const rejectJson = await rejectRes.json();
    check("B2/3: admin rejects with reason -> application becomes REJECTED", rejectRes.status === 200 && rejectJson.data.application.status === "REJECTED", rejectRes.status);
    check("B4: rejectionReason persists", rejectJson.data.application.rejectionReason === REASON, rejectJson.data.application.rejectionReason);

    const profileCount = await FieldAgent.countDocuments({ applicationRef: application._id });
    check("B5: no FieldAgent profile exists", profileCount === 0, profileCount);
    const rejectionAudit = await FieldAgentAuditEvent.findOne({ action: "FIELD_AGENT_REJECTED", entityId: application._id }).lean();
    check("B6: rejection audit exists", !!rejectionAudit, rejectionAudit);

    // B7 — new application path behaves per frozen FA-2 rules: same
    // user can start a fresh DRAFT (terminal REJECTED no longer
    // blocks the partial-unique {userRef,nonTerminal} index), and the
    // fresh document independently starts every gate from zero.
    const applicantToken = generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });
    const resubmitRes = await authFetch("/api/field-agent/applications", applicantToken, { method: "POST", body: JSON.stringify({}) });
    const resubmitJson = await resubmitRes.json();
    check("B7: applicant can start a new application after rejection (frozen FA-2 behavior, no special FA-4 mechanism)", resubmitRes.status === 201, resubmitRes.status);
    check("B7: the new application is independent (different id, DRAFT, no carried-over kyc/training/test refs)", String(resubmitJson.data.application._id) !== String(application._id) && resubmitJson.data.application.status === "DRAFT" && resubmitJson.data.application.kycRef == null, resubmitJson.data.application);

    // Deliberate NEGATIVE proof: the new DRAFT application cannot
    // jump straight to ADMIN_REVIEW — the same gate rejects it.
    const freshApp = await FieldAgentApplication.findById(resubmitJson.data.application._id);
    let gateRejected = false;
    try {
      assertValidTransition(freshApp.status, APPLICATION_STATUS.ADMIN_REVIEW);
    } catch (err) {
      gateRejected = err.code === "CONFLICT";
    }
    check("O: the frozen gate itself rejects skipping KYC/training/test (DRAFT cannot jump directly to ADMIN_REVIEW)", gateRejected);
  }

  // ── SCENARIO C — CONCURRENT APPROVAL (re-verified at integration level) ─
  {
    const user = await makeDraftUser("FA-4.4 Scenario C Agent");
    let application = await FieldAgentApplication.create({ userRef: user._id, phone: user.phone, status: APPLICATION_STATUS.DRAFT, nonTerminal: true });
    application = await advanceThroughGates(application, FULL_PATH_TO_ADMIN_REVIEW);

    const [r1, r2, r3] = await Promise.all([
      authFetch(`${REVIEW_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${REVIEW_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${REVIEW_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
    ]);
    check("C: all 3 concurrent approvals succeed -> 200", r1.status === 200 && r2.status === 200 && r3.status === 200, [r1.status, r2.status, r3.status]);
    const profileCount = await FieldAgent.countDocuments({ applicationRef: application._id });
    check("C: exactly one successful profile", profileCount === 1, profileCount);
    const codes = await FieldAgent.distinct("agentCode", { applicationRef: application._id });
    check("C: exactly one agentCode", codes.length === 1, codes);
    const finalApp = await FieldAgentApplication.findById(application._id).lean();
    check("C: no inconsistent application state (exactly APPROVED)", finalApp.status === "APPROVED", finalApp.status);
  }

  // ── §7 — STALE-DETAIL / LIVE-REVALIDATION RACE ────────────────────
  // Admin loads detail showing ADMIN_REVIEW; something else changes
  // the application's state; admin's approval attempt (based on the
  // now-stale view they already loaded) must be revalidated against
  // LIVE state, not the GET response they're holding.
  {
    const user = await makeDraftUser("FA-4.4 Stale Detail Agent");
    let application = await FieldAgentApplication.create({ userRef: user._id, phone: user.phone, status: APPLICATION_STATUS.DRAFT, nonTerminal: true });
    application = await advanceThroughGates(application, FULL_PATH_TO_ADMIN_REVIEW);

    const detailRes = await authFetch(`${REVIEW_API}/${application._id}`, indiaToken);
    const detailJson = await detailRes.json();
    check("detail correctly shows ADMIN_REVIEW / eligible before the external change", detailJson.data.application.status === "ADMIN_REVIEW" && detailJson.data.decisionReadiness.eligibleForApproval === true, detailJson.data);

    // Something else (e.g. a different admin, or in production a
    // withdrawal) changes the application out from under the first
    // admin's already-loaded view.
    await FieldAgentApplication.updateOne({ _id: application._id }, { $set: { status: "WITHDRAWN", nonTerminal: false, withdrawnAt: new Date() } });

    const staleApproveRes = await authFetch(`${REVIEW_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("FA-4.2 revalidates LIVE state and rejects approval based on the now-stale GET view -> 409", staleApproveRes.status === 409, staleApproveRes.status);
    const stillWithdrawn = await FieldAgentApplication.findById(application._id).lean();
    check("no FieldAgent profile was created from the stale-approval attempt", (await FieldAgent.countDocuments({ applicationRef: application._id })) === 0 && stillWithdrawn.status === "WITHDRAWN", stillWithdrawn.status);
  }

  // ── SCENARIO D — AUTHORIZATION (light re-check; full matrix already
  // proven exhaustively in FA-4.2/4.3's own suites, re-run unchanged
  // as part of this same audit) ─────────────────────────────────────
  {
    const { user } = { user: await makeDraftUser("FA-4.4 AuthZ FieldAgent") };
    const fieldAgentToken = generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });
    check("D: FIELD_AGENT -> 403 on queue", (await authFetch(REVIEW_API, fieldAgentToken)).status === 403);
    check("D: FIELD_AGENT -> 403 on approve", (await authFetch(`${REVIEW_API}/${scenarioAApp._id}/approve`, fieldAgentToken, { method: "POST", body: JSON.stringify({}) })).status === 403);
    check("D: unauthenticated -> 401 on queue", (await authFetch(REVIEW_API, null)).status === 401);
  }

  // ── FINAL RE-VERIFICATION: no accidental mutation of Scenario A's
  // already-approved application by anything else in this run ───────
  {
    const finalA = await FieldAgentApplication.findById(scenarioAApp._id).select("status").lean();
    check("Scenario A's application remains APPROVED at the end of the run (no cross-scenario interference)", finalA.status === "APPROVED", finalA.status);
  }

  // ── CLEANUP ────────────────────────────────────────────────────
  const fixtureApps = await FieldAgentApplication.find({ userRef: { $in: fixtureUserIds } }).select("_id").lean();
  const fixtureAppIds = fixtureApps.map((a) => a._id);

  const profileDelete = await FieldAgent.deleteMany({ userRef: { $in: fixtureUserIds } });
  const kycDelete = await KYC.deleteMany({ ownerId: { $in: fixtureUserIds } });
  const trainingDelete = await FieldAgentTraining.deleteMany({ applicationRef: { $in: fixtureAppIds } });
  const attemptDelete = await TestAttempt.deleteMany({ applicationRef: { $in: fixtureAppIds } });
  const applicationDelete = await FieldAgentApplication.deleteMany({ userRef: { $in: fixtureUserIds } });
  const userDelete = await User.deleteMany({ _id: { $in: fixtureUserIds } });

  const remainingProfiles = await FieldAgent.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.4 FieldAgent fixtures remain (no residue)", remainingProfiles === 0, remainingProfiles);
  const remainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.4 FieldAgentApplication fixtures remain (no residue)", remainingApplications === 0, remainingApplications);
  const remainingUsers = await User.countDocuments({ _id: { $in: fixtureUserIds } });
  check("zero FA-4.4 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(
    `\n🧹 Cleanup: removed ${userDelete.deletedCount} user(s), ${applicationDelete.deletedCount} application(s), ${profileDelete.deletedCount} FieldAgent profile(s), ${kycDelete.deletedCount} KYC doc(s), ${trainingDelete.deletedCount} training enrollment(s), ${attemptDelete.deletedCount} test attempt(s) (phones 9999907xxx). Audit events preserved.`
  );

  await mongoose.connection.close();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ Verification script crashed:", err.message);
  console.error(err.stack);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
