/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyCashfreeDirectCapability.mjs
 *
 * Phase 5.1 — Global Verification Engine, Cashfree direct path
 * (approved 2026-10-10). Pure unit check: NO database, NO HTTP
 * server, NO live provider call anywhere in this file.
 *
 * SANITIZED FIXTURES — see inline comments on each one for exactly
 * which fields were empirically confirmed present/absent during the
 * three real, isolated Sandbox preflights run earlier this session,
 * versus which fields were never inspected and are therefore left
 * null/omitted rather than fabricated. No fixture contains a real
 * person's name, a real PAN/GSTIN/bank account, a credential, a
 * token, or an IP address — the PAN/GSTIN/bank values used are
 * Cashfree's own published Sandbox test fixtures, and the
 * account-holder label is the same synthetic "Sandbox Test" string
 * actually used in the real calls (never a real person).
 *
 * HOW THE "ENABLED" PATH IS TESTED WITHOUT A LIVE CALL: this file
 * never monkey-patches cashfree.provider.js's exports (ES module
 * named exports are read-only bindings — that isn't mechanically
 * possible without a bundler-level mock, which this project's
 * established testing convention doesn't use). Instead, it:
 *   (a) validates the sanitized fixtures above directly against the
 *       contract/PII checkers — proving the real shapes are accepted;
 *   (b) builds its OWN local, disposable "enabled" flags object and
 *       passes it to verifyViaCashfreeProvider's `flags` parameter —
 *       the real, shared CASHFREE_DIRECT_CAPABILITY_FLAGS export is
 *       now Object.freeze()'d (Phase 5.4.5 hardening) and is never
 *       read or mutated by this file at all. CASHFREE_CLIENT_ID/SECRET
 *       are deliberately deleted from process.env for the duration of
 *       this one call — this proves the function genuinely proceeds
 *       past the flag gate (because the INJECTED flag says enabled)
 *       and calls the real, imported Cashfree function (confirmed by
 *       getting back that function's own "not configured" shape, which
 *       only the real function can produce), WITHOUT ever reaching the
 *       network, exactly mirroring the same safe technique already
 *       used in verifyProviderAdapterContract.mjs and in
 *       verifyCashfreeDirectSuccessPath.mjs's own injection style. No
 *       shared production state is touched, so nothing needs restoring
 *       in a finally block for the flags themselves (env vars are
 *       still restored, below).
 *
 * Run:  cd backend && node scripts/unit/verifyCashfreeDirectCapability.mjs
 */

import {
    CASHFREE_DIRECT_CAPABILITY_FLAGS,
    CHECK_TYPE,
    isCashfreeDirectCapabilityEnabled,
    verifyViaCashfreeProvider,
} from "../../modules/kyc/engine/verificationOrchestrator.service.js";

// ─── Local, disposable "enabled" flags — never the shared, frozen
// CASHFREE_DIRECT_CAPABILITY_FLAGS export (Phase 5.4.5 hardening: that
// export is now Object.freeze()'d and this file must not attempt to
// mutate it — injection via verifyViaCashfreeProvider's `flags`
// parameter is the only supported way to exercise an enabled state). ──
const makeLocalEnabledFlags = () => ({
  [CHECK_TYPE.PAN]: { enabled: true, reason: "offline test fixture (local, disposable — not the shared export)" },
  [CHECK_TYPE.GST]: { enabled: true, reason: "offline test fixture (local, disposable — not the shared export)" },
  [CHECK_TYPE.BANK]: { enabled: true, reason: "offline test fixture (local, disposable — not the shared export)" },
});
import { isDataFreeOfObviousPII, isValidProviderResult } from "../../modules/kyc/engine/providerAdapter.contract.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

// ─── Sanitized fixtures, based on the three real successful calls ──

// PAN — confirmed empirically: success=true, status="VERIFIED",
// data.nameOnPAN PRESENT, data.panType ABSENT. providerRef and the
// exact remarks text were not inspected during that call (only a
// few specific booleans were checked) — remarks below is the literal
// hardcoded string from cashfree.provider.js's own success branch
// (code constant, not provider-returned data); providerRef is left
// null, honestly marked as unconfirmed rather than guessed.
const SANITIZED_PAN_SUCCESS_FIXTURE = {
  success: true,
  source: "CASHFREE",
  status: "VERIFIED",
  remarks: "PAN verified via Cashfree Secure ID", // code literal, not provider data
  providerRef: null, // UNCONFIRMED — presence/value was not inspected during the real call
  data: {
    panNumber: "ABCPV1234D", // Cashfree's own published Sandbox test PAN
    nameOnPAN: "Sandbox Test", // confirmed PRESENT; this is the synthetic label actually sent, used as-is
    panType: null, // confirmed ABSENT in the real response
    verifiedAt: "2026-10-10T00:00:00.000Z", // code-generated timestamp, not provider data
  },
};

// GST — confirmed empirically: success=true, status="VERIFIED",
// data.legalName ABSENT, data.tradeName ABSENT. gstStatus and
// providerRef were not inspected — left null, not guessed.
const SANITIZED_GST_SUCCESS_FIXTURE = {
  success: true,
  source: "CASHFREE",
  status: "VERIFIED",
  remarks: "GST verified via Cashfree Secure ID", // code literal, not provider data
  providerRef: null, // UNCONFIRMED
  data: {
    gstNumber: "29AAICP2912R1ZR", // Cashfree's own published Sandbox test GSTIN
    legalName: null, // confirmed ABSENT in the real response
    tradeName: null, // confirmed ABSENT in the real response
    gstStatus: null, // UNCONFIRMED — not inspected during the real call
    verifiedAt: "2026-10-10T00:00:00.000Z",
  },
};

// Bank — confirmed empirically: success=true, status="VERIFIED",
// data.nameAtBank PRESENT, data.nameMatchScore ABSENT.
const SANITIZED_BANK_SUCCESS_FIXTURE = {
  success: true,
  source: "CASHFREE",
  status: "VERIFIED",
  remarks: "Bank account verified via Cashfree Secure ID", // code literal, not provider data
  providerRef: null, // UNCONFIRMED
  data: {
    accountHolder: "Sandbox Test", // synthetic label actually sent, not a real person
    nameAtBank: "unconfirmed-value-not-recorded", // confirmed PRESENT, but the actual string was never printed/inspected — placeholder marks "present, value unknown" honestly
    nameMatchScore: null, // confirmed ABSENT in the real response
    verifiedAt: "2026-10-10T00:00:00.000Z",
  },
};

const run = async () => {
  // ════════════════════════════════════════════════════════
  // PART A — sanitized real-shape fixtures pass the existing contract
  // ════════════════════════════════════════════════════════
  for (const [label, fixture] of [
    ["PAN", SANITIZED_PAN_SUCCESS_FIXTURE],
    ["GST", SANITIZED_GST_SUCCESS_FIXTURE],
    ["Bank", SANITIZED_BANK_SUCCESS_FIXTURE],
  ]) {
    const shapeCheck = isValidProviderResult(fixture);
    check(`A. Sanitized real ${label} success shape passes isValidProviderResult`, shapeCheck.valid, shapeCheck.errors);
    const piiCheck = isDataFreeOfObviousPII(fixture.data);
    check(`A. Sanitized real ${label} success shape passes isDataFreeOfObviousPII`, piiCheck.valid, piiCheck.errors);
  }

  // ════════════════════════════════════════════════════════
  // PART B — disabled by default (no mutation at all in this section)
  // ════════════════════════════════════════════════════════
  check("B. PAN is disabled by default", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.PAN) === false);
  check("B. GST is disabled by default", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.GST) === false);
  check("B. BANK is disabled by default", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.BANK) === false);

  let threwForDisabledPan = false;
  try {
    await verifyViaCashfreeProvider({ checkType: CHECK_TYPE.PAN, payload: { panNumber: "ABCPV1234D" } });
  } catch (err) {
    threwForDisabledPan = err.message.includes("not yet enabled");
  }
  check("B. verifyViaCashfreeProvider refuses PAN while disabled (default state) — never reaches the provider call", threwForDisabledPan);

  // ════════════════════════════════════════════════════════
  // PART C — Aadhaar OTP / Face Match / Liveness always rejected,
  // regardless of any flag state (they have no entry in the map at all)
  // ════════════════════════════════════════════════════════
  for (const excludedType of [CHECK_TYPE.AADHAAR, CHECK_TYPE.FACE, CHECK_TYPE.LIVENESS]) {
    let threw = false;
    let message = "";
    try {
      await verifyViaCashfreeProvider({ checkType: excludedType, payload: {} });
    } catch (err) {
      threw = true;
      message = err.message;
    }
    check(`C. ${excludedType} is rejected by verifyViaCashfreeProvider ("not supported")`, threw && message.includes("not supported"), message);
  }

  // Also confirm an entirely unknown checkType is rejected the same way.
  let threwForUnknown = false;
  try {
    await verifyViaCashfreeProvider({ checkType: "SOMETHING_MADE_UP", payload: {} });
  } catch { threwForUnknown = true; }
  check("C. An unrecognized checkType is also rejected (fails closed)", threwForUnknown);

  // ════════════════════════════════════════════════════════
  // PART D — explicitly enabled: proves the gate opens and the real
  // function is genuinely called, WITHOUT any network call (Cashfree
  // credentials deliberately removed from process.env for this one
  // scoped block only, restored immediately after). Phase 5.4.5 —
  // "enabled" is now achieved by INJECTING a local flags object into
  // verifyViaCashfreeProvider's `flags` parameter, never by mutating
  // the shared, frozen CASHFREE_DIRECT_CAPABILITY_FLAGS export (an
  // attempt to mutate it would now throw in strict mode / silently
  // no-op otherwise — this file does neither, it injects instead).
  // ════════════════════════════════════════════════════════
  const savedClientId = process.env.CASHFREE_CLIENT_ID;
  const savedClientSecret = process.env.CASHFREE_CLIENT_SECRET;
  delete process.env.CASHFREE_CLIENT_ID;
  delete process.env.CASHFREE_CLIENT_SECRET;

  try {
    for (const checkType of [CHECK_TYPE.PAN, CHECK_TYPE.GST, CHECK_TYPE.BANK]) {
      const payloadByType = {
        [CHECK_TYPE.PAN]: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test" },
        [CHECK_TYPE.GST]: { gstNumber: "29AAICP2912R1ZR" },
        [CHECK_TYPE.BANK]: { accountNumber: "026291800001191", ifsc: "YESB0000262", accountHolder: "Sandbox Test" },
      }[checkType];

      const started = Date.now();
      const result = await verifyViaCashfreeProvider({ checkType, payload: payloadByType, flags: makeLocalEnabledFlags() });
      const elapsedMs = Date.now() - started;

      check(`D. ${checkType} enabled (via injected local flags, shared export untouched): the real Cashfree function was genuinely called (its own "not configured" shape returned)`, result.success === false && (result.remarks || "").toLowerCase().includes("not configured"), result.remarks);
      check(`D. ${checkType} enabled: zero network reached — completed near-instantly`, elapsedMs < 1000, elapsedMs);
      check(`D. ${checkType} enabled: the result still passed through contract validation before being returned`, isValidProviderResult(result).valid, isValidProviderResult(result).errors);
    }
  } finally {
    // Restore real env state, regardless of outcome above. No flags to
    // restore — the shared export was never touched in this block.
    if (savedClientId !== undefined) process.env.CASHFREE_CLIENT_ID = savedClientId; else delete process.env.CASHFREE_CLIENT_ID;
    if (savedClientSecret !== undefined) process.env.CASHFREE_CLIENT_SECRET = savedClientSecret; else delete process.env.CASHFREE_CLIENT_SECRET;
  }

  check("D. The shared, frozen CASHFREE_DIRECT_CAPABILITY_FLAGS export is still disabled for all three types — proves this file never mutated it", [CHECK_TYPE.PAN, CHECK_TYPE.GST, CHECK_TYPE.BANK].every((t) => isCashfreeDirectCapabilityEnabled(t) === false));
  check("D. The shared export is actually frozen (Object.isFrozen)", Object.isFrozen(CASHFREE_DIRECT_CAPABILITY_FLAGS));

  console.log(rows.join("\n"));
  console.log(`\nCASHFREE DIRECT CAPABILITY: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
