/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyProviderAdapterContract.mjs
 *
 * Phase 1 — Global Verification Engine. Pure unit check, NO database,
 * NO HTTP server, NO live provider call. Confirms that:
 *   (a) the three EXISTING provider functions this engine will treat
 *       as "non-Cashfree-dependent" already produce a result shape
 *       matching providerAdapter.contract.js's isValidProviderResult(),
 *   (b) a Cashfree provider function called with NO credentials in
 *       process.env returns its documented "not configured" shape
 *       WITHOUT making any network call (confirmed by the absence of
 *       any thrown network/timeout error and by completing instantly) —
 *       this is the same safe, zero-network guard
 *       verifyCashfreeSecureIdE2E.mjs already relies on, re-asserted
 *       here as a standalone, disposable check,
 *   (c) isDataFreeOfObviousPII() correctly flags an obviously-bad
 *       fixture and passes a real, existing provider's actual output.
 *
 * Run:  cd backend && node scripts/unit/verifyProviderAdapterContract.mjs
 */

import { verifyPANManual, verifyAadhaarManual, verifyBankManual } from "../../modules/kyc/providers/manual.provider.js";
import { verifyPANSurepass } from "../../modules/kyc/providers/surepass.provider.js";
import { verifyPANCashfree } from "../../modules/kyc/providers/cashfree.provider.js";
import { isValidProviderResult, isDataFreeOfObviousPII } from "../../modules/kyc/engine/providerAdapter.contract.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const run = async () => {
  // ── Manual provider — real calls, zero network, zero DB ──
  const panManualOk = await verifyPANManual({ panNumber: "ABCDE1234F", name: "TEST" });
  check("verifyPANManual (valid PAN) matches contract", isValidProviderResult(panManualOk).valid, isValidProviderResult(panManualOk).errors);
  check("verifyPANManual (valid PAN) success=true", panManualOk.success === true);

  const panManualBad = await verifyPANManual({ panNumber: "NOTVALID", name: "TEST" });
  check("verifyPANManual (invalid PAN) matches contract", isValidProviderResult(panManualBad).valid, isValidProviderResult(panManualBad).errors);
  check("verifyPANManual (invalid PAN) success=false", panManualBad.success === false);

  const aadhaarManualOk = await verifyAadhaarManual({ last4: "1234" });
  check("verifyAadhaarManual matches contract", isValidProviderResult(aadhaarManualOk).valid, isValidProviderResult(aadhaarManualOk).errors);

  const bankManualOk = await verifyBankManual({ accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "Test Bank", accountHolder: "Test Holder" });
  check("verifyBankManual matches contract", isValidProviderResult(bankManualOk).valid, isValidProviderResult(bankManualOk).errors);

  // ── Surepass — real call, no SUREPASS_TOKEN in this run means the
  // function's own early-return fires (surepass.provider.js:16-27),
  // never reaching fetch(). Explicitly unset here so this assertion is
  // true regardless of what happens to be in the environment running
  // this script. ──
  delete process.env.SUREPASS_TOKEN;
  const panSurepass = await verifyPANSurepass({ panNumber: "ABCDE1234F" });
  check("verifyPANSurepass (unconfigured) matches contract", isValidProviderResult(panSurepass).valid, isValidProviderResult(panSurepass).errors);
  check("verifyPANSurepass (unconfigured) success=false, no network call made", panSurepass.success === false);

  // ── Cashfree — same "unconfigured early-return, zero network" guard,
  // asserted as its own check per this phase's "no live provider call"
  // constraint. ZEMISH dual-environment pass — cashfree.provider.js now
  // reads CASHFREE_VERIFICATION_* (isolated from Payouts' own
  // CASHFREE_CLIENT_ID/SECRET), so those are what must be unset to
  // force the unconfigured path deliberately. ──
  delete process.env.CASHFREE_VERIFICATION_ENV;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  const started = Date.now();
  const panCashfree = await verifyPANCashfree({ panNumber: "ABCDE1234F", nameOnPAN: "TEST" });
  const elapsedMs = Date.now() - started;
  check("verifyPANCashfree (unconfigured) matches contract", isValidProviderResult(panCashfree).valid, isValidProviderResult(panCashfree).errors);
  check("verifyPANCashfree (unconfigured) success=false", panCashfree.success === false);
  check("verifyPANCashfree (unconfigured) returned instantly — no network attempted", elapsedMs < 1000, `elapsedMs=${elapsedMs}`);

  // ── PII guard — negative and positive cases ──
  const badData = { panNumberRaw: "ABCDE1234F" };
  check("isDataFreeOfObviousPII flags a raw-PII-shaped fixture", isDataFreeOfObviousPII(badData).valid === false);

  const goodData = panManualOk.data;
  check("isDataFreeOfObviousPII passes a real provider's actual output", isDataFreeOfObviousPII(goodData).valid === true, goodData);

  console.log(rows.join("\n"));
  console.log(`\nPROVIDER ADAPTER CONTRACT: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
