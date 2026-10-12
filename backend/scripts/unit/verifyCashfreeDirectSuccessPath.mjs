/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyCashfreeDirectSuccessPath.mjs
 *
 * Phase 5.3 — Global Verification Engine, offline success-path testing
 * (approved 2026-10-10). Pure unit check: NO database, NO HTTP server,
 * NO network call, NO real credentials anywhere in this file.
 *
 * THESE ARE OFFLINE ORCHESTRATION TESTS, NOT PROVIDER VERIFICATION.
 * Every "successful result" below is a locally-defined, synchronous
 * stand-in function returning a hand-built, sanitized fixture object —
 * never a call to the real verifyPANCashfree/verifyGSTCashfree/
 * verifyBankCashfree, never Cashfree's servers. What this file proves
 * is that verifyViaCashfreeProvider's OWN logic (the allow-list gate,
 * the flag gate, the contract-shape check, the PII check) correctly
 * processes a genuine success shape end-to-end — it does NOT prove
 * anything about whether a REAL Cashfree call would succeed. That is
 * a separate, already-completed, manually-authorized activity from
 * earlier in this session (three isolated real preflights), not
 * something this file repeats or re-verifies.
 *
 * THE TEST SEAM: verifyViaCashfreeProvider (Phase 5.3) now accepts
 * optional `flags` and `providerFunctions` parameters, both defaulting
 * to the real, production values. This file passes its OWN local,
 * disposable objects for both — never touching, mutating, or reading
 * the shared CASHFREE_DIRECT_CAPABILITY_FLAGS export at all. This is
 * NOT monkey-patching (no ES module export is reassigned); it is
 * ordinary dependency injection through the function's own declared
 * parameters. cashfree.provider.js is never imported by this file.
 *
 * Run:  cd backend && node scripts/unit/verifyCashfreeDirectSuccessPath.mjs
 */

import { CHECK_TYPE, verifyViaCashfreeProvider } from "../../modules/kyc/engine/verificationOrchestrator.service.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

// ─── Local, disposable "enabled" flags — never the real shared object ──
const makeLocalEnabledFlags = () => ({
  [CHECK_TYPE.PAN]: { enabled: true, reason: "offline test fixture" },
  [CHECK_TYPE.GST]: { enabled: true, reason: "offline test fixture" },
  [CHECK_TYPE.BANK]: { enabled: true, reason: "offline test fixture" },
});
const makeLocalDisabledFlags = () => ({
  [CHECK_TYPE.PAN]: { enabled: false, reason: "offline test fixture" },
  [CHECK_TYPE.GST]: { enabled: false, reason: "offline test fixture" },
  [CHECK_TYPE.BANK]: { enabled: false, reason: "offline test fixture" },
});
// A deliberately over-permissive flags object that ALSO "enables"
// AADHAAR/FACE/LIVENESS — used only to prove the allow-list gate
// rejects them regardless, before this map is ever even consulted.
const makeOverPermissiveFlags = () => ({
  ...makeLocalEnabledFlags(),
  [CHECK_TYPE.AADHAAR]: { enabled: true, reason: "deliberately permissive test fixture" },
  [CHECK_TYPE.FACE]: { enabled: true, reason: "deliberately permissive test fixture" },
  [CHECK_TYPE.LIVENESS]: { enabled: true, reason: "deliberately permissive test fixture" },
});

// ─── Sanitized success fixtures — same values already used/disclosed
// in verifyCashfreeDirectCapability.mjs; see that file for exactly
// which fields were empirically confirmed vs. left null/UNCONFIRMED. ──
const SANITIZED_PAN_SUCCESS = {
  success: true, source: "CASHFREE", status: "VERIFIED",
  remarks: "PAN verified via Cashfree Secure ID", providerRef: null,
  data: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test", panType: null, verifiedAt: "2026-10-10T00:00:00.000Z" },
};
const SANITIZED_GST_SUCCESS = {
  success: true, source: "CASHFREE", status: "VERIFIED",
  remarks: "GST verified via Cashfree Secure ID", providerRef: null,
  data: { gstNumber: "29AAICP2912R1ZR", legalName: null, tradeName: null, gstStatus: null, verifiedAt: "2026-10-10T00:00:00.000Z" },
};
const SANITIZED_BANK_SUCCESS = {
  success: true, source: "CASHFREE", status: "VERIFIED",
  remarks: "Bank account verified via Cashfree Secure ID", providerRef: null,
  data: { accountHolder: "Sandbox Test", nameAtBank: "unconfirmed-value-not-recorded", nameMatchScore: null, verifiedAt: "2026-10-10T00:00:00.000Z" },
};

const makeStubProviders = (resultsByType) => ({
  [CHECK_TYPE.PAN]: async () => resultsByType[CHECK_TYPE.PAN],
  [CHECK_TYPE.GST]: async () => resultsByType[CHECK_TYPE.GST],
  [CHECK_TYPE.BANK]: async () => resultsByType[CHECK_TYPE.BANK],
});

const run = async () => {
  // ════════════════════════════════════════════════════════
  // PART A — genuine success, driven through the REAL orchestrator
  // success-handling logic (allow-list -> flag check -> provider call
  // -> shape check -> PII check -> return), via injected stand-ins.
  // ════════════════════════════════════════════════════════
  const successProviders = makeStubProviders({
    [CHECK_TYPE.PAN]: SANITIZED_PAN_SUCCESS,
    [CHECK_TYPE.GST]: SANITIZED_GST_SUCCESS,
    [CHECK_TYPE.BANK]: SANITIZED_BANK_SUCCESS,
  });

  for (const [checkType, expected] of [
    [CHECK_TYPE.PAN, SANITIZED_PAN_SUCCESS],
    [CHECK_TYPE.GST, SANITIZED_GST_SUCCESS],
    [CHECK_TYPE.BANK, SANITIZED_BANK_SUCCESS],
  ]) {
    const started = Date.now();
    const result = await verifyViaCashfreeProvider({
      checkType,
      payload: {},
      flags: makeLocalEnabledFlags(),
      providerFunctions: successProviders,
    });
    const elapsedMs = Date.now() - started;

    check(`A. ${checkType}: offline orchestration test (NOT real provider verification) returns the exact injected success result`, JSON.stringify(result) === JSON.stringify(expected), result);
    check(`A. ${checkType}: completed near-instantly — confirms no network call was made`, elapsedMs < 50, elapsedMs);
  }

  // ════════════════════════════════════════════════════════
  // PART B — invalid shape is rejected by the real contract check
  // ════════════════════════════════════════════════════════
  {
    const malformedProviders = makeStubProviders({
      [CHECK_TYPE.PAN]: { success: "yes", source: "CASHFREE" }, // success must be boolean; status/remarks/data missing
      [CHECK_TYPE.GST]: SANITIZED_GST_SUCCESS,
      [CHECK_TYPE.BANK]: SANITIZED_BANK_SUCCESS,
    });
    let threw = false, message = "";
    try {
      await verifyViaCashfreeProvider({ checkType: CHECK_TYPE.PAN, payload: {}, flags: makeLocalEnabledFlags(), providerFunctions: malformedProviders });
    } catch (err) { threw = true; message = err.message; }
    check("B. A malformed provider result is rejected by the real contract check (failed contract check)", threw && message.includes("failed contract check"), message);
  }

  // ════════════════════════════════════════════════════════
  // PART C — a result with an obvious raw-PII-shaped field is rejected
  // by the real PII check, even though its outer shape is otherwise valid
  // ════════════════════════════════════════════════════════
  {
    const piiLeakProviders = makeStubProviders({
      [CHECK_TYPE.PAN]: {
        success: true, source: "CASHFREE", status: "VERIFIED", remarks: "x", providerRef: null,
        data: { panNumberRaw: "ABCPV1234D" }, // the exact suspect key isValidProviderResult's sibling PII checker flags
      },
      [CHECK_TYPE.GST]: SANITIZED_GST_SUCCESS,
      [CHECK_TYPE.BANK]: SANITIZED_BANK_SUCCESS,
    });
    let threw = false, message = "";
    try {
      await verifyViaCashfreeProvider({ checkType: CHECK_TYPE.PAN, payload: {}, flags: makeLocalEnabledFlags(), providerFunctions: piiLeakProviders });
    } catch (err) { threw = true; message = err.message; }
    check("C. A result with an obvious raw-PII-shaped field is rejected by the real PII check (failed PII check)", threw && message.includes("failed PII check"), message);
  }

  // ════════════════════════════════════════════════════════
  // PART D — disabled (via injected local flags, never the real
  // shared export) blocks the call BEFORE the provider function ever runs
  // ════════════════════════════════════════════════════════
  {
    let callCount = 0;
    const countingProviders = {
      [CHECK_TYPE.PAN]: async () => { callCount++; return SANITIZED_PAN_SUCCESS; },
      [CHECK_TYPE.GST]: async () => { callCount++; return SANITIZED_GST_SUCCESS; },
      [CHECK_TYPE.BANK]: async () => { callCount++; return SANITIZED_BANK_SUCCESS; },
    };
    let threw = false, message = "";
    try {
      await verifyViaCashfreeProvider({ checkType: CHECK_TYPE.PAN, payload: {}, flags: makeLocalDisabledFlags(), providerFunctions: countingProviders });
    } catch (err) { threw = true; message = err.message; }
    check("D. Disabled (injected local flags) rejects before calling the provider function", threw && message.includes("not yet enabled"), message);
    check("D. The provider function was never actually invoked (callCount stayed 0)", callCount === 0, callCount);
  }

  // ════════════════════════════════════════════════════════
  // PART E — Aadhaar OTP / Face Match / Liveness rejected UNCONDITIONALLY,
  // even against a deliberately over-permissive injected flags+providers
  // map that "enables" and "supports" them — proves the allow-list gate
  // is evaluated first and cannot be bypassed by any injected override.
  // ════════════════════════════════════════════════════════
  {
    const overPermissiveProviders = {
      ...successProviders,
      [CHECK_TYPE.AADHAAR]: async () => ({ success: true, source: "CASHFREE", status: "VERIFIED", remarks: "x", providerRef: null, data: {} }),
      [CHECK_TYPE.FACE]: async () => ({ success: true, source: "CASHFREE", status: "VERIFIED", remarks: "x", providerRef: null, data: {} }),
      [CHECK_TYPE.LIVENESS]: async () => ({ success: true, source: "CASHFREE", status: "VERIFIED", remarks: "x", providerRef: null, data: {} }),
    };
    for (const excludedType of [CHECK_TYPE.AADHAAR, CHECK_TYPE.FACE, CHECK_TYPE.LIVENESS]) {
      let threw = false, message = "";
      try {
        await verifyViaCashfreeProvider({
          checkType: excludedType,
          payload: {},
          flags: makeOverPermissiveFlags(),
          providerFunctions: overPermissiveProviders,
        });
      } catch (err) { threw = true; message = err.message; }
      check(`E. ${excludedType} is rejected ("not supported") even against a deliberately over-permissive flags+providers override`, threw && message.includes("not supported"), message);
    }
  }

  // ════════════════════════════════════════════════════════
  // PART F — arbitrary payload properties cannot enable a capability.
  // Uses the REAL default (disabled) flags/providerFunctions — no
  // override passed at all — proving payload content is inert for gating.
  // ════════════════════════════════════════════════════════
  {
    let threw = false, message = "";
    try {
      await verifyViaCashfreeProvider({
        checkType: CHECK_TYPE.PAN,
        payload: {
          panNumber: "ABCPV1234D",
          flags: { [CHECK_TYPE.PAN]: { enabled: true } }, // nested inside payload — must be ignored
          enabled: true,
          providerFunctions: successProviders, // also nested inside payload — must be ignored
        },
        // no top-level flags/providerFunctions override — real, disabled defaults apply
      });
    } catch (err) { threw = true; message = err.message; }
    check("F. Arbitrary properties nested inside payload (flags/enabled/providerFunctions) cannot enable a capability — real default (disabled) still applies", threw && message.includes("not yet enabled"), message);
  }

  console.log(rows.join("\n"));
  console.log(`\nCASHFREE DIRECT SUCCESS PATH (OFFLINE ORCHESTRATION TESTS): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
