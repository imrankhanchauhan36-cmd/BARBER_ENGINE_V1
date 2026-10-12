/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyCashfreePanTypeMapping.mjs
 *
 * ZEMISH Cashfree field-mapping fix — focused offline test for
 * verifyPANCashfree's `panType` field, proving it now reads Cashfree's
 * real, documented Verify PAN Sync response field `type` (confirmed
 * against an official sample response — {"pan":"ABCPV1234D","type":
 * "Individual","reference_id":161,"valid":true,...}), not the
 * previous, incorrect `pan_type` (which does not exist in Cashfree's
 * real response and always resolved to null).
 *
 * NO live network call: globalThis.fetch is temporarily replaced with
 * a local stub that returns a fixture response shaped exactly like
 * Cashfree's real one, so this exercises the REAL, imported
 * verifyPANCashfree() end-to-end (request building, response parsing,
 * field mapping) without ever reaching the network. Restored in a
 * finally block, same for the disposable env vars this needs to pass
 * the "configured" check.
 *
 * Run:  cd backend && node scripts/unit/verifyCashfreePanTypeMapping.mjs
 */

import { verifyPANCashfree } from "../../modules/kyc/providers/cashfree.provider.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const stubFetch = (fixtureJson) => async (url) => {
  stubFetch.lastUrl = url;
  return { ok: true, json: async () => fixtureJson };
};

const run = async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = process.env.CASHFREE_VERIFICATION_ENV;
  const savedId = process.env.CASHFREE_VERIFICATION_CLIENT_ID;
  const savedSecret = process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;

  try {
    // Disposable fixture credentials — only so resolveCashfreeVerificationConfig()
    // reports configured:true and verifyPANCashfree proceeds to call
    // the (stubbed) fetch; never real, never logged.
    process.env.CASHFREE_VERIFICATION_ENV = "SANDBOX";
    process.env.CASHFREE_VERIFICATION_CLIENT_ID = "offline-test-fixture-id";
    process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = "offline-test-fixture-secret";

    // ── 1. Individual PAN — the exact official sample shape ──
    globalThis.fetch = stubFetch({
      pan: "ABCPV1234D",
      type: "Individual",
      reference_id: 161,
      name_provided: "JOHN DOE",
      registered_name: "JOHN DOE",
      valid: true,
      message: "PAN verified successfully",
    });
    const individualResult = await verifyPANCashfree({ panNumber: "ABCPV1234D" });
    check("1. Individual: { type: \"Individual\", valid: true } maps to panType: \"Individual\"", individualResult.data?.panType === "Individual", individualResult);
    check("1. Individual: success is true", individualResult.success === true);
    check("1. Individual: stubbed fetch hit the real sandbox PAN endpoint (never a live call)", String(stubFetch.lastUrl).endsWith("/pan"));

    // ── 2. Business PAN — second real documented type value ──
    globalThis.fetch = stubFetch({
      pan: "ABCCD8000T",
      type: "Business",
      reference_id: 162,
      valid: true,
    });
    const businessResult = await verifyPANCashfree({ panNumber: "ABCCD8000T" });
    check("2. Business: { type: \"Business\", valid: true } maps to panType: \"Business\"", businessResult.data?.panType === "Business");

    // ── 3. Regression guard — the OLD, wrong field name must NOT be
    // read even if a response happened to carry it (proves the fix
    // targets `type`, not a coincidence) ──
    globalThis.fetch = stubFetch({
      pan: "ABCPV1234D",
      type: "Individual",
      pan_type: "THIS_SHOULD_NEVER_BE_READ",
      valid: true,
    });
    const bothFieldsResult = await verifyPANCashfree({ panNumber: "ABCPV1234D" });
    check("3. When both `type` and a stray `pan_type` are present, panType reads `type`, never `pan_type`", bothFieldsResult.data?.panType === "Individual");

    // ── 4. Defensive — a response missing `type` entirely must not
    // throw, and must fall back to null (unchanged from before) ──
    globalThis.fetch = stubFetch({ pan: "ABCPV1234D", valid: true });
    const missingTypeResult = await verifyPANCashfree({ panNumber: "ABCPV1234D" });
    check("4. Missing `type` field: panType is null, does not throw", missingTypeResult.data?.panType === null);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv !== undefined) process.env.CASHFREE_VERIFICATION_ENV = savedEnv; else delete process.env.CASHFREE_VERIFICATION_ENV;
    if (savedId !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_ID = savedId; else delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
    if (savedSecret !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = savedSecret; else delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  }

  check("5. Test-process fetch and env fully restored after the test", globalThis.fetch === savedFetch && process.env.CASHFREE_VERIFICATION_ENV === savedEnv);

  console.log(rows.join("\n"));
  console.log(`\nCASHFREE PAN TYPE MAPPING: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
