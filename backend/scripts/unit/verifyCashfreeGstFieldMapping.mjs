/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyCashfreeGstFieldMapping.mjs
 *
 * ZEMISH Cashfree field-mapping fix — focused offline test for
 * verifyGSTCashfree's `legalName`/`tradeName` fields, proving they now
 * read Cashfree's real, documented Verify GSTIN response fields
 * `legal_name_of_business`/`trade_name_of_business` (confirmed against
 * an official sample response and reproduced live in a real Sandbox
 * call against test GSTIN 29AAICP2912R1ZR), not the previous,
 * incorrect `legal_name`/`trade_name` (which do not exist in
 * Cashfree's real response and always resolved to null).
 *
 * NO live network call: globalThis.fetch is temporarily replaced with
 * a local stub returning a fixture response shaped exactly like
 * Cashfree's real documented sample, so this exercises the REAL,
 * imported verifyGSTCashfree() end-to-end (request building, response
 * parsing, field mapping) without ever reaching the network. Restored
 * in a finally block, same for the disposable env vars this needs to
 * pass the "configured" check. `gst_in_status` (already correct
 * before this fix) is asserted too, to prove it was never touched.
 *
 * Run:  cd backend && node scripts/unit/verifyCashfreeGstFieldMapping.mjs
 */

import { verifyGSTCashfree } from "../../modules/kyc/providers/cashfree.provider.js";

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
    // reports configured:true and verifyGSTCashfree proceeds to call
    // the (stubbed) fetch; never real, never logged.
    process.env.CASHFREE_VERIFICATION_ENV = "SANDBOX";
    process.env.CASHFREE_VERIFICATION_CLIENT_ID = "offline-test-fixture-id";
    process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = "offline-test-fixture-secret";

    // ── 1. The exact official documented sample shape ──
    globalThis.fetch = stubFetch({
      reference_id: 19,
      GSTIN: "29AAICP2912R1ZR",
      legal_name_of_business: "UJJIVAN SMALL FINANCE BANK LIMITED",
      trade_name_of_business: "UJJIVAN SMALL FINANCE BANK",
      gst_in_status: "Active",
      valid: true,
      message: "GSTIN Exists",
    });
    const result = await verifyGSTCashfree({ gstNumber: "29AAICP2912R1ZR" });
    check("1. legal_name_of_business maps to data.legalName", result.data?.legalName === "UJJIVAN SMALL FINANCE BANK LIMITED", result);
    check("1. trade_name_of_business maps to data.tradeName", result.data?.tradeName === "UJJIVAN SMALL FINANCE BANK");
    check("1. gst_in_status (already correct before this fix) still maps to data.gstStatus, unaffected", result.data?.gstStatus === "Active");
    check("1. success is true", result.success === true);
    check("1. stubbed fetch hit the real sandbox GST endpoint (never a live call)", String(stubFetch.lastUrl).endsWith("/gstin"));

    // ── 2. Regression guard — the OLD, wrong field names must NOT be
    // read even if a response happened to carry them (proves the fix
    // targets the real field names, not a coincidence) ──
    globalThis.fetch = stubFetch({
      GSTIN: "29AAICP2912R1ZR",
      legal_name_of_business: "REAL LEGAL NAME",
      trade_name_of_business: "REAL TRADE NAME",
      legal_name: "THIS_SHOULD_NEVER_BE_READ",
      trade_name: "THIS_SHOULD_NEVER_BE_READ",
      gst_in_status: "Active",
      valid: true,
    });
    const bothFieldsResult = await verifyGSTCashfree({ gstNumber: "29AAICP2912R1ZR" });
    check("2. When both the real and stray old field names are present, legalName reads the real one", bothFieldsResult.data?.legalName === "REAL LEGAL NAME");
    check("2. When both the real and stray old field names are present, tradeName reads the real one", bothFieldsResult.data?.tradeName === "REAL TRADE NAME");

    // ── 3. Defensive — a response missing both fields entirely must
    // not throw, and must fall back to null ──
    globalThis.fetch = stubFetch({ GSTIN: "29AAICP2912R1ZR", gst_in_status: "Active", valid: true });
    const missingFieldsResult = await verifyGSTCashfree({ gstNumber: "29AAICP2912R1ZR" });
    check("3. Missing legal_name_of_business: legalName is null, does not throw", missingFieldsResult.data?.legalName === null);
    check("3. Missing trade_name_of_business: tradeName is null, does not throw", missingFieldsResult.data?.tradeName === null);
    check("3. gstStatus still correctly populated even when the name fields are absent", missingFieldsResult.data?.gstStatus === "Active");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv !== undefined) process.env.CASHFREE_VERIFICATION_ENV = savedEnv; else delete process.env.CASHFREE_VERIFICATION_ENV;
    if (savedId !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_ID = savedId; else delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
    if (savedSecret !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = savedSecret; else delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  }

  check("4. Test-process fetch and env fully restored after the test", globalThis.fetch === savedFetch && process.env.CASHFREE_VERIFICATION_ENV === savedEnv);

  console.log(rows.join("\n"));
  console.log(`\nCASHFREE GST FIELD MAPPING: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
