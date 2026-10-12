/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyVerificationServiceOrchestratorIntegration.mjs
 *
 * Phase 5.4.5 — Offline Integration Safety Preparation. Pure unit
 * check: NO MongoDB, NO Redis, NO Cashfree/Surepass/any external call,
 * NO mongoose import, NO route/controller/service invocation.
 *
 * UPDATED Phase 5.4.7: PAN fallback semantics fix. The real
 * verifyViaNonCashfreeProvider now selects Surepass OR Manual by
 * CONFIGURATION PRESENCE ONLY (a `surepassConfigured` check, decided
 * before either is called), instead of the old "call Surepass, fall
 * through to Manual on any non-success" logic — the old logic would
 * have silently retried a genuine, configured Surepass rejection
 * against Manual, had SUREPASS_TOKEN ever been set. See PART I below
 * for dedicated, injection-based tests distinguishing "not configured"
 * from "configured and genuinely rejects/succeeds", and
 * verificationOrchestrator.service.js's own Phase 5.4.7 comment for
 * the full rationale. Parts A-G's wording was touched only where it
 * described the now-superseded behavior (Part E); their assertions
 * and pass/fail outcomes are unaffected by this fix.
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠ WHAT THIS FILE DOES AND DOES NOT PROVE — READ BEFORE TRUSTING ANY
 * RESULT BELOW.
 *
 * UPDATED Phase 5.4.6: backend/modules/kyc/services/verification.service.js
 * HAS NOW been minimally edited — its `verifyPAN`/`verifyBank` Manual/
 * Surepass FALLBACK branches (the `else` of `cashfreeConfigured() ? ... : ...`)
 * now call through verificationOrchestrator.service.js's real
 * `verifyViaNonCashfreeProvider`, replacing the old inline
 * useAPI?Surepass:Manual logic. The Cashfree-CONFIGURED branch of both
 * functions is UNCHANGED — still calls verifyPANCashfree/
 * verifyBankCashfree directly, exactly as before this phase.
 *
 * PART H below (new in this phase) calls the REAL, unmodified
 * `verifyPAN`/`verifyBank` exported from verification.service.js —
 * this is the actual service integration boundary, not a simulation.
 * Because those functions use `mongoose.startSession()` and
 * `VerificationLog.create()` for real persistence, and this phase
 * forbids any MongoDB connection, Part H temporarily replaces
 * `mongoose.startSession` (a mutable method on the real, singleton
 * `mongoose` object — not an ES-module named-export binding) and
 * `VerificationLog.create` (an inherited, mutable method on the real
 * model) with local, no-op/counting stand-ins, restored in a finally
 * block. The `kyc` argument is a plain, locally-constructed object
 * (never a real Mongoose document, never persisted). Given this:
 *   - What Part H DOES prove: the real verifyPAN/verifyBank functions,
 *     when Cashfree is not configured, correctly call through to the
 *     real verifyViaNonCashfreeProvider and correctly set every field
 *     the admin controller's response and VerificationLog rely on
 *     (status/verified/verificationSource/remarks, masked+encrypted
 *     values, verificationLevel/status), and that the transaction
 *     lifecycle (startTransaction/commitTransaction/endSession) and
 *     the VerificationLog write each fire exactly once per attempt.
 *   - What Part H DOES NOT prove: real MongoDB transaction semantics
 *     (atomicity, isolation, rollback-on-real-failure) or real
 *     VerificationLog persistence — both are stubbed out, not
 *     exercised, because no database connection is permitted in this
 *     phase. Every assertion derived from the stubs is labeled
 *     "(REAL service boundary, persistence stubbed)".
 *   - What Part H CANNOT exercise at all: the Cashfree-CONFIGURED
 *     branch of the real verifyPAN/verifyBank. verifyPANCashfree/
 *     verifyBankCashfree are plain named ES-module exports imported
 *     directly into verification.service.js — they cannot be
 *     dependency-injected or monkey-patched from outside without
 *     either reassigning a read-only import binding (not done,
 *     violates this project's established convention) or supplying
 *     real credentials and making a real network call (forbidden).
 *     That branch is UNCHANGED by this phase's edit, so its behavior
 *     rests on the pre-existing, already-functioning code plus the
 *     three real Sandbox preflights already run earlier in this
 *     engagement — not re-proven here, and not claimed to be.
 *
 * Everything in PARTS A-G below remains a CONTRACT SIMULATION, as
 * originally written in Phase 5.4.5 — those parts model the Cashfree-
 * DIRECT path (verifyViaCashfreeProvider), which verification.service.js
 * still does not call anywhere (deliberately, per this phase's own
 * scope decision — see verification.service.js's own Phase 5.4.6
 * header comments). They remain useful as orchestrator-contract
 * regression coverage, clearly labeled "(contract simulation)", and
 * are not re-labeled as real integration tests merely because Part H
 * was added alongside them.
 *
 * Every provider call in Parts A-G is either:
 *   (a) a local, synchronous, injected stand-in (for the Cashfree-
 *       direct path, via verifyViaCashfreeProvider's own `flags`/
 *       `providerFunctions` parameters — ordinary dependency
 *       injection, no monkey-patching of any ES module export), or
 *   (b) a REAL call to the REAL, already-existing
 *       verifyViaNonCashfreeProvider, which in turn calls the REAL
 *       verifyPANSurepass/verifyPANManual/verifyBankManual — but ONLY
 *       ever reaches the network if SUREPASS_TOKEN is set (Manual
 *       never calls any network at all; Surepass returns its own
 *       "not configured" result synchronously otherwise). This file
 *       deletes SUREPASS_TOKEN/CASHFREE_VERIFICATION_ENV/
 *       CASHFREE_VERIFICATION_CLIENT_ID/CASHFREE_VERIFICATION_CLIENT_SECRET
 *       (ZEMISH dual-environment pass — the Verification Suite's own,
 *       isolated vars; verification.service.js's cashfreeConfigured()
 *       reads these, not Payouts' CASHFREE_CLIENT_ID/SECRET) from
 *       process.env for its entire run (restored in a finally block)
 *       specifically so (b) can never reach a real network call
 *       regardless of what the real environment happens to have set.
 *
 * Run:  cd backend && node scripts/unit/verifyVerificationServiceOrchestratorIntegration.mjs
 * ══════════════════════════════════════════════════════════════════
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { APPLICANT_TYPE, KYC_STATUS, VERIFICATION_SOURCE } from "../../modules/kyc/constants/kyc.constants.js";
import {
    CASHFREE_DIRECT_CAPABILITY_FLAGS,
    CHECK_TYPE,
    assertAutoApprovalAllowed,
    isCashfreeDirectCapabilityEnabled,
    verifyViaCashfreeProvider,
    verifyViaNonCashfreeProvider,
} from "../../modules/kyc/engine/verificationOrchestrator.service.js";
import { isValidProviderResult } from "../../modules/kyc/engine/providerAdapter.contract.js";
import VerificationLog from "../../modules/kyc/models/VerificationLog.js";
import Salon from "../../models/Salon.js";
import { verifyBank, verifyPAN } from "../../modules/kyc/services/verification.service.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

// ─── Local, disposable flags — never the shared, frozen
// CASHFREE_DIRECT_CAPABILITY_FLAGS export (see Phase 5.4.5 hardening
// in verificationOrchestrator.service.js and
// verifyCashfreeDirectCapability.mjs — this file follows the same
// injection-only convention). ─────────────────────────────────────
const makeLocalEnabledFlags = () => ({
  [CHECK_TYPE.PAN]:  { enabled: true, reason: "offline test fixture (local, disposable)" },
  [CHECK_TYPE.GST]:  { enabled: true, reason: "offline test fixture (local, disposable)" },
  [CHECK_TYPE.BANK]: { enabled: true, reason: "offline test fixture (local, disposable)" },
});
const makeLocalDisabledFlags = () => ({
  [CHECK_TYPE.PAN]:  { enabled: false, reason: "offline test fixture (local, disposable)" },
  [CHECK_TYPE.GST]:  { enabled: false, reason: "offline test fixture (local, disposable)" },
  [CHECK_TYPE.BANK]: { enabled: false, reason: "offline test fixture (local, disposable)" },
});

const SANITIZED_PAN_SUCCESS = {
  success: true, source: VERIFICATION_SOURCE.CASHFREE, status: "VERIFIED",
  remarks: "PAN verified via Cashfree Secure ID", providerRef: "cf-pan-ref-fixture",
  data: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test", panType: null, verifiedAt: "2026-10-10T00:00:00.000Z" },
};
const SANITIZED_PAN_FAILURE = {
  success: false, source: VERIFICATION_SOURCE.CASHFREE, status: "FAILED",
  remarks: "PAN verification failed", providerRef: "cf-pan-fail-ref-fixture",
  data: null,
};
const SANITIZED_BANK_SUCCESS = {
  success: true, source: VERIFICATION_SOURCE.CASHFREE, status: "VERIFIED",
  remarks: "Bank account verified via Cashfree Secure ID", providerRef: "cf-bank-ref-fixture",
  data: { accountHolder: "Sandbox Test", nameAtBank: "unconfirmed-value-not-recorded", nameMatchScore: null, verifiedAt: "2026-10-10T00:00:00.000Z" },
};
const SANITIZED_BANK_FAILURE = {
  success: false, source: VERIFICATION_SOURCE.CASHFREE, status: "FAILED",
  remarks: "Bank account verification failed", providerRef: "cf-bank-fail-ref-fixture",
  data: null,
};

// ─── CONTRACT SIMULATION ONLY — see file header. Mirrors the
// Phase 5.4.4 proposed integration: selection by configuration
// presence, never a retry-on-failure cascade. Not production code,
// not imported by anything else, exists only in this test file. ────
const simulateIntegratedVerifyPAN = async ({ panNumber, nameOnPAN, cashfreeDirectEnabled, flags, providerFunctions, callLog }) => {
  if (cashfreeDirectEnabled) {
    callLog.push("CASHFREE_BRANCH");
    // Whatever this returns — success OR failure — is FINAL. No
    // fallback to Surepass/Manual is ever attempted from here, exactly
    // mirroring verification.service.js's own existing, documented
    // "a genuine Cashfree rejection is final, not silently re-attempted
    // against Manual" comment (Phase 7A, verifyPAN).
    return verifyViaCashfreeProvider({ checkType: CHECK_TYPE.PAN, payload: { panNumber, nameOnPAN }, flags, providerFunctions });
  }
  callLog.push("NON_CASHFREE_BRANCH");
  // Real call to the real, existing Surepass -> Manual chain (safe
  // offline as long as SUREPASS_TOKEN is unset — enforced for this
  // entire file, see run()'s env scoping).
  return verifyViaNonCashfreeProvider({ checkType: CHECK_TYPE.PAN, applicantType: APPLICANT_TYPE.OWNER, payload: { panNumber, nameOnPAN } });
};

const simulateIntegratedVerifyBank = async ({ accountNumber, ifsc, bankName, accountHolder, cashfreeDirectEnabled, flags, providerFunctions, callLog }) => {
  if (cashfreeDirectEnabled) {
    callLog.push("CASHFREE_BRANCH");
    return verifyViaCashfreeProvider({ checkType: CHECK_TYPE.BANK, payload: { accountNumber, ifsc, accountHolder }, flags, providerFunctions });
  }
  callLog.push("NON_CASHFREE_BRANCH");
  // Bank has no Surepass product — real chain is Manual-only, exactly
  // mirroring verification.service.js's own existing verifyBank.
  return verifyViaNonCashfreeProvider({ checkType: CHECK_TYPE.BANK, applicantType: APPLICANT_TYPE.OWNER, payload: { accountNumber, ifsc, bankName, accountHolder } });
};

const run = async () => {
  // Hard offline guarantee for this entire file: even if the real
  // environment happens to have these set, they are removed for the
  // duration of every call made here, restored in finally at the end.
  // KYC_ENCRYPTION_KEY is additionally set to a LOCALLY-GENERATED,
  // synthetic 64-hex-char key (crypto.randomBytes, never read from the
  // real environment/.env) — Part H's real verifyPAN/verifyBank calls
  // the real encrypt() function, which throws without a valid-shaped
  // key present; this is not a real secret, never logged, restored in
  // finally.
  const savedSurepass = process.env.SUREPASS_TOKEN;
  const savedCashfreeVerificationEnv = process.env.CASHFREE_VERIFICATION_ENV;
  const savedCashfreeVerificationId = process.env.CASHFREE_VERIFICATION_CLIENT_ID;
  const savedCashfreeVerificationSecret = process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  const savedEncryptionKey = process.env.KYC_ENCRYPTION_KEY;
  delete process.env.SUREPASS_TOKEN;
  delete process.env.CASHFREE_VERIFICATION_ENV;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  process.env.KYC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

  try {
    // ════════════════════════════════════════════════════════
    // PART A (contract simulation) — provider called exactly once per
    // attempt, never twice. Counts invocations via injected counters
    // (Cashfree branch) and via the callLog (branch selection).
    // ════════════════════════════════════════════════════════
    {
      let cashfreeCallCount = 0;
      const countingSuccessProviders = {
        [CHECK_TYPE.PAN]: async () => { cashfreeCallCount++; return SANITIZED_PAN_SUCCESS; },
        [CHECK_TYPE.BANK]: async () => { cashfreeCallCount++; return SANITIZED_BANK_SUCCESS; },
      };
      const callLog = [];
      const result = await simulateIntegratedVerifyPAN({
        panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test",
        cashfreeDirectEnabled: true, flags: makeLocalEnabledFlags(),
        providerFunctions: countingSuccessProviders, callLog,
      });
      check("A. (contract simulation) PAN, Cashfree-direct enabled: Cashfree provider invoked exactly once, never twice", cashfreeCallCount === 1, cashfreeCallCount);
      check("A. (contract simulation) PAN, Cashfree-direct enabled: exactly one branch taken (CASHFREE only)", callLog.length === 1 && callLog[0] === "CASHFREE_BRANCH", callLog);
      check("A. (contract simulation) PAN, Cashfree-direct enabled: result returned unchanged", result === SANITIZED_PAN_SUCCESS || JSON.stringify(result) === JSON.stringify(SANITIZED_PAN_SUCCESS));
    }
    {
      let cashfreeCallCount = 0;
      const countingProviders = {
        [CHECK_TYPE.PAN]: async () => { cashfreeCallCount++; return SANITIZED_PAN_SUCCESS; },
      };
      const callLog = [];
      // Cashfree-direct disabled (default) -> must take the
      // NON_CASHFREE branch exactly once, and the Cashfree provider
      // function (even though it's right there, injected) must never
      // be invoked at all — proves no duplicate/parallel call occurs.
      const result = await simulateIntegratedVerifyPAN({
        panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test",
        cashfreeDirectEnabled: false, flags: makeLocalDisabledFlags(),
        providerFunctions: countingProviders, callLog,
      });
      check("A. (contract simulation) PAN, Cashfree-direct disabled: Cashfree provider invoked ZERO times", cashfreeCallCount === 0, cashfreeCallCount);
      check("A. (contract simulation) PAN, Cashfree-direct disabled: exactly one branch taken (NON_CASHFREE only)", callLog.length === 1 && callLog[0] === "NON_CASHFREE_BRANCH", callLog);
      check("A. (contract simulation) PAN, Cashfree-direct disabled: falls through to Manual (Surepass not configured) and succeeds for a valid PAN", result.success === true && result.source === VERIFICATION_SOURCE.MANUAL, result);
    }
    {
      let cashfreeCallCount = 0;
      const countingProviders = {
        [CHECK_TYPE.BANK]: async () => { cashfreeCallCount++; return SANITIZED_BANK_SUCCESS; },
      };
      const callLog = [];
      const result = await simulateIntegratedVerifyBank({
        accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank", accountHolder: "Sandbox Test",
        cashfreeDirectEnabled: true, flags: makeLocalEnabledFlags(),
        providerFunctions: countingProviders, callLog,
      });
      check("A. (contract simulation) BANK, Cashfree-direct enabled: Cashfree provider invoked exactly once, never twice", cashfreeCallCount === 1, cashfreeCallCount);
      check("A. (contract simulation) BANK, Cashfree-direct enabled: exactly one branch taken", callLog.length === 1 && callLog[0] === "CASHFREE_BRANCH", callLog);
      check("A. (contract simulation) BANK result source/status/remarks/providerRef preserved exactly", result.source === SANITIZED_BANK_SUCCESS.source && result.status === SANITIZED_BANK_SUCCESS.status && result.remarks === SANITIZED_BANK_SUCCESS.remarks && result.providerRef === SANITIZED_BANK_SUCCESS.providerRef, result);
    }
    {
      const callLog = [];
      const result = await simulateIntegratedVerifyBank({
        accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank", accountHolder: "Sandbox Test",
        cashfreeDirectEnabled: false, flags: makeLocalDisabledFlags(), providerFunctions: {}, callLog,
      });
      check("A. (contract simulation) BANK, Cashfree-direct disabled: exactly one branch taken (NON_CASHFREE/Manual-only — Bank has no Surepass product)", callLog.length === 1 && callLog[0] === "NON_CASHFREE_BRANCH", callLog);
      check("A. (contract simulation) BANK, Cashfree-direct disabled: Manual verification succeeds for valid inputs", result.success === true && result.source === VERIFICATION_SOURCE.MANUAL, result);
    }

    // ════════════════════════════════════════════════════════
    // PART B — Cashfree PAN and Bank capabilities remain disabled by
    // default (real, shared export — no injection, no override).
    // ════════════════════════════════════════════════════════
    check("B. CASHFREE_DIRECT_CAPABILITY_FLAGS.PAN is disabled by default (real shared export)", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.PAN) === false);
    check("B. CASHFREE_DIRECT_CAPABILITY_FLAGS.BANK is disabled by default (real shared export)", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.BANK) === false);
    check("B. CASHFREE_DIRECT_CAPABILITY_FLAGS.GST is disabled by default (real shared export)", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.GST) === false);

    // ════════════════════════════════════════════════════════
    // PART C — test-local injected flags cannot mutate shared
    // production defaults. Exercises the ENABLED path via injection,
    // then proves the shared export is untouched AND genuinely frozen
    // (a direct mutation attempt throws).
    // ════════════════════════════════════════════════════════
    {
      await verifyViaCashfreeProvider({
        checkType: CHECK_TYPE.PAN, payload: { panNumber: "ABCPV1234D" },
        flags: makeLocalEnabledFlags(),
        providerFunctions: { [CHECK_TYPE.PAN]: async () => SANITIZED_PAN_SUCCESS },
      });
      check("C. After exercising the ENABLED path via injected local flags, the shared export still reports PAN disabled", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.PAN) === false);
      check("C. After exercising the ENABLED path via injected local flags, the shared export still reports BANK disabled", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.BANK) === false);
      check("C. The shared export is Object.isFrozen", Object.isFrozen(CASHFREE_DIRECT_CAPABILITY_FLAGS));

      let mutationThrew = false;
      try {
        // Deliberate attempt to mutate the shared, frozen export
        // directly — this file runs as an ES module (strict mode by
        // default), so assigning to a frozen object's property must
        // throw a TypeError rather than silently no-op.
        CASHFREE_DIRECT_CAPABILITY_FLAGS[CHECK_TYPE.PAN].enabled = true;
      } catch (err) {
        mutationThrew = err instanceof TypeError;
      }
      check("C. A direct mutation attempt on the shared export throws TypeError (frozen, strict mode) — proves injected flags truly cannot touch production defaults", mutationThrew);
      check("C. PAN is still disabled after the mutation attempt (confirms the throw prevented the write)", isCashfreeDirectCapabilityEnabled(CHECK_TYPE.PAN) === false);
    }

    // ════════════════════════════════════════════════════════
    // PART D — provider success and failure result shapes remain
    // compatible with the existing verification.service.js field
    // assignments (kyc.verification.pan.status = result.status, etc.)
    // and source/status/remarks/providerRef are preserved correctly,
    // for BOTH the Cashfree-injected path and the real Manual path.
    // ════════════════════════════════════════════════════════
    for (const [label, fixture] of [["PAN success", SANITIZED_PAN_SUCCESS], ["PAN failure", SANITIZED_PAN_FAILURE], ["BANK success", SANITIZED_BANK_SUCCESS], ["BANK failure", SANITIZED_BANK_FAILURE]]) {
      const shapeCheck = isValidProviderResult(fixture);
      check(`D. ${label} fixture passes isValidProviderResult (same contract verification.service.js's field assignments rely on)`, shapeCheck.valid, shapeCheck.errors);
      check(`D. ${label} fixture has the exact fields verifyPAN/verifyBank read: success/source/status/remarks/providerRef/data`, ["success", "source", "status", "remarks", "providerRef", "data"].every((k) => k in fixture), Object.keys(fixture));
    }
    {
      // Real Manual-path failure (invalid PAN format) — proves the
      // real, non-Cashfree chain also produces a compatible shape.
      const callLog = [];
      const result = await simulateIntegratedVerifyPAN({
        panNumber: "INVALID", nameOnPAN: "Sandbox Test",
        cashfreeDirectEnabled: false, flags: makeLocalDisabledFlags(), providerFunctions: {}, callLog,
      });
      check("D. Real Manual-path failure (invalid PAN format) still produces a contract-valid shape", isValidProviderResult(result).valid, result);
      check("D. Real Manual-path failure: success is false, source is MANUAL, remarks is a non-empty string", result.success === false && result.source === VERIFICATION_SOURCE.MANUAL && typeof result.remarks === "string" && result.remarks.length > 0, result);
    }

    // ════════════════════════════════════════════════════════
    // PART E — existing PAN priority remains Cashfree -> Surepass ->
    // Manual; existing Bank priority remains Cashfree -> Manual.
    // (contract simulation + real fallback-to-Manual exercise)
    // ════════════════════════════════════════════════════════
    {
      // Cashfree-direct enabled -> Cashfree is the ONLY provider
      // consulted (highest priority, selection by configuration, not
      // a cascade).
      let cashfreeCalled = false, nonCashfreeCalled = false;
      const callLog = [];
      await simulateIntegratedVerifyPAN({
        panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test",
        cashfreeDirectEnabled: true, flags: makeLocalEnabledFlags(),
        providerFunctions: { [CHECK_TYPE.PAN]: async () => { cashfreeCalled = true; return SANITIZED_PAN_SUCCESS; } },
        callLog,
      });
      check("E. PAN priority — Cashfree first: when Cashfree-direct is enabled, Cashfree is consulted and nothing else", cashfreeCalled && callLog.length === 1 && callLog[0] === "CASHFREE_BRANCH");
    }
    {
      // Cashfree-direct disabled, SUREPASS_TOKEN unset (enforced for
      // this whole file) -> real verifyViaNonCashfreeProvider's
      // default `surepassConfigured` check is false, so Manual is
      // selected directly (Phase 5.4.7 fix — Surepass is not even
      // invoked when unconfigured; see Part I below for the dedicated,
      // injection-based proof of this exact distinction). This is the
      // REAL existing chain, exercised live and offline.
      const callLog = [];
      const result = await simulateIntegratedVerifyPAN({
        panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test",
        cashfreeDirectEnabled: false, flags: makeLocalDisabledFlags(), providerFunctions: {}, callLog,
      });
      check("E. PAN priority — Surepass not configured, Manual selected directly: with Cashfree-direct disabled, the real chain resolves via Manual and succeeds", result.success === true && result.source === VERIFICATION_SOURCE.MANUAL, result);
    }
    {
      // Bank: Cashfree-direct disabled -> real verifyViaNonCashfreeProvider
      // goes straight to Manual (no Surepass bank product exists).
      const callLog = [];
      const result = await simulateIntegratedVerifyBank({
        accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank", accountHolder: "Sandbox Test",
        cashfreeDirectEnabled: false, flags: makeLocalDisabledFlags(), providerFunctions: {}, callLog,
      });
      check("E. Bank priority — Cashfree then Manual only (no Surepass bank product): disabled Cashfree-direct falls straight to Manual", result.success === true && result.source === VERIFICATION_SOURCE.MANUAL, result);
    }

    // ════════════════════════════════════════════════════════
    // PART F — a Cashfree failure does not silently trigger a
    // weaker-provider retry. When Cashfree-direct is enabled and the
    // injected Cashfree provider returns a genuine FAILURE, the
    // simulated integration must return that failure AS-IS — it must
    // never fall through to Surepass/Manual within the same attempt.
    // ════════════════════════════════════════════════════════
    {
      let manualOrSurepassAttempted = false;
      const callLog = [];
      const result = await simulateIntegratedVerifyPAN({
        panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test",
        cashfreeDirectEnabled: true, flags: makeLocalEnabledFlags(),
        providerFunctions: { [CHECK_TYPE.PAN]: async () => SANITIZED_PAN_FAILURE },
        callLog,
      });
      check("F. PAN: a genuine Cashfree failure is returned as-is, success:false, source:CASHFREE", result.success === false && result.source === VERIFICATION_SOURCE.CASHFREE && result.remarks === SANITIZED_PAN_FAILURE.remarks, result);
      check("F. PAN: exactly one branch was taken (CASHFREE only) — no fallback branch was ever entered for this attempt", callLog.length === 1 && callLog[0] === "CASHFREE_BRANCH", callLog);
    }
    {
      const callLog = [];
      const result = await simulateIntegratedVerifyBank({
        accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank", accountHolder: "Sandbox Test",
        cashfreeDirectEnabled: true, flags: makeLocalEnabledFlags(),
        providerFunctions: { [CHECK_TYPE.BANK]: async () => SANITIZED_BANK_FAILURE },
        callLog,
      });
      check("F. BANK: a genuine Cashfree failure is returned as-is, success:false, source:CASHFREE", result.success === false && result.source === VERIFICATION_SOURCE.CASHFREE && result.remarks === SANITIZED_BANK_FAILURE.remarks, result);
      check("F. BANK: exactly one branch was taken (CASHFREE only) — no fallback branch was ever entered for this attempt", callLog.length === 1 && callLog[0] === "CASHFREE_BRANCH", callLog);
    }

    // ════════════════════════════════════════════════════════
    // PART G — Owner verification cannot be auto-approved by the
    // orchestrator (real, existing guard — re-confirmed here because
    // it is a direct requirement of this phase's acceptance criteria).
    // ════════════════════════════════════════════════════════
    {
      let threwForOwner = false;
      try { assertAutoApprovalAllowed(APPLICANT_TYPE.OWNER); } catch { threwForOwner = true; }
      check("G. assertAutoApprovalAllowed throws for OWNER — Owner verification cannot be auto-approved by the orchestrator", threwForOwner);

      let threwForFieldAgent = false;
      try { assertAutoApprovalAllowed(APPLICANT_TYPE.FIELD_AGENT); } catch { threwForFieldAgent = true; }
      check("G. assertAutoApprovalAllowed does NOT throw for FIELD_AGENT (the one role with an approved mechanism, unaffected by this phase)", threwForFieldAgent === false);
    }

    // ════════════════════════════════════════════════════════
    // PART H (REAL service boundary, persistence stubbed) — Phase
    // 5.4.6. Calls the REAL, unmodified verifyPAN/verifyBank exported
    // from verification.service.js. See file header for exactly what
    // this does and does not prove. mongoose.startSession and
    // VerificationLog.create are temporarily replaced with local
    // stand-ins (mutable object methods, not ES-module bindings),
    // restored immediately after this block via their own try/finally.
    // ════════════════════════════════════════════════════════
    {
      const makeFakeKyc = () => ({
        _id: "000000000000000000000001",
        ownerId: "000000000000000000000002",
        status: KYC_STATUS.DRAFT,
        verificationLevel: 0,
        submittedAt: null,
        risk: { score: 0 },
        identity: { pan: {}, aadhaar: {}, gst: {} },
        verification: { pan: {}, aadhaar: {}, bank: {}, face: {}, liveness: {}, ocr: {}, phone: {}, email: {}, manualReview: {} },
        bank: {},
        aadhaar: {},
        __saveCallCount: 0,
        async save() { this.__saveCallCount++; },
      });

      const originalStartSession = mongoose.startSession;
      const originalVerificationLogCreate = VerificationLog.create;
      // ZEMISH Option B, Phase 1 — verifyPAN/verifyBank now also call
      // syncSalonVisibilityForOwner(), which calls the REAL
      // Salon.updateMany(). Without stubbing it the same way
      // VerificationLog.create already is below, this real Mongoose
      // call has no live connection in this offline test and hangs
      // until Mongoose's command-buffering timeout fires, crashing the
      // whole process — confirmed by reproducing it before adding this
      // stub. Same inherited-method restoration pattern as
      // VerificationLog.create for the same reason (own-property
      // shadowing vs. prototype lookup).
      const originalSalonUpdateMany = Salon.updateMany;
      const withStubbedPersistence = async (fn) => {
        const sessionCalls = { startTransaction: 0, commitTransaction: 0, abortTransaction: 0, endSession: 0 };
        mongoose.startSession = async () => ({
          startTransaction: () => { sessionCalls.startTransaction++; },
          commitTransaction: async () => { sessionCalls.commitTransaction++; },
          abortTransaction: async () => { sessionCalls.abortTransaction++; },
          endSession: () => { sessionCalls.endSession++; },
        });
        let verificationLogCallCount = 0;
        VerificationLog.create = async (docs) => { verificationLogCallCount++; return docs; };
        let salonUpdateManyCallCount = 0;
        let lastSalonUpdateManyCall = null;
        Salon.updateMany = async (filter, update, options) => {
          salonUpdateManyCallCount++;
          lastSalonUpdateManyCall = { filter, update, options };
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        };
        try {
          const outcome = await fn();
          return { outcome, sessionCalls, verificationLogCallCount, salonUpdateManyCallCount, lastSalonUpdateManyCall };
        } finally {
          mongoose.startSession = originalStartSession;
          // create was an INHERITED method, never an own property —
          // delete restores prototype lookup rather than re-assigning
          // an own property with the same reference.
          delete VerificationLog.create;
          if (VerificationLog.create !== originalVerificationLogCreate) {
            // Defensive fallback — should be unreachable given the
            // confirmed-inherited shape, kept only so a future mongoose
            // version change can't silently leave this un-restored.
            VerificationLog.create = originalVerificationLogCreate;
          }
          delete Salon.updateMany;
          if (Salon.updateMany !== originalSalonUpdateMany) {
            Salon.updateMany = originalSalonUpdateMany;
          }
        }
      };

      // H1 — valid PAN, Cashfree/Surepass both unconfigured: real
      // verifyPAN must succeed via the real Manual path.
      {
        const kyc = makeFakeKyc();
        const { outcome, sessionCalls, verificationLogCallCount, salonUpdateManyCallCount, lastSalonUpdateManyCall } = await withStubbedPersistence(() =>
          verifyPAN({ kyc, panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test", adminId: "000000000000000000000003", adminLevel: "INDIA", requestId: "test-req-pan-1" })
        );
        check("H. (REAL service boundary, persistence stubbed) verifyPAN succeeds via real Manual path when Cashfree/Surepass unconfigured", outcome.success === true && outcome.result.source === VERIFICATION_SOURCE.MANUAL, outcome.result);
        // ZEMISH Option B, Phase 1 — confirms the real verifyPAN now
        // also calls syncSalonVisibilityForOwner exactly once, inside
        // the same (stubbed) transaction, and correctly computes
        // false — PAN alone is never sufficient, Bank is still
        // unverified on this fake kyc, matching isMandatoryOwnerKyc
        // Verified()'s real, unchanged "both required" rule.
        check("H. (ZEMISH Option B) syncSalonVisibilityForOwner called exactly once via the real verifyPAN", salonUpdateManyCallCount === 1, salonUpdateManyCallCount);
        check("H. (ZEMISH Option B) visibility sync correctly resolves false — PAN alone never satisfies the mandatory PAN+Bank rule", lastSalonUpdateManyCall?.update?.$set?.["business.isKycVerifiedForDiscovery"] === false, lastSalonUpdateManyCall);
        check("H. (REAL service boundary, persistence stubbed) kyc.verification.pan fields correctly set by the real verifyPAN", kyc.verification.pan.verified === true && kyc.verification.pan.verificationSource === VERIFICATION_SOURCE.MANUAL && typeof kyc.verification.pan.status === "string", kyc.verification.pan);
        check("H. (REAL service boundary, persistence stubbed) real encrypt()/maskPAN() ran — masked+encrypted PAN fields populated", typeof kyc.identity.pan.maskedNumber === "string" && typeof kyc.identity.pan.encryptedNumber === "string", kyc.identity.pan);
        check("H. (REAL service boundary, persistence stubbed) response-relevant fields present: status/level/remarks", typeof kyc.status === "string" && typeof kyc.verificationLevel === "number" && typeof outcome.result.remarks === "string", { status: kyc.status, level: kyc.verificationLevel, remarks: outcome.result.remarks });
        check("H. (REAL service boundary, persistence stubbed) exactly one VerificationLog write for this attempt", verificationLogCallCount === 1, verificationLogCallCount);
        check("H. (REAL service boundary, persistence stubbed) transaction lifecycle fires exactly once each, never aborted", sessionCalls.startTransaction === 1 && sessionCalls.commitTransaction === 1 && sessionCalls.abortTransaction === 0 && sessionCalls.endSession === 1, sessionCalls);
        check("H. (REAL service boundary, persistence stubbed) kyc.save called exactly once", kyc.__saveCallCount === 1, kyc.__saveCallCount);
      }

      // H2 — invalid PAN format: real verifyPAN must fail via real Manual path, still exactly one log write / one transaction.
      {
        const kyc = makeFakeKyc();
        const { outcome, sessionCalls, verificationLogCallCount } = await withStubbedPersistence(() =>
          verifyPAN({ kyc, panNumber: "INVALID", nameOnPAN: "Sandbox Test", adminId: "000000000000000000000003", adminLevel: "INDIA", requestId: "test-req-pan-2" })
        );
        check("H. (REAL service boundary, persistence stubbed) verifyPAN fails via real Manual path for an invalid PAN format", outcome.success === false && outcome.result.source === VERIFICATION_SOURCE.MANUAL && typeof outcome.result.remarks === "string" && outcome.result.remarks.length > 0, outcome.result);
        check("H. (REAL service boundary, persistence stubbed) kyc.verification.pan.verified is false on failure", kyc.verification.pan.verified === false, kyc.verification.pan);
        check("H. (REAL service boundary, persistence stubbed) exactly one VerificationLog write and one transaction cycle even on failure", verificationLogCallCount === 1 && sessionCalls.startTransaction === 1 && sessionCalls.commitTransaction === 1 && sessionCalls.abortTransaction === 0, { verificationLogCallCount, sessionCalls });
      }

      // H3 — valid bank details: real verifyBank must succeed via real Manual path.
      {
        const kyc = makeFakeKyc();
        const { outcome, sessionCalls, verificationLogCallCount } = await withStubbedPersistence(() =>
          verifyBank({ kyc, accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank", accountHolder: "Sandbox Test", adminId: "000000000000000000000003", adminLevel: "INDIA", requestId: "test-req-bank-1" })
        );
        check("H. (REAL service boundary, persistence stubbed) verifyBank succeeds via real Manual path when Cashfree unconfigured", outcome.success === true && outcome.result.source === VERIFICATION_SOURCE.MANUAL, outcome.result);
        check("H. (REAL service boundary, persistence stubbed) kyc.verification.bank fields correctly set; kyc.bank masked fields populated", kyc.verification.bank.verified === true && typeof kyc.bank.maskedAccount === "string" && typeof kyc.bank.encryptedAccount === "string" && kyc.bank.pennyDropStatus === "SUCCESS", { verification: kyc.verification.bank, bank: kyc.bank });
        check("H. (REAL service boundary, persistence stubbed) exactly one VerificationLog write and one transaction cycle", verificationLogCallCount === 1 && sessionCalls.startTransaction === 1 && sessionCalls.commitTransaction === 1 && sessionCalls.abortTransaction === 0 && sessionCalls.endSession === 1, { verificationLogCallCount, sessionCalls });
      }

      // H4 — invalid bank details (bad IFSC): real verifyBank must fail via real Manual path.
      {
        const kyc = makeFakeKyc();
        const { outcome, sessionCalls, verificationLogCallCount } = await withStubbedPersistence(() =>
          verifyBank({ kyc, accountNumber: "026291800001191", ifsc: "NOT-A-VALID-IFSC", bankName: "Yes Bank", accountHolder: "Sandbox Test", adminId: "000000000000000000000003", adminLevel: "INDIA", requestId: "test-req-bank-2" })
        );
        check("H. (REAL service boundary, persistence stubbed) verifyBank fails via real Manual path for an invalid IFSC", outcome.success === false && outcome.result.source === VERIFICATION_SOURCE.MANUAL && typeof outcome.result.remarks === "string" && outcome.result.remarks.length > 0, outcome.result);
        check("H. (REAL service boundary, persistence stubbed) kyc.bank.pennyDropStatus reflects the failure", kyc.bank.pennyDropStatus === "FAILED", kyc.bank);
        check("H. (REAL service boundary, persistence stubbed) exactly one VerificationLog write and one transaction cycle even on failure", verificationLogCallCount === 1 && sessionCalls.startTransaction === 1 && sessionCalls.commitTransaction === 1 && sessionCalls.abortTransaction === 0, { verificationLogCallCount, sessionCalls });
      }

      check("H. mongoose.startSession fully restored to its original function after Part H", mongoose.startSession === originalStartSession);
      check("H. VerificationLog.create fully restored (inherited lookup, no stray own property) after Part H", !Object.prototype.hasOwnProperty.call(VerificationLog, "create"));
      check("H. (ZEMISH Option B) Salon.updateMany fully restored (inherited lookup, no stray own property) after Part H", !Object.prototype.hasOwnProperty.call(Salon, "updateMany"));
    }

    // ════════════════════════════════════════════════════════
    // PART I (orchestrator contract, Phase 5.4.7) — PAN fallback
    // semantics fix: selection by configuration presence ONLY,
    // decided before either Surepass or Manual is called. Explicitly
    // distinguishes "Surepass not configured" from "Surepass
    // configured and genuinely rejects", via dependency injection
    // (`surepassConfigured` + `providerFunctions`) — never a real
    // SUREPASS_TOKEN, never a network call. Calls the REAL, now-fixed
    // verifyViaNonCashfreeProvider directly (not the Part A-G
    // simulation helpers), so these are real orchestrator-contract
    // tests, not simulations.
    // ════════════════════════════════════════════════════════
    {
      const GENUINE_SUREPASS_REJECTION = {
        success: false, source: VERIFICATION_SOURCE.SUREPASS, status: "FAILED",
        remarks: "Name mismatch between PAN and provided name", providerRef: "surepass-req-fixture-1",
        data: null,
      };
      const GENUINE_SUREPASS_SUCCESS = {
        success: true, source: VERIFICATION_SOURCE.SUREPASS, status: "VERIFIED",
        remarks: "PAN verified via Surepass", providerRef: "surepass-req-fixture-2",
        data: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test", panType: null, aadhaarLinked: false, verifiedAt: "2026-10-10T00:00:00.000Z" },
      };

      // I1 — Surepass NOT configured: Manual must be selected directly.
      // Surepass must never be invoked at all (count stays 0) — proves
      // requirement 4 (Manual selected by policy, not by inspecting a
      // Surepass result that was never even produced).
      {
        let surepassCalls = 0, manualCalls = 0;
        const result = await verifyViaNonCashfreeProvider({
          checkType: CHECK_TYPE.PAN, applicantType: APPLICANT_TYPE.OWNER,
          payload: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test" },
          surepassConfigured: false,
          providerFunctions: {
            PAN_SUREPASS: async () => { surepassCalls++; return GENUINE_SUREPASS_SUCCESS; },
            PAN_MANUAL: async () => { manualCalls++; return { success: true, source: VERIFICATION_SOURCE.MANUAL, status: "VERIFIED", remarks: "PAN manually verified by admin", providerRef: null, data: null }; },
          },
        });
        check("I. Surepass NOT configured: Manual is selected directly", result.source === VERIFICATION_SOURCE.MANUAL && result.success === true, result);
        check("I. Surepass NOT configured: Surepass is never invoked (count 0)", surepassCalls === 0, surepassCalls);
        check("I. Surepass NOT configured: Manual is invoked exactly once", manualCalls === 1, manualCalls);
      }

      // I2 — Surepass CONFIGURED and genuinely REJECTS: that result
      // must be FINAL. Manual must never be invoked (count stays 0) —
      // proves requirements 2/3 (no silent retry against a weaker
      // provider after a genuine, configured rejection).
      {
        let surepassCalls = 0, manualCalls = 0;
        const result = await verifyViaNonCashfreeProvider({
          checkType: CHECK_TYPE.PAN, applicantType: APPLICANT_TYPE.OWNER,
          payload: { panNumber: "ABCPV1234D", nameOnPAN: "Wrong Name" },
          surepassConfigured: true,
          providerFunctions: {
            PAN_SUREPASS: async () => { surepassCalls++; return GENUINE_SUREPASS_REJECTION; },
            PAN_MANUAL: async () => { manualCalls++; return { success: true, source: VERIFICATION_SOURCE.MANUAL, status: "VERIFIED", remarks: "PAN manually verified by admin", providerRef: null, data: null }; },
          },
        });
        check("I. Surepass configured + genuine rejection: the rejection is returned as-is (source SUREPASS, success false)", result.source === VERIFICATION_SOURCE.SUREPASS && result.success === false && result.remarks === GENUINE_SUREPASS_REJECTION.remarks, result);
        check("I. Surepass configured + genuine rejection: Surepass invoked exactly once", surepassCalls === 1, surepassCalls);
        check("I. Surepass configured + genuine rejection: Manual is NEVER invoked — no silent retry against a weaker provider", manualCalls === 0, manualCalls);
      }

      // I3 — Surepass CONFIGURED and genuinely SUCCEEDS: that result
      // must also be final (Manual never consulted at all).
      {
        let surepassCalls = 0, manualCalls = 0;
        const result = await verifyViaNonCashfreeProvider({
          checkType: CHECK_TYPE.PAN, applicantType: APPLICANT_TYPE.OWNER,
          payload: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test" },
          surepassConfigured: true,
          providerFunctions: {
            PAN_SUREPASS: async () => { surepassCalls++; return GENUINE_SUREPASS_SUCCESS; },
            PAN_MANUAL: async () => { manualCalls++; throw new Error("Manual must never be called when Surepass is configured and succeeds"); },
          },
        });
        check("I. Surepass configured + genuine success: the success is returned as-is (source SUREPASS)", result.source === VERIFICATION_SOURCE.SUREPASS && result.success === true, result);
        check("I. Surepass configured + genuine success: Surepass invoked exactly once, Manual never invoked", surepassCalls === 1 && manualCalls === 0, { surepassCalls, manualCalls });
      }

      // I4 — the REAL default (`surepassConfigured` defaults to
      // `!!process.env.SUREPASS_TOKEN`, which is deleted for this
      // file's entire run) reaches the REAL verifyPANManual with zero
      // overrides at all — proves the production default path (no
      // injection) is itself correct, not just the injectable seam.
      {
        const result = await verifyViaNonCashfreeProvider({
          checkType: CHECK_TYPE.PAN, applicantType: APPLICANT_TYPE.OWNER,
          payload: { panNumber: "ABCPV1234D", nameOnPAN: "Sandbox Test" },
        });
        check("I. REAL default path (no injection, SUREPASS_TOKEN absent): resolves via real Manual, exactly once, zero network", result.source === VERIFICATION_SOURCE.MANUAL && result.success === true, result);
      }

      // I5 — Bank is unaffected by this phase's PAN-specific fix:
      // still Manual-only, exactly once, real default path.
      {
        const result = await verifyViaNonCashfreeProvider({
          checkType: CHECK_TYPE.BANK, applicantType: APPLICANT_TYPE.OWNER,
          payload: { accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank", accountHolder: "Sandbox Test" },
        });
        check("I. BANK unaffected by the PAN fix: still resolves via real Manual", result.source === VERIFICATION_SOURCE.MANUAL && result.success === true, result);
      }
    }

  } finally {
    // Restore real env state regardless of outcome above.
    if (savedSurepass !== undefined) process.env.SUREPASS_TOKEN = savedSurepass; else delete process.env.SUREPASS_TOKEN;
    if (savedCashfreeVerificationEnv !== undefined) process.env.CASHFREE_VERIFICATION_ENV = savedCashfreeVerificationEnv; else delete process.env.CASHFREE_VERIFICATION_ENV;
    if (savedCashfreeVerificationId !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_ID = savedCashfreeVerificationId; else delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
    if (savedCashfreeVerificationSecret !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = savedCashfreeVerificationSecret; else delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
    if (savedEncryptionKey !== undefined) process.env.KYC_ENCRYPTION_KEY = savedEncryptionKey; else delete process.env.KYC_ENCRYPTION_KEY;
  }

  console.log(rows.join("\n"));
  console.log(`\nVERIFICATION SERVICE <-> ORCHESTRATOR INTEGRATION CONTRACT (Parts A-G: offline contract simulation. Part H: REAL verification.service.js functions, persistence stubbed — no MongoDB connection was made): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
