/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyOwnerKycVerifyPanRouteResolution.mjs
 *
 * PRODUCTION KYC 404 — ROUTE-RESOLUTION VALIDATION (Step 3 of the
 * approved release plan), additive, 2026-10-13.
 *
 * WHY THIS NEW FILE WAS NECESSARY (explained before creation, per the
 * explicit restriction "do not change files unless an isolated test
 * requires a new test-only file and its necessity is explained
 * first"): every EXISTING KYC e2e script that exercises this exact
 * route (verifyPhase3bKycSecurityHardening.mjs,
 * verifyPhase3bConcurrencyAndExpiry.mjs) does `import "dotenv/config"`
 * and `await connectDB()` — i.e. connects to whatever MONGODB_URI the
 * real .env currently holds, which this engagement has treated as
 * off-limits all session (never loaded, never assumed safe). The one
 * EXISTING file that avoids that — scripts/runIsolatedKycTestServer.js
 * (+ its bootstrap) — deliberately connects ONLY to a dedicated local
 * replica set at 127.0.0.1:27018 ("rs-zemish-kyc-test", confirmed
 * already running on this machine) via config/testDb.js's own
 * five-condition safety assertion, and boots the REAL, unmodified
 * app.js. That harness is reused here EXACTLY as built — nothing in
 * runIsolatedKycTestServer.js or config/testDb.js is modified — this
 * file only adds the one missing piece: an actual HTTP client that
 * drives one authenticated request at the real route and reports
 * pass/fail, then shuts the harness down via its own existing SIGTERM
 * handler (process.kill(process.pid, "SIGTERM") — the same signal a
 * human pressing Ctrl+C would send to the CLI form of this harness).
 *
 * SAFE BY CONSTRUCTION:
 *   - Database: the SAME dedicated, safety-asserted isolated replica
 *     set the existing harness uses — never MONGODB_URI, never Atlas.
 *   - Redis: SKIP_REDIS_AUTOCONNECT=true (set by runIsolatedKycTestServer.js
 *     itself) — scopedIdempotency/rate-limit middleware run fail-open.
 *   - Provider calls: ZERO, by construction, not by chance.
 *     verifyPAN() (modules/kyc/services/verification.service.js:115-148)
 *     only calls the real Cashfree API when cashfreeConfigured() is
 *     true (modules/kyc/providers/cashfreeVerificationConfig.js:41 —
 *     reads process.env LIVE, every call, never cached), and only
 *     falls to Surepass when SUREPASS_TOKEN is set — otherwise it
 *     resolves to the Manual provider, which makes no network call at
 *     all (confirmed by reading verifyViaNonCashfreeProvider's
 *     selection logic, verificationOrchestrator.service.js:246-255).
 *     This script explicitly `delete`s CASHFREE_VERIFICATION_ENV,
 *     CASHFREE_VERIFICATION_CLIENT_ID, CASHFREE_VERIFICATION_CLIENT_SECRET,
 *     and SUREPASS_TOKEN from process.env immediately after dotenv has
 *     loaded (via the harness's own import) and before any request is
 *     sent — defense in depth, so this is guaranteed network-free
 *     regardless of what the real .env happens to contain. No PAN,
 *     bank, GST, or Aadhaar value used anywhere below is real — the
 *     PAN is a syntactically-valid but fabricated placeholder
 *     (ABCDE1234F), matching the format-only validation
 *     verifyOwnerPANHandler itself performs before any provider call.
 *   - Goal: ONLY confirm route resolution (not a 404, reaching the
 *     real handler) — matching Step 3's explicit scope. Not a
 *     re-test of Cashfree business logic, which the existing Phase
 *     3b/7A suites already cover elsewhere.
 *
 * Run:  cd backend && node scripts/e2e/verifyOwnerKycVerifyPanRouteResolution.mjs
 */

import { computeTestDatabaseConfirmationToken } from "../../config/testDb.js";
import { run } from "../runIsolatedKycTestServer.js";

const TEST_URI = "mongodb://127.0.0.1:27018/zemish_kyc_isolated_test?replicaSet=rs-zemish-kyc-test";
process.env.TEST_MONGODB_URI = TEST_URI;
process.env.TEST_DATABASE_NAME_ALLOWLIST = "zemish_kyc_isolated_test";
process.env.CONFIRM_TEST_DATABASE = computeTestDatabaseConfirmationToken(TEST_URI);

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const TEST_SERVER_PORT = 6061; // matches runIsolatedKycTestServer.js's own constant

const run_ = async () => {
  await run(); // starts the isolated harness: safety-asserted test DB, SKIP_REDIS_AUTOCONNECT, real app.js, listening on 6061

  // Defense in depth — guarantee zero live provider calls regardless
  // of what the real .env (already loaded by the harness's own
  // "dotenv/config" import) happens to contain. cashfreeConfigured()
  // and surepassConfigured read these LIVE on every call, so deleting
  // them here, before any request, is fully effective.
  delete process.env.CASHFREE_VERIFICATION_ENV;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  delete process.env.SUREPASS_TOKEN;

  const { default: User } = await import("../../models/User.js");
  const { default: KYC } = await import("../../modules/kyc/models/KYC.js");
  const { default: VerificationLog } = await import("../../modules/kyc/models/VerificationLog.js");
  const { generateAccessToken } = await import("../../services/token.service.js");

  const baseUrl = `http://127.0.0.1:${TEST_SERVER_PORT}`;
  const httpPost = async (path, body, token) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, data };
  };

  let testUser = null;

  try {
    testUser = await User.create({
      name: "KYC Route Test Owner",
      role: "OWNER",
      phone: "9000000093",
      tokenVersion: 0,
      isActive: true,
    });
    const token = generateAccessToken(testUser);
    check("Minted a real JWT for a disposable OWNER test user in the isolated test DB", typeof token === "string" && token.split(".").length === 3);

    //////////////////////////////////////////////////////////
    // THE ACTUAL CHECK — the exact path/method the frontend sends,
    // byte-for-byte: salon-app/src/features/kyc/services/kycApi.js's
    // EP.VERIFY_PAN = "/api/salon/kyc/verify/pan", client.post(...).
    //////////////////////////////////////////////////////////
    const panRes = await httpPost(
      "/api/salon/kyc/verify/pan",
      { panNumber: "ABCDE1234F", nameOnPAN: "Test Owner" }, // syntactically valid, fabricated — never a real PAN
      token
    );
    check(
      'POST /api/salon/kyc/verify/pan is NOT the global "API route not found" 404 — the route resolves to the real handler',
      panRes.status !== 404 && panRes.data?.message !== "API route not found",
      panRes
    );
    check("Response came from the real handler (200, with the documented {success,message,data:{success,source,remarks}} envelope)", panRes.status === 200 && typeof panRes.data?.data?.success === "boolean", panRes);
    check('Provider source is "manual" (or absent/null) — confirms NO live Cashfree/Surepass call occurred for this request', !panRes.data?.data?.source || /manual/i.test(String(panRes.data.data.source)), panRes.data?.data);

    // Same route-resolution check for /verify/bank and /verify/gst —
    // Step 2 explicitly asked whether the candidate release also
    // covers these. Minimal, format-only bodies; same zero-provider-
    // call guarantee (bank verification has no Cashfree branch at all
    // — see verifyViaNonCashfreeProvider's BANK_MANUAL-only path).
    const bankRes = await httpPost(
      "/api/salon/kyc/verify/bank",
      { accountHolder: "Test Owner", accountNumber: "000111222333", ifsc: "HDFC0000001", bankName: "Test Bank" },
      token
    );
    check('POST /api/salon/kyc/verify/bank is NOT a 404 either — route resolves', bankRes.status !== 404 && bankRes.data?.message !== "API route not found", bankRes);

    const gstRes = await httpPost(
      "/api/salon/kyc/verify/gst",
      { gstNumber: "22AAAAA0000A1Z5" }, // syntactically valid GSTIN format, fabricated
      token
    );
    check('POST /api/salon/kyc/verify/gst is NOT a 404 either — route resolves', gstRes.status !== 404 && gstRes.data?.message !== "API route not found", gstRes);

  } finally {
    // Cleanup — remove the disposable fixtures this script created in
    // the isolated test DB (never touches anything else).
    if (testUser) {
      await KYC.deleteMany({ ownerId: testUser._id }).catch(() => {});
      await VerificationLog.deleteMany({ ownerId: testUser._id }).catch(() => {});
      await User.deleteOne({ _id: testUser._id }).catch(() => {});
    }
  }

  console.log(rows.join("\n"));
  console.log(`\nOWNER KYC VERIFY-ROUTE RESOLUTION (ISOLATED, ZERO PROVIDER CALLS): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);

  // Reuse the harness's own, already-built shutdown path — same signal
  // a human pressing Ctrl+C on the CLI form would send.
  process.kill(process.pid, "SIGTERM");
};

run_().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
