/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentReviewQueue.js
 *
 * FA-4.3 — LIVE, real-HTTP, real-DB verification for the Admin Review
 * Queue + Application Detail. Same precedent and style as every other
 * verification script in this repo — real Express app, real signed
 * JWTs, real MongoDB Atlas, no mocks.
 *
 * All fixtures (phones 9999906xxx) are hard-deleted in cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentReviewQueue.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import KYC from "../modules/kyc/models/KYC.js";
import FieldAgentTraining from "../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TestAttempt from "../modules/fieldAgentTest/models/TestAttempt.js";
import { generateAccessToken } from "../services/token.service.js";
import { approveApplication } from "../modules/fieldAgent/services/fieldAgentApproval.service.js";

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
const nextPhone = () => `9999906${String(phoneSeq++).padStart(3, "0")}`;

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
    const staleUsers = await User.find({ phone: { $regex: /^9999906\d{3}$/ } }).select("_id").lean();
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

  // ── FIXTURES ───────────────────────────────────────────────────────
  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists", !!indiaAdmin);
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const districtAdmin = await User.findOne({ role: "ADMIN", adminLevel: { $in: ["STATE", "DISTRICT"] }, isActive: true, accountStatus: "ACTIVE" }).select("+tokenVersion").lean();
  check("a real STATE/DISTRICT admin fixture exists", !!districtAdmin);
  const districtToken = districtAdmin
    ? generateAccessToken({ _id: districtAdmin._id, role: "ADMIN", adminLevel: districtAdmin.adminLevel, tokenVersion: districtAdmin.tokenVersion ?? 0 })
    : null;

  const makeApplicationInStatus = async (name, status, extra = {}) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(user._id);
    const application = await FieldAgentApplication.create({ userRef: user._id, phone, status, nonTerminal: !["APPROVED", "REJECTED", "WITHDRAWN"].includes(status), ...extra });
    return { user, application };
  };

  // A fully-enriched ADMIN_REVIEW application: real KYC (VERIFIED),
  // real training enrollment (COMPLETED), real passing TestAttempt.
  const makeFullReviewFixture = async (name) => {
    const { user, application } = await makeApplicationInStatus(name, "ADMIN_REVIEW");

    await KYC.create({
      ownerId: user._id,
      applicantType: "FIELD_AGENT",
      status: "VERIFIED",
      verification: { pan: { verified: true }, aadhaar: { verified: true }, bank: { verified: true } },
      submittedAt: new Date(),
      approvedAt: new Date(),
    });

    await FieldAgentTraining.create({
      agentRef: user._id,
      applicationRef: application._id,
      trainingVersion: new mongoose.Types.ObjectId(),
      status: "COMPLETED",
      moduleProgress: [
        { trainingModule: new mongoose.Types.ObjectId(), moduleKey: "FOUNDATION", status: "COMPLETED", completedAt: new Date() },
        { trainingModule: new mongoose.Types.ObjectId(), moduleKey: "USER_APP", status: "COMPLETED", completedAt: new Date() },
      ],
      completedAt: new Date(),
    });

    await TestAttempt.create({
      applicationRef: application._id,
      agentRef: user._id,
      testVersionRef: new mongoose.Types.ObjectId(),
      attemptNumber: 1,
      questionRefs: [new mongoose.Types.ObjectId()],
      status: "PASSED",
      score: 100,
      passed: true,
      submittedAt: new Date(),
    });

    return { user, application };
  };

  const REVIEW_API = "/api/admin/field-agents";

  // ── A — QUEUE ────────────────────────────────────────────────────
  let queueFixture;
  {
    queueFixture = await makeFullReviewFixture("FA-4.3 Queue Fixture Agent");

    const res = await authFetch(`${REVIEW_API}?limit=5`, indiaToken);
    const json = await res.json();
    check("A1: INDIA admin can fetch the ADMIN_REVIEW queue -> 200", res.status === 200, res.status);
    check("A2: queue is bounded/paginated (<= requested limit)", json.data.applications.length <= 5, json.data.applications.length);
    check("A2: pagination metadata present", typeof json.pagination?.total === "number" && typeof json.pagination?.totalPages === "number", json.pagination);

    const row = json.data.applications.find((a) => a.applicationId === String(queueFixture.application._id));
    check("A: the fixture application appears in the default ADMIN_REVIEW queue", !!row, row);
    check("row includes user name/phone", row?.user?.name === "FA-4.3 Queue Fixture Agent", row?.user);
    check("row includes kycStatus=VERIFIED (INDIA admin)", row?.kycStatus === "VERIFIED", row?.kycStatus);
    check("row includes trainingStatus=COMPLETED", row?.trainingStatus === "COMPLETED", row?.trainingStatus);
    check("row includes testStatus=PASSED", row?.testStatus === "PASSED", row?.testStatus);
    check("row has no agentCode (not yet approved)", row?.agentCode === null, row?.agentCode);

    // A3 — deterministic ordering: fetch twice, compare exact order.
    const res2 = await authFetch(`${REVIEW_API}?limit=50`, indiaToken);
    const json2 = await res2.json();
    const res3 = await authFetch(`${REVIEW_API}?limit=50`, indiaToken);
    const json3 = await res3.json();
    check("A3: repeated queue fetches return identical, deterministic order", JSON.stringify(json2.data.applications.map((a) => a.applicationId)) === JSON.stringify(json3.data.applications.map((a) => a.applicationId)));

    // A4 — valid filter: status=REJECTED.
    const { application: rejectedApp } = await makeApplicationInStatus("FA-4.3 Rejected Filter Agent", "REJECTED", { rejectionReason: "test" });
    const rejectedQueueRes = await authFetch(`${REVIEW_API}?status=REJECTED&limit=50`, indiaToken);
    const rejectedQueueJson = await rejectedQueueRes.json();
    check("A4: status=REJECTED filter returns only REJECTED applications", rejectedQueueRes.status === 200 && rejectedQueueJson.data.applications.every((a) => a.status === "REJECTED"), rejectedQueueRes.status);
    check("A4: the REJECTED fixture appears under the REJECTED filter", rejectedQueueJson.data.applications.some((a) => a.applicationId === String(rejectedApp._id)));

    // A5 — invalid filter (status not a valid enum value) rejected.
    const invalidStatusRes = await authFetch(`${REVIEW_API}?status=NOT_A_REAL_STATUS`, indiaToken);
    check("A5: invalid status filter rejected -> 400", invalidStatusRes.status === 400, invalidStatusRes.status);

    // A6 — invalid pagination rejected.
    const invalidPageRes = await authFetch(`${REVIEW_API}?page=0`, indiaToken);
    check("A6: page=0 rejected -> 400", invalidPageRes.status === 400, invalidPageRes.status);
    const invalidLimitRes = await authFetch(`${REVIEW_API}?limit=99999`, indiaToken);
    check("A6: limit above the maximum rejected -> 400", invalidLimitRes.status === 400, invalidLimitRes.status);

    // A7 — no arbitrary Mongo query operators accepted.
    const injectionRes = await authFetch(`${REVIEW_API}?status[$ne]=REJECTED`, indiaToken);
    check("A7: arbitrary Mongo operator in query is rejected/ignored, not executed -> 400", injectionRes.status === 400, injectionRes.status);

    // A8 — no arbitrary sort field injection.
    const sortInjectionRes = await authFetch(`${REVIEW_API}?sortBy=rejectionReason`, indiaToken);
    check("A8: non-whitelisted sortBy field rejected -> 400", sortInjectionRes.status === 400, sortInjectionRes.status);
    const sortDirInjectionRes = await authFetch(`${REVIEW_API}?sortOrder=DROP`, indiaToken);
    check("A8: non-whitelisted sortOrder value rejected -> 400", sortDirInjectionRes.status === 400, sortDirInjectionRes.status);

    // A9 — bounded, safe search.
    const searchRes = await authFetch(`${REVIEW_API}?search=Queue+Fixture&limit=50`, indiaToken);
    const searchJson = await searchRes.json();
    check("A9: search by applicant name -> 200, finds the fixture", searchRes.status === 200 && searchJson.data.applications.some((a) => a.applicationId === String(queueFixture.application._id)), searchRes.status);
    const oversizedSearchRes = await authFetch(`${REVIEW_API}?search=${"x".repeat(200)}`, indiaToken);
    check("A9: oversized search input rejected -> 400", oversizedSearchRes.status === 400, oversizedSearchRes.status);
    const regexSearchRes = await authFetch(`${REVIEW_API}?search=${encodeURIComponent("(a+)+$")}`, indiaToken);
    check("A9: a regex-special-character search string does not crash the server (safely escaped)", regexSearchRes.status === 200, regexSearchRes.status);
  }

  // ── B — DETAIL ─────────────────────────────────────────────────────
  {
    const detailRes = await authFetch(`${REVIEW_API}/${queueFixture.application._id}`, indiaToken);
    const detailJson = await detailRes.json();
    check("B10: ADMIN_REVIEW application detail loads -> 200", detailRes.status === 200, detailRes.status);
    check("B10: application section correct", detailJson.data.application.status === "ADMIN_REVIEW", detailJson.data.application.status);
    check("B14: KYC summary correct (VERIFIED, all verified flags true)", detailJson.data.kyc?.status === "VERIFIED" && detailJson.data.kyc.verified.pan && detailJson.data.kyc.verified.aadhaar && detailJson.data.kyc.verified.bank, detailJson.data.kyc);
    check("B15: training summary correct (COMPLETED, 2/2 modules)", detailJson.data.training?.status === "COMPLETED" && detailJson.data.training.completedModules === 2 && detailJson.data.training.totalModules === 2, detailJson.data.training);
    check("B16: test summary correct (PASSED, score=100, attemptNumber=1)", detailJson.data.test?.status === "PASSED" && detailJson.data.test.score === 100 && detailJson.data.test.attemptNumber === 1, detailJson.data.test);
    check("decision readiness: eligibleForApproval=true, eligibleForRejection=true for ADMIN_REVIEW", detailJson.data.decisionReadiness.eligibleForApproval === true && detailJson.data.decisionReadiness.eligibleForRejection === true, detailJson.data.decisionReadiness);
    check("B: no FieldAgent profile yet (not approved)", detailJson.data.fieldAgent === null, detailJson.data.fieldAgent);

    const fullText = JSON.stringify(detailJson);
    check("B17: no answer-key/grading data anywhere in the detail response", !fullText.includes("grading") && !fullText.includes("correctOptionIndex"), fullText.slice(0, 200));
    check("B18: no OTP/password/session/encrypted-KYC-value exposure", !fullText.match(/otp|password|encryptedNumber|encryptedAccount|tokenVersion/i), fullText.slice(0, 200));

    // B19 — GET performs no mutation.
    const appBefore = await FieldAgentApplication.findById(queueFixture.application._id).select("updatedAt status").lean();
    await authFetch(`${REVIEW_API}/${queueFixture.application._id}`, indiaToken);
    const appAfter = await FieldAgentApplication.findById(queueFixture.application._id).select("updatedAt status").lean();
    check("B19: GET detail performs no mutation (status/updatedAt unchanged)", appAfter.status === appBefore.status && appAfter.updatedAt.getTime() === appBefore.updatedAt.getTime(), { appBefore, appAfter });

    // B11 — REJECTED shows rejectionReason.
    const { application: rejectedApp } = await makeApplicationInStatus("FA-4.3 Detail Rejected Agent", "REJECTED", { rejectionReason: "Blurry Aadhaar photo" });
    const rejectedDetailRes = await authFetch(`${REVIEW_API}/${rejectedApp._id}`, indiaToken);
    const rejectedDetailJson = await rejectedDetailRes.json();
    check("B11: REJECTED application detail shows rejectionReason", rejectedDetailJson.data.application.rejectionReason === "Blurry Aadhaar photo", rejectedDetailJson.data.application.rejectionReason);
    check("B11: REJECTED application is not eligible for approval or rejection again", rejectedDetailJson.data.decisionReadiness.eligibleForApproval === false && rejectedDetailJson.data.decisionReadiness.eligibleForRejection === false, rejectedDetailJson.data.decisionReadiness);

    // B12 — APPROVED shows FieldAgent profile.
    const approvedFixture = await makeFullReviewFixture("FA-4.3 Detail Approved Agent");
    const approvalResult = await approveApplication({ applicationId: approvedFixture.application._id, adminId: indiaAdmin._id });
    check("fixture setup: real approval succeeded", !!approvalResult.profile?.agentCode, approvalResult.profile);
    const approvedDetailRes = await authFetch(`${REVIEW_API}/${approvedFixture.application._id}`, indiaToken);
    const approvedDetailJson = await approvedDetailRes.json();
    check("B12: APPROVED application detail shows the FieldAgent profile", approvedDetailJson.data.fieldAgent?.agentCode === approvalResult.profile.agentCode, approvedDetailJson.data.fieldAgent);
    check("B12: APPROVED application shows operationalStatus=PENDING_ACTIVATION", approvedDetailJson.data.fieldAgent?.operationalStatus === "PENDING_ACTIVATION", approvedDetailJson.data.fieldAgent);

    // B13 — optional null references (early-lifecycle application) do not crash.
    const { application: sparseApp } = await makeApplicationInStatus("FA-4.3 Sparse Agent", "TRAINING_PENDING");
    const sparseDetailRes = await authFetch(`${REVIEW_API}/${sparseApp._id}`, indiaToken);
    const sparseDetailJson = await sparseDetailRes.json();
    check("B13: an early-lifecycle application (no KYC/training/test data) does not crash -> 200", sparseDetailRes.status === 200, sparseDetailRes.status);
    check("B13: kyc/training/test/fieldAgent are all null, not an error", sparseDetailJson.data.kyc === null && sparseDetailJson.data.training === null && sparseDetailJson.data.test === null && sparseDetailJson.data.fieldAgent === null, sparseDetailJson.data);
    check("B13: decisionReadiness correctly reports not-yet-eligible with a human-readable reason", sparseDetailJson.data.decisionReadiness.eligibleForApproval === false && sparseDetailJson.data.decisionReadiness.blockingReasons.length === 1, sparseDetailJson.data.decisionReadiness);
  }

  // ── C — AUTHORIZATION ───────────────────────────────────────────────
  {
    const { token: fieldAgentToken } = await (async () => {
      const { user } = await makeApplicationInStatus("FA-4.3 AuthZ FieldAgent", "ADMIN_REVIEW");
      return { token: generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 }) };
    })();
    const plainUserPhone = nextPhone();
    const plainUser = await User.create({ name: "FA-4.3 AuthZ User", phone: plainUserPhone, role: "USER", isActive: true });
    fixtureUserIds.push(plainUser._id);
    const plainUserToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: plainUser.tokenVersion ?? 0 });

    check("C20: INDIA admin allowed on queue", (await authFetch(REVIEW_API, indiaToken)).status === 200);
    check("C20: INDIA admin allowed on detail", (await authFetch(`${REVIEW_API}/${queueFixture.application._id}`, indiaToken)).status === 200);

    if (districtToken) {
      check(`C21/22: ${districtAdmin.adminLevel} admin allowed on queue (established FA-4.2 read policy)`, (await authFetch(REVIEW_API, districtToken)).status === 200);
      const districtDetailRes = await authFetch(`${REVIEW_API}/${queueFixture.application._id}`, districtToken);
      const districtDetailJson = await districtDetailRes.json();
      check(`C21/22: ${districtAdmin.adminLevel} admin allowed on detail`, districtDetailRes.status === 200, districtDetailRes.status);
      check(`${districtAdmin.adminLevel} admin's KYC section is restricted (existing frozen KYC-scoping policy, not broadened)`, districtDetailJson.data.kyc?.restricted === true, districtDetailJson.data.kyc);
      check(`${districtAdmin.adminLevel} admin still sees training/test summaries (no restriction there, matching adminTraining/adminTest's own established policy)`, districtDetailJson.data.training?.status === "COMPLETED" && districtDetailJson.data.test?.status === "PASSED", { training: districtDetailJson.data.training, test: districtDetailJson.data.test });
    }

    check("C23: FIELD_AGENT -> 403 on queue", (await authFetch(REVIEW_API, fieldAgentToken)).status === 403);
    check("C24: USER -> 403 on queue", (await authFetch(REVIEW_API, plainUserToken)).status === 403);
    check("C25: unauthenticated -> 401 on queue", (await authFetch(REVIEW_API, null)).status === 401);
    check("C25: unauthenticated -> 401 on detail", (await authFetch(`${REVIEW_API}/${queueFixture.application._id}`, null)).status === 401);
  }

  // ── D — IDOR ─────────────────────────────────────────────────────
  {
    const malformedRes = await authFetch(`${REVIEW_API}/not-a-valid-object-id`, indiaToken);
    check("D27: malformed applicationId handled safely -> 400", malformedRes.status === 400, malformedRes.status);

    const unknownRes = await authFetch(`${REVIEW_API}/${new mongoose.Types.ObjectId()}`, indiaToken);
    check("D28: unknown (well-formed but nonexistent) applicationId -> 404", unknownRes.status === 404, unknownRes.status);
  }

  // ── FINAL DATA INTEGRITY (this run made zero writes to application/
  // KYC/training/test state beyond its own intentional B12 approval) ──
  {
    const stillAdminReview = await FieldAgentApplication.findById(queueFixture.application._id).select("status").lean();
    check("no unintended mutation: the primary queue fixture is still ADMIN_REVIEW at the end of the run", stillAdminReview.status === "ADMIN_REVIEW", stillAdminReview.status);
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
  check("zero FA-4.3 FieldAgent fixtures remain (no residue)", remainingProfiles === 0, remainingProfiles);
  const remainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.3 FieldAgentApplication fixtures remain (no residue)", remainingApplications === 0, remainingApplications);
  const remainingUsers = await User.countDocuments({ _id: { $in: fixtureUserIds } });
  check("zero FA-4.3 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);
  const remainingKyc = await KYC.countDocuments({ ownerId: { $in: fixtureUserIds } });
  check("zero FA-4.3 KYC fixtures remain (no residue)", remainingKyc === 0, remainingKyc);

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(
    `\n🧹 Cleanup: removed ${userDelete.deletedCount} user(s), ${applicationDelete.deletedCount} application(s), ${profileDelete.deletedCount} FieldAgent profile(s), ${kycDelete.deletedCount} KYC doc(s), ${trainingDelete.deletedCount} training enrollment(s), ${attemptDelete.deletedCount} test attempt(s) (phones 9999906xxx). Approval/rejection audit events preserved.`
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
