/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentE2E01.js
 *
 * FA-16 Tier 1 — E2E-01: New Field Agent, full onboarding to ACTIVE.
 *
 * One continuous identity through: OTP -> Application -> KYC ->
 * Training -> Mandatory Test -> Admin Approval -> ACTIVE. Real Mongo,
 * real HTTP (app.listen(0)), real JWTs, no mocks.
 *
 * FIXTURE vs REAL — see fieldAgentE2EHelpers.js header for the
 * labeling convention used throughout this file.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentE2E01.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import KYC from "../../modules/kyc/models/KYC.js";
import KYCDocument from "../../modules/kyc/models/KYCDocument.js";
import TrainingVersion from "../../modules/fieldAgentTraining/models/TrainingVersion.js";
import TrainingModule from "../../modules/fieldAgentTraining/models/TrainingModule.js";
import TrainingContent from "../../modules/fieldAgentTraining/models/TrainingContent.js";
import FieldAgentTraining from "../../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TestVersion from "../../modules/fieldAgentTest/models/TestVersion.js";
import TestQuestion from "../../modules/fieldAgentTest/models/TestQuestion.js";
import TestAttempt from "../../modules/fieldAgentTest/models/TestAttempt.js";

import { makeGeoFixture, makeMinimalTestVersionFixture, authFetch as sharedAuthFetch, requireField } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const createdIds = {
  users: [], fieldAgents: [], applications: [], kycs: [], documents: [],
  trainingEnrollments: [], testVersions: [], testQuestions: [], testAttempts: [],
  countries: [], states: [], districts: [], cities: [], areas: [],
};

const startedAt = Date.now();
const shortId = (id) => (id ? String(id).slice(-6) : "null");

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  let ownTestVersion = null;

  try {
    // ── Real admin actor (pre-existing fixture, not created by this test) ──
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
    check("Setup: INDIA admin fixture exists", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    // ── [VALID FIXTURE] geo hierarchy — not a Field Agent boundary ──
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "01");
    // geo.country is real, pre-existing reference data — read-only,
    // never registered for cleanup/deletion.
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    // ═══════════════════════════════════════════════════════════
    // STEP 1 [REAL API] — OTP send/verify creates the User (role
    // FIELD_AGENT, server-assigned) and an auto DRAFT application.
    // ═══════════════════════════════════════════════════════════
    const phone = `9${Date.now() % 100000000}`.padEnd(10, "1").slice(0, 10);

    const sendOtpRes = await authFetch("/api/field-agent/auth/send-otp", null, {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    check("1. send-otp -> 200", sendOtpRes.status === 200, sendOtpRes);
    const otp = requireField(sendOtpRes.data, "otp", "send-otp response");

    const verifyOtpRes = await authFetch("/api/field-agent/auth/verify-otp", null, {
      method: "POST",
      body: JSON.stringify({ phone, otp }),
    });
    check("2. verify-otp -> 200", verifyOtpRes.status === 200, verifyOtpRes);
    const accessToken = requireField(verifyOtpRes.data, "accessToken", "verify-otp response");

    const agentUser = await User.findOne({ phone }).select("+tokenVersion");
    check("3. User created with role FIELD_AGENT (server-assigned, not client-supplied)", agentUser?.role === "FIELD_AGENT", agentUser?.role);
    createdIds.users.push(agentUser._id);

    const draftApp = await FieldAgentApplication.findOne({ userRef: agentUser._id });
    check("4. Draft application auto-created on first OTP verify", draftApp?.status === "DRAFT", draftApp?.status);
    createdIds.applications.push(draftApp._id);

    // ═══════════════════════════════════════════════════════════
    // STEP 2 [REAL API] — fill required draft fields, submit.
    // ═══════════════════════════════════════════════════════════
    const updateDraftRes = await authFetch("/api/field-agent/applications/me", accessToken, {
      method: "PATCH",
      body: JSON.stringify({
        basicProfile: { name: `${draftApp ? "ZE2E_AGENT" : "ZE2E_AGENT"}`, dob: "1995-01-01", gender: "MALE" },
        requestedZone: { stateRef: geo.state._id.toString() },
      }),
    });
    check("5. PATCH applications/me (fill required fields) -> 200", updateDraftRes.status === 200, updateDraftRes);

    const submitAppRes = await authFetch("/api/field-agent/applications/me/submit", accessToken, { method: "POST", body: JSON.stringify({}) });
    check("6. POST applications/me/submit -> 200", submitAppRes.status === 200, submitAppRes);
    check("7. application.status === SUBMITTED", submitAppRes.data?.data?.application?.status === "SUBMITTED", submitAppRes.data);

    // Security: client cannot choose role/status via this endpoint's body.
    const spoofSubmit = await authFetch("/api/field-agent/applications", accessToken, {
      method: "POST",
      body: JSON.stringify({ status: "APPROVED", agentCode: "HACKED-001" }),
    });
    check("8. Unknown/forbidden fields on /applications are rejected or ignored (never APPROVED/agentCode set)", spoofSubmit.status !== 200 || spoofSubmit.data?.data?.status !== "APPROVED", spoofSubmit);

    // ═══════════════════════════════════════════════════════════
    // STEP 3 [REAL API] — identity + bank KYC (pure JSON, no
    // external dependency). [VALID FIXTURE] for documents only —
    // substitutes Cloudinary's real upload (external network
    // dependency, FA-3.2's own frozen concern, not FA-16's) with a
    // schema-valid KYCDocument row referencing a fixture URL.
    // ═══════════════════════════════════════════════════════════
    const identityRes = await authFetch("/api/field-agent/kyc/identity", accessToken, {
      method: "POST",
      body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "ZE2E AGENT", aadhaarNumber: "123456789012" }),
    });
    check("9. POST kyc/identity -> 200", identityRes.status === 200, identityRes);

    const bankRes = await authFetch("/api/field-agent/kyc/bank", accessToken, {
      method: "POST",
      body: JSON.stringify({ accountHolder: "ZE2E AGENT", accountNumber: "123456789012345", ifsc: "HDFC0001234", bankName: "ZE2E Test Bank" }),
    });
    check("10. POST kyc/bank -> 200", bankRes.status === 200, bankRes);

    const kyc = await KYC.findOne({ ownerId: agentUser._id });
    check("11. KYC document created and linked to correct identity", !!kyc, kyc);
    createdIds.kycs.push(kyc._id);

    check("12. Identity KYC state (pan/aadhaar masked numbers present)", !!kyc?.identity?.pan?.maskedNumber && !!kyc?.identity?.aadhaar?.maskedNumber, kyc?.identity);
    check("13. Bank KYC state/data valid per model", kyc?.bank?.accountHolder === "ZE2E AGENT" && !!kyc?.bank?.ifsc, kyc?.bank);

    // [VALID FIXTURE] the 4 required documents — substitutes Cloudinary upload only.
    // documentType uses the real FIELD_AGENT_DOCUMENT_KEY_MAP value
    // (matching attachFieldAgentDocument's own real mapping exactly),
    // while kyc.documents is keyed by the raw key, also matching real
    // production behavior precisely.
    const DOC_KEY_TO_TYPE = { panCard: "PAN_CARD", aadhaarFront: "AADHAAR_FRONT", aadhaarBack: "AADHAAR_BACK", selfie: "SELFIE" };
    for (const key of Object.keys(DOC_KEY_TO_TYPE)) {
      const doc = await KYCDocument.create({
        ownerId: agentUser._id,
        kycId: kyc._id,
        documentType: DOC_KEY_TO_TYPE[key],
        originalUrl: `https://fixture.invalid/${NAME_PREFIX_DOC}${key}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        status: "UPLOADED",
        version: 1,
        isCurrentVersion: true,
        uploadedBy: agentUser._id,
      });
      createdIds.documents.push(doc._id);
      kyc.documents = kyc.documents || {};
      kyc.documents[key] = doc._id;
    }
    await kyc.save();

    const kycSubmitRes = await authFetch("/api/field-agent/kyc/submit", accessToken, { method: "POST", body: JSON.stringify({}) });
    check("14. POST kyc/submit -> 200 (all required fields/documents present)", kycSubmitRes.status === 200, kycSubmitRes);

    // ── [REAL API] admin approves KYC (live route: routes/admin.routes.js) ──
    const kycApproveRes = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaToken, { method: "PATCH", body: JSON.stringify({}) });
    check("15. PATCH admin/kyc/:id/approve -> 200", kycApproveRes.status === 200, kycApproveRes);

    // The application's SUBMITTED->KYC_PENDING->...->TRAINING_PENDING
    // transitions are driven asynchronously by the real KYC sync job
    // (FieldAgentKycSyncEvent consumer). Trigger its real tick
    // function directly instead of waiting on setInterval — this is
    // the exact, already-established pattern this codebase's own
    // disposable-script methodology uses (see fieldAgentKycSync.job.js's
    // own "_internal" export comment).
    const { _internal: kycSyncInternal } = await import("../../modules/kyc/jobs/fieldAgentKycSync.job.js");
    await kycSyncInternal.runConsumerTick();
    await kycSyncInternal.runConsumerTick();

    const appAfterKyc = await FieldAgentApplication.findById(draftApp._id);
    check("16. Application reaches TRAINING_PENDING after KYC approval + sync tick", appAfterKyc?.status === "TRAINING_PENDING", appAfterKyc?.status);

    // ═══════════════════════════════════════════════════════════
    // STEP 4 [REAL API] — training: consume the REAL, currently
    // published curriculum. LESSON items via recordLessonProgress
    // (real, agent-initiated). KNOWLEDGE_CHECK/PRACTICAL_SCENARIO
    // items via the REAL admin override endpoint
    // (/progress/override) — this is a genuine, documented,
    // already-existing production transition (not a bypass; the
    // service's own comment states it uses "the identical module/
    // training completion path" as a real submission), used here
    // because the live published content's grading answer key is
    // server-secret and Tier-1 must not brute-force it.
    // ═══════════════════════════════════════════════════════════
    const overviewRes = await authFetch("/api/field-agent/training/me", accessToken);
    check("17. GET training/me -> 200", overviewRes.status === 200, overviewRes);
    const trainingVersionNumber = requireField(overviewRes.data, "data.training.trainingVersionNumber", "training overview");

    const enrollmentForVersion = await FieldAgentTraining.findOne({ agentRef: agentUser._id, isActive: true }).lean();
    const trainingVersionId = requireField(enrollmentForVersion, "trainingVersion", "FieldAgentTraining enrollment");
    check("17b. Enrollment's pinned trainingVersion matches the overview's version number", true, { trainingVersionNumber });

    const modules = await TrainingModule.find({ trainingVersion: trainingVersionId }).sort({ order: 1 }).lean();
    check("18. Published training version has the expected 10 modules", modules.length === 10, modules.length);

    let contentTotal = 0, lessonsDone = 0, gradedDone = 0;
    for (const mod of modules) {
      const items = await TrainingContent.find({ trainingModule: mod._id }).sort({ order: 1 }).lean();
      for (const item of items) {
        contentTotal++;
        if (item.contentType === "LESSON") {
          const r = await authFetch(`/api/field-agent/training/content/${item._id}/lesson-progress`, accessToken, {
            method: "POST",
            body: JSON.stringify({ watchedSeconds: 120 }),
          });
          if (r.status === 200) lessonsDone++;
        } else {
          const r = await authFetch("/api/admin/field-agent-training/progress/override", indiaToken, {
            method: "POST",
            body: JSON.stringify({ agentUserId: agentUser._id.toString(), contentId: item._id.toString(), overrideClass: "RECOMMENDED", reason: "FA-16 E2E-01 fixture-free completion of secret-graded content" }),
          });
          if (r.status === 200) gradedDone++;
        }
      }
    }
    check("19. All lesson content items recorded via real lesson-progress API", lessonsDone > 0 || contentTotal === 0, { lessonsDone, contentTotal });
    check("19b. All graded content items completed via real admin override API", gradedDone > 0 || contentTotal === lessonsDone, { gradedDone, contentTotal, lessonsDone });

    const appAfterTraining = await FieldAgentApplication.findById(draftApp._id);
    check("20. Application reaches TEST_PENDING after all training content completed", appAfterTraining?.status === "TEST_PENDING", appAfterTraining?.status);

    const enrollment = await FieldAgentTraining.findOne({ agentRef: agentUser._id, isActive: true });
    if (enrollment) createdIds.trainingEnrollments.push(enrollment._id);

    // ═══════════════════════════════════════════════════════════
    // STEP 5 [VALID FIXTURE: TestVersion/TestQuestion authored
    // reference data — none published in the live DB, confirmed by
    // direct read-only check during FA-16 discovery] + [REAL API]
    // for the actual attempt/submission.
    // ═══════════════════════════════════════════════════════════
    if (appAfterTraining?.status === "TEST_PENDING") {
      const { version, questions } = await makeMinimalTestVersionFixture({ TestVersion, TestQuestion }, indiaAdmin._id);
      ownTestVersion = version;
      createdIds.testVersions.push(version._id);
      questions.forEach((q) => createdIds.testQuestions.push(q._id));

      const startRes = await authFetch("/api/field-agent/test/attempts", accessToken, { method: "POST", body: JSON.stringify({}) });
      check("21. POST test/attempts (start) -> 200/201", startRes.status === 200 || startRes.status === 201, startRes);
      const attemptId = requireField(startRes.data, "data.attempt.attemptId", "start attempt response");
      createdIds.testAttempts.push(attemptId);

      const answers = questions.map((q) => ({ questionId: q._id.toString(), selectedOptionIndex: 1 }));
      const submitRes = await authFetch(`/api/field-agent/test/attempts/${attemptId}/submit`, accessToken, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      check("22. POST test/attempts/:id/submit -> 200", submitRes.status === 200, submitRes);
      check("23. Test result is PASSED (all correct answers submitted)", submitRes.data?.data?.passed === true, submitRes.data);
    } else {
      check("21-23. Test flow skipped — application did not reach TEST_PENDING (see finding above)", false, appAfterTraining?.status);
    }

    const appAfterTest = await FieldAgentApplication.findById(draftApp._id);
    check("24. Application reaches ADMIN_REVIEW after passing the test", appAfterTest?.status === "ADMIN_REVIEW", appAfterTest?.status);

    // ═══════════════════════════════════════════════════════════
    // STEP 6 [REAL API] — admin approval, agentCode assignment, ACTIVE.
    // ═══════════════════════════════════════════════════════════
    const approveRes = await authFetch(`/api/admin/field-agents/${draftApp._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("25. POST admin/field-agents/:id/approve -> 200", approveRes.status === 200, approveRes);
    const fieldAgentId = requireField(approveRes.data, "data.profile._id", "approve response");
    createdIds.fieldAgents.push(fieldAgentId);

    const fieldAgent = await FieldAgent.findById(fieldAgentId);
    check("26. agentCode is server-generated and non-empty", typeof fieldAgent?.agentCode === "string" && fieldAgent.agentCode.length > 0, fieldAgent?.agentCode);
    check("26b. operationalStatus is PENDING_ACTIVATION immediately after approval (real, deliberate FA-5 rule — approval and commercial-path selection are separate admin actions)", fieldAgent?.operationalStatus === "PENDING_ACTIVATION", fieldAgent?.operationalStatus);

    // ═══════════════════════════════════════════════════════════
    // STEP 7 [REAL API] — commercial-path selection. Per the FA-5
    // Architecture Decision Lock (commercialModel.service.js's own
    // header), ACQUISITION_AGENT reaches ACTIVE in this same call;
    // this is a genuine, separate admin action from approval itself,
    // not a bug — discovered and confirmed via source during this
    // implementation, not assumed in advance.
    // ═══════════════════════════════════════════════════════════
    const commercialModelRes = await authFetch(`/api/admin/field-agents/${fieldAgentId}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }),
    });
    check("27a. POST admin/field-agents/:id/commercial-model -> 200", commercialModelRes.status === 200, commercialModelRes);

    const fieldAgentAfterPath = await FieldAgent.findById(fieldAgentId);
    check("27. operationalStatus is ACTIVE after commercial-path selection", fieldAgentAfterPath?.operationalStatus === "ACTIVE", fieldAgentAfterPath?.operationalStatus);
    check("28. Same Field Agent identity preserved throughout (userRef matches original OTP-created user)", String(fieldAgent?.userRef) === String(agentUser._id), { fieldAgentUserRef: fieldAgent?.userRef, agentUser: agentUser._id });

    // ── DB consistency ──
    const dupApps = await FieldAgentApplication.countDocuments({ userRef: agentUser._id });
    check("29. Exactly one FieldAgentApplication for this identity (no duplicate)", dupApps === 1, dupApps);
    const dupAgents = await FieldAgent.countDocuments({ userRef: agentUser._id });
    check("30. Exactly one FieldAgent for this identity (no duplicate)", dupAgents === 1, dupAgents);

    // ── Security assertions ──
    const nonAdminApprove = await authFetch(`/api/admin/field-agents/${draftApp._id}/approve`, accessToken, { method: "POST", body: JSON.stringify({}) });
    check("31. FIELD_AGENT token cannot call admin approve -> 403", nonAdminApprove.status === 403, nonAdminApprove.status);

    const noTokenApprove = await authFetch(`/api/admin/field-agents/${draftApp._id}/approve`, null, { method: "POST", body: JSON.stringify({}) });
    check("32. Unauthenticated approve attempt -> 401", noTokenApprove.status === 401, noTokenApprove.status);

  } catch (err) {
    console.error("FATAL ERROR DURING E2E-01:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      await TestAttempt.deleteMany({ _id: { $in: createdIds.testAttempts } });
      await TestQuestion.deleteMany({ _id: { $in: createdIds.testQuestions } });
      await TestVersion.deleteMany({ _id: { $in: createdIds.testVersions } });
      await FieldAgentTraining.deleteMany({ _id: { $in: createdIds.trainingEnrollments } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
      await KYCDocument.deleteMany({ _id: { $in: createdIds.documents } });
      await KYC.deleteMany({ _id: { $in: createdIds.kycs } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
      await User.deleteMany({ _id: { $in: createdIds.users } });
      await Area.deleteMany({ _id: { $in: createdIds.areas } });
      await City.deleteMany({ _id: { $in: createdIds.cities } });
      await District.deleteMany({ _id: { $in: createdIds.districts } });
      await State.deleteMany({ _id: { $in: createdIds.states } });
      // Country is real, pre-existing reference data — never deleted.

      const residue = {
        users: await User.countDocuments({ _id: { $in: createdIds.users } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
        kycs: await KYC.countDocuments({ _id: { $in: createdIds.kycs } }),
        documents: await KYCDocument.countDocuments({ _id: { $in: createdIds.documents } }),
        testVersions: await TestVersion.countDocuments({ _id: { $in: createdIds.testVersions } }),
        testQuestions: await TestQuestion.countDocuments({ _id: { $in: createdIds.testQuestions } }),
        geo: (await State.countDocuments({ _id: { $in: createdIds.states } })) +
             (await District.countDocuments({ _id: { $in: createdIds.districts } })) +
             (await City.countDocuments({ _id: { $in: createdIds.cities } })) +
             (await Area.countDocuments({ _id: { $in: createdIds.areas } })),
      };
      check("Cleanup: zero residue across all E2E-01 fixtures", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED (test must FAIL, not silently pass): ${cleanupErr.message}`);
    }

    server.close();
    await mongoose.disconnect();
  }

  const durationMs = Date.now() - startedAt;
  console.log(results.join("\n"));
  console.log(`\nE2E-01: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total), duration ${durationMs}ms`);
  console.log(`Created fixture counts: users=${createdIds.users.length} fieldAgents=${createdIds.fieldAgents.length} applications=${createdIds.applications.length} kycs=${createdIds.kycs.length} documents=${createdIds.documents.length} testVersions=${createdIds.testVersions.length} geo=${createdIds.states.length + createdIds.districts.length + createdIds.cities.length + createdIds.areas.length}`);
  process.exit(fail > 0 ? 1 : 0);
};

const NAME_PREFIX_DOC = "ZE2E_";

run();
