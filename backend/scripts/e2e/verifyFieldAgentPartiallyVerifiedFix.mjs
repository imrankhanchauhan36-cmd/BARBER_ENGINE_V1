import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";
import State from "../../models/State.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import KYC from "../../modules/kyc/models/KYC.js";
import KYCDocument from "../../modules/kyc/models/KYCDocument.js";
import { authFetch as sharedAuthFetch, requireField } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);
  const anyState = await State.findOne({}).lean();
  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const cleanup = { users: [], applications: [], kycs: [], documents: [] };

  try {
    const phone = `9${Date.now() % 100000000}`.padEnd(10, "4").slice(0, 10);
    const sendOtpRes = await authFetch("/api/field-agent/auth/send-otp", null, { method: "POST", body: JSON.stringify({ phone }) });
    const otp = requireField(sendOtpRes.data, "otp", "send-otp");
    const verifyOtpRes = await authFetch("/api/field-agent/auth/verify-otp", null, { method: "POST", body: JSON.stringify({ phone, otp }) });
    const accessToken = requireField(verifyOtpRes.data, "accessToken", "verify-otp");
    const agentUser = await User.findOne({ phone });
    cleanup.users.push(agentUser._id);
    const application = await FieldAgentApplication.findOne({ userRef: agentUser._id });
    cleanup.applications.push(application._id);

    await authFetch("/api/field-agent/applications/me", accessToken, { method: "PATCH", body: JSON.stringify({ basicProfile: { name: "ZE2E_PARTIAL" }, requestedZone: { stateRef: anyState._id.toString() } }) });
    await authFetch("/api/field-agent/applications/me/submit", accessToken, { method: "POST", body: JSON.stringify({}) });

    // Identity (raw, not yet verified) + Bank + Documents — normal flow
    await authFetch("/api/field-agent/kyc/identity", accessToken, { method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "ZE2E PARTIAL", aadhaarNumber: "123456789012" }) });
    await authFetch("/api/field-agent/kyc/bank", accessToken, { method: "POST", body: JSON.stringify({ accountHolder: "ZE2E PARTIAL", accountNumber: "123456789012345", ifsc: "HDFC0001234", bankName: "ZE2E Test Bank" }) });
    const kyc = await KYC.findOne({ ownerId: agentUser._id });
    cleanup.kycs.push(kyc._id);
    const DOC_KEY_TO_TYPE = { panCard: "PAN_CARD", aadhaarFront: "AADHAAR_FRONT", aadhaarBack: "AADHAAR_BACK", selfie: "SELFIE" };
    for (const key of Object.keys(DOC_KEY_TO_TYPE)) {
      const doc = await KYCDocument.create({ ownerId: agentUser._id, kycId: kyc._id, documentType: DOC_KEY_TO_TYPE[key], originalUrl: `https://fixture.invalid/pv_${key}.jpg`, mimeType: "image/jpeg", sizeBytes: 1024, status: "UPLOADED", version: 1, isCurrentVersion: true, uploadedBy: agentUser._id });
      cleanup.documents.push(doc._id);
      kyc.documents = kyc.documents || {};
      kyc.documents[key] = doc._id;
    }
    await kyc.save();

    // Trigger self-serve PAN auto-verification — exactly what
    // FieldAgentKycIdentityScreen.js's own "Verify PAN" action calls.
    // Real provider may or may not confirm a fixture PAN — either way,
    // we assert on the ACTUAL resulting kyc.status afterward, not a
    // guessed outcome.
    const verifyPanRes = await authFetch("/api/field-agent/kyc/verify/pan", accessToken, {
      method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "ZE2E PARTIAL" }),
    });
    const kycAfterVerify = await KYC.findById(kyc._id);
    console.log("After self-serve PAN verify: kyc.status =", kycAfterVerify.status, "| verify response success:", verifyPanRes.data?.success, verifyPanRes.data?.data?.panVerified);

    if (kycAfterVerify.status !== "PARTIALLY_VERIFIED") {
      // The real verification provider (manual/Surepass) didn't flip it
      // this run — force the exact state via direct write so this test
      // still proves the FRONTEND/ADMIN contract fix regardless of the
      // 3rd-party provider's live behavior (never mocking the
      // /kyc/submit or /admin/kyc endpoints under test — only seeding
      // the precondition state, same convention as this suite's other
      // [VALID FIXTURE] steps).
      kycAfterVerify.status = "PARTIALLY_VERIFIED";
      await kycAfterVerify.save();
      console.log("(forced kyc.status = PARTIALLY_VERIFIED as a fixture precondition — provider did not naturally produce it this run)");
    }

    const kycNow = await KYC.findById(kyc._id).lean();
    check("1. KYC is at PARTIALLY_VERIFIED (the exact stuck state reported)", kycNow.status === "PARTIALLY_VERIFIED", kycNow.status);

    // ── This is the backend contract FieldAgentKycReviewScreen.js's
    // fixed `editable` check now correctly exposes a Submit button for ──
    const submitRes = await authFetch("/api/field-agent/kyc/submit", accessToken, { method: "POST", body: JSON.stringify({}) });
    check("2. POST /kyc/submit succeeds FROM PARTIALLY_VERIFIED (backend already allowed this)", submitRes.status === 200, submitRes);
    const kycAfterSubmit = await KYC.findById(kyc._id).lean();
    check("3. kyc.status becomes PENDING after submit", kycAfterSubmit.status === "PENDING", kycAfterSubmit.status);

    // ── Admin side: can it be found via the restored PARTIALLY_VERIFIED filter, and via PENDING now that it's submitted? ──
    const pendingListRes = await authFetch(`/api/admin/kyc?page=1&limit=20&status=PENDING`, indiaToken);
    check("4. Admin Pending queue includes it now that it's actually submitted", (pendingListRes.data?.data || []).some(r => r.id === String(kyc._id)), pendingListRes.data?.data?.length);

    // Also directly prove the ADMIN-SIDE bug fix: PARTIALLY_VERIFIED
    // itself must be a reachable filter (simulating an admin catching
    // it BEFORE the applicant manages to resubmit).
    await KYC.updateOne({ _id: kyc._id }, { $set: { status: "PARTIALLY_VERIFIED" } });
    const partialListRes = await authFetch(`/api/admin/kyc?page=1&limit=20&status=PARTIALLY_VERIFIED`, indiaToken);
    check("5. Admin can filter status=PARTIALLY_VERIFIED and find it (was impossible via the Queue's old 3-option filter)", (partialListRes.data?.data || []).some(r => r.id === String(kyc._id)), partialListRes.data?.data?.length);

    const detailRes = await authFetch(`/api/admin/kyc/${kyc._id}`, indiaToken);
    check("6. Detail status is PARTIALLY_VERIFIED (Approve/Reject actionable per isPending gate)", detailRes.data?.data?.status === "PARTIALLY_VERIFIED", detailRes.data?.data?.status);

    const approveRes = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaToken, { method: "PATCH", body: JSON.stringify({}) });
    check("7. Approve succeeds directly from PARTIALLY_VERIFIED (backend never blocked this)", approveRes.status === 200 && approveRes.data?.data?.status === "VERIFIED", approveRes);

  } catch (err) {
    console.error("FATAL:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    await KYCDocument.deleteMany({ _id: { $in: cleanup.documents } });
    await KYC.deleteMany({ _id: { $in: cleanup.kycs } });
    await FieldAgentApplication.deleteMany({ _id: { $in: cleanup.applications } });
    await User.deleteMany({ _id: { $in: cleanup.users } });
    server.close();
    await mongoose.disconnect();
  }

  console.log(results.join("\n"));
  console.log(`\nPARTIALLY_VERIFIED Fix Regression: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};
run();
