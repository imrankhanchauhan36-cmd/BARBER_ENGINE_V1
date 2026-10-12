/**
 * BARBER ENGINE V1
 * backend/modules/kyc/engine/verificationOrchestrator.service.js
 * Global Verification Engine — Phase 5, NON-CASHFREE PORTION ONLY
 * (approved, additive, isolated — not wired into any existing route)
 *
 * SCOPE OF THIS FILE, EXACTLY AS AUTHORIZED:
 *   - Role-aware metadata (which checks/providers apply to which role)
 *   - A thin, read-only pass-through to the EXISTING manual/surepass
 *     provider functions, normalized through providerAdapter.contract.js
 *   - A hard, tested guard that auto-approval logic can never be
 *     attempted for any role except FIELD_AGENT
 *
 * EXPLICITLY NOT IN SCOPE, BY DESIGN, IN THIS PHASE:
 *   - No Cashfree-only capability (Aadhaar OTP, Face Match, Liveness,
 *     GST) is ever invoked by this file. Each is represented only as
 *     disabled metadata (see CASHFREE_CAPABILITY_FLAGS below) — the
 *     real cashfree.provider.js functions for these checks are never
 *     imported or called here. They remain disabled until Phase 0
 *     (real Cashfree Sandbox contract validation) passes AND a
 *     separate approval explicitly flips a flag below.
 *   - This file is not imported by any controller, route, or existing
 *     service (ownerKyc.service.js, fieldAgentKyc.service.js,
 *     verification.service.js, kyc.service.js). It calls OUT to the
 *     existing manual/surepass provider files for metadata-driven
 *     verification, but nothing calls IN to this file from production
 *     code yet.
 *   - No database access. No KYC/KYCDocument/VerificationLog read or
 *     write. No session/transaction. Persisting a verification result
 *     remains the exclusive responsibility of the existing, frozen
 *     kyc.service.js / ownerKyc.service.js / fieldAgentKyc.service.js
 *     — this file only selects and calls a provider, it does not save
 *     anything.
 *   - No auto-approval is actually performed here (that real,
 *     production mechanism lives untouched in
 *     fieldAgentKyc.service.js's attemptFieldAgentAutoApproval). This
 *     file only exposes assertAutoApprovalAllowed(), a guard that
 *     PROVES (via test, not just comment) that any future caller of
 *     a role-independent auto-approval helper cannot accidentally
 *     target a non-FIELD_AGENT role.
 */

import { APPLICANT_TYPE, VERIFICATION_SOURCE } from "../constants/kyc.constants.js";
import { verifyPANManual, verifyAadhaarManual, verifyBankManual } from "../providers/manual.provider.js";
import { verifyPANSurepass } from "../providers/surepass.provider.js";
// Phase 5.1 (2026-10-10, additive) — ONLY these three named functions.
// Deliberately NOT importing verifyAadhaarOTP*/verifyFaceMatchCashfree/
// verifyLivenessCashfree — see CASHFREE_DIRECT_CAPABILITY_FLAGS below
// for why those three remain categorically excluded from this file.
import { verifyPANCashfree, verifyGSTCashfree, verifyBankCashfree } from "../providers/cashfree.provider.js";
import { isDataFreeOfObviousPII, isValidProviderResult } from "./providerAdapter.contract.js";
import { getRoleConfig } from "./roleConfig.js";

// ─── Verification check identifiers — role-independent names for the
// capabilities this engine knows about. Intentionally NOT reusing
// KYC.js's `verification.*` sub-document field names 1:1, to keep this
// file from implying it reads/writes that schema (it doesn't).
export const CHECK_TYPE = {
  PAN:     "PAN",
  AADHAAR: "AADHAAR",
  BANK:    "BANK",
  FACE:    "FACE",
  LIVENESS:"LIVENESS",
  GST:     "GST",
};

// ─── Cashfree capability flags — ALL disabled. Do not flip any of
// these to true without (a) Phase 0's real Cashfree Sandbox contract
// validation passing, confirming the three ⚠ UNCONFIRMED field names
// in cashfree.provider.js against real responses, and (b) a separate,
// explicit approval for wiring this engine into a live route. Neither
// condition is met as of this file's creation.
//
// 2026-10-10, Phase 5.4.5 HARDENING — Object.freeze() is SHALLOW: the
// original version below froze only the outer map, leaving each
// per-checkType `{ enabled, reason }` object itself mutable (confirmed
// by direct test: `CASHFREE_CAPABILITY_FLAGS.AADHAAR.enabled = true`
// silently succeeded, no throw). Each nested object is now ALSO
// individually frozen, so a mutation attempt at either level throws.
const freezeFlag = (flag) => Object.freeze(flag);
export const CASHFREE_CAPABILITY_FLAGS = Object.freeze({
  [CHECK_TYPE.AADHAAR]:  freezeFlag({ enabled: false, reason: "Cashfree-only capability — Phase 0 sandbox contract not yet validated" }),
  [CHECK_TYPE.FACE]:     freezeFlag({ enabled: false, reason: "Cashfree-only capability — Phase 0 sandbox contract not yet validated" }),
  [CHECK_TYPE.LIVENESS]: freezeFlag({ enabled: false, reason: "Cashfree-only capability — Phase 0 sandbox contract not yet validated" }),
  [CHECK_TYPE.GST]:      freezeFlag({ enabled: false, reason: "Cashfree-only capability — Phase 0 sandbox contract not yet validated" }),
});

/**
 * @param {string} checkType - one of CHECK_TYPE's values
 * @returns {boolean} true only for a Cashfree-only check whose flag
 *   has been explicitly enabled. Always false today for AADHAAR/
 *   FACE/LIVENESS/GST. PAN and BANK are not Cashfree-only (Manual/
 *   Surepass already cover them without any flag), so this always
 *   returns true for those two regardless of Cashfree state.
 */
export const isCashfreeCapabilityEnabled = (checkType) => {
  const flag = CASHFREE_CAPABILITY_FLAGS[checkType];
  if (!flag) return true; // not a Cashfree-only check (e.g. PAN, BANK)
  return flag.enabled === true;
};

/**
 * Role-aware, metadata-only view of which provider(s) are available
 * for a given check today — mirrors, but does not alter, the real
 * provider-priority chains already implemented in
 * verification.service.js (Owner/admin-driven) and
 * fieldAgentKyc.service.js (Field Agent self-serve). This is
 * documentation-as-data, consumed only by tests and (in a future,
 * separately-approved phase) by a real call site — nothing here
 * changes which provider verification.service.js/fieldAgentKyc
 * .service.js actually call today.
 *
 * @param {string} checkType - one of CHECK_TYPE's values
 * @param {string} applicantType - one of APPLICANT_TYPE's values
 * @returns {{ checkType: string, applicantType: string, providerChain: string[], cashfreeOnly: boolean }}
 */
export const resolveProviderChain = (checkType, applicantType) => {
  getRoleConfig(applicantType); // throws on an unknown role — fail closed

  switch (checkType) {
    case CHECK_TYPE.PAN:
      // Owner/admin-driven path today: Surepass -> Manual (verification.service.js).
      // Field Agent self-serve path today: Surepass -> Manual (fieldAgentKyc.service.js),
      // same chain, no Cashfree PAN capability exists in cashfree.provider.js.
      return { checkType, applicantType, providerChain: [VERIFICATION_SOURCE.SUREPASS, VERIFICATION_SOURCE.MANUAL], cashfreeOnly: false };

    case CHECK_TYPE.BANK:
      // Manual-only today for both roles (penny-drop/Cashfree bank
      // capability exists in cashfree.provider.js but is not reachable
      // by Owner's admin-driven flow; Field Agent's own chain is not
      // altered by this file).
      return { checkType, applicantType, providerChain: [VERIFICATION_SOURCE.MANUAL], cashfreeOnly: false };

    case CHECK_TYPE.AADHAAR:
      // Owner/admin path: Manual (last-4-digit confirmation) only —
      // no Cashfree Aadhaar capability is used by that flow today.
      // Field Agent path: Cashfree-only (OTP), no Manual/Surepass
      // fallback exists for Field Agent's Aadhaar check in the real
      // code — reflected here as cashfreeOnly for Field Agent.
      if (applicantType === APPLICANT_TYPE.FIELD_AGENT) {
        return { checkType, applicantType, providerChain: [VERIFICATION_SOURCE.CASHFREE], cashfreeOnly: true };
      }
      return { checkType, applicantType, providerChain: [VERIFICATION_SOURCE.MANUAL], cashfreeOnly: false };

    case CHECK_TYPE.FACE:
    case CHECK_TYPE.LIVENESS:
    case CHECK_TYPE.GST:
      // Cashfree-only for both roles today (Owner's flow doesn't
      // expose these checks at all; Field Agent's flow has no
      // Manual/Surepass equivalent for any of the three).
      return { checkType, applicantType, providerChain: [VERIFICATION_SOURCE.CASHFREE], cashfreeOnly: true };

    default:
      throw new Error(`resolveProviderChain: unknown checkType "${checkType}"`);
  }
};

// Phase 5.4.7 — private, non-exported default provider-function map for
// the non-Cashfree chain, mirroring the already-established pattern
// used below for DEFAULT_CASHFREE_DIRECT_PROVIDER_FUNCTIONS. Deliberately
// NOT exported — a test that wants a different behavior injects its OWN
// map via verifyViaNonCashfreeProvider's `providerFunctions` parameter,
// never by reaching into this one.
const DEFAULT_NON_CASHFREE_PROVIDER_FUNCTIONS = Object.freeze({
  PAN_SUREPASS:  (payload) => verifyPANSurepass({ panNumber: payload.panNumber }),
  PAN_MANUAL:    (payload) => verifyPANManual({ panNumber: payload.panNumber, name: payload.nameOnPAN }),
  BANK_MANUAL:   (payload) => verifyBankManual({
    accountNumber: payload.accountNumber,
    ifsc: payload.ifsc,
    bankName: payload.bankName,
    accountHolder: payload.accountHolder,
  }),
  AADHAAR_MANUAL: (payload) => verifyAadhaarManual({ last4: payload.last4 }),
});

/**
 * Calls an existing, non-Cashfree provider function directly (Manual
 * or Surepass) and normalizes/validates its return shape against
 * providerAdapter.contract.js. Does NOT persist anything, does NOT
 * touch VerificationLog/KYC, does NOT decide KYC status — identical
 * division of responsibility to how verification.service.js already
 * treats these same provider functions (it also only calls them and
 * then separately decides what to persist).
 *
 * Throws if `checkType` resolves to a Cashfree-only chain — callers
 * must check isCashfreeCapabilityEnabled()/resolveProviderChain()
 * first; this function refuses to silently fall through to a
 * disabled capability.
 *
 * Phase 5.4.7 HARDENING — PAN selection is now by CONFIGURATION
 * PRESENCE ONLY, decided BEFORE any provider is called, exactly
 * mirroring verification.service.js's own pre-existing, documented
 * policy ("Selection is by CONFIGURATION presence ... never a 'retry
 * with a weaker provider on failure' chain"). The PREVIOUS version of
 * this function called verifyPANSurepass unconditionally and fell
 * through to verifyPANManual whenever `!result.success` — which
 * silently conflated two different reasons for a non-success result:
 * "Surepass isn't configured at all" (should fall through to Manual,
 * matching policy) vs. "Surepass IS configured and genuinely rejected
 * this PAN" (must be FINAL — the existing policy never retries a
 * configured provider's real rejection against a weaker one). That
 * distinction cannot be made reliably by inspecting Surepass's
 * response after the fact (its "not configured" and "genuine
 * API/network failure" result shapes are not reliably distinguishable
 * from the outside — e.g. neither includes a `providerRef` key, so a
 * presence/absence check would misclassify a genuine network failure
 * as "not configured"). Checking configuration BEFORE calling anything
 * avoids that ambiguity entirely, matches the already-correct Cashfree
 * pattern, and is exactly what verification.service.js's original
 * inline code already did prior to Phase 5.4.6's integration.
 *
 * @param {Object} params
 * @param {string} params.checkType - one of CHECK_TYPE's values (PAN | BANK | AADHAAR)
 * @param {string} params.applicantType - one of APPLICANT_TYPE's values
 * @param {Object} params.payload - fields required by the underlying provider (e.g. { panNumber, name })
 * @param {boolean} [params.surepassConfigured] - PAN only. Defaults to
 *   the real `!!process.env.SUREPASS_TOKEN` check, evaluated fresh on
 *   every call (a default parameter expression, not a cached value).
 *   Overriding this is a test-only seam — no production caller passes
 *   it, so real behavior is unaffected.
 * @param {Object} [params.providerFunctions] - defaults to the real
 *   Surepass/Manual-calling functions (DEFAULT_NON_CASHFREE_PROVIDER_FUNCTIONS).
 *   Overriding this lets a test inject a deterministic, synchronous
 *   stand-in instead of a live network call — e.g. to simulate a
 *   genuine, configured Surepass rejection without ever setting a real
 *   SUREPASS_TOKEN or reaching the network. No production caller
 *   passes it either.
 * @returns {Promise<Object>} a ProviderResult (see providerAdapter.contract.js)
 */
export const verifyViaNonCashfreeProvider = async ({
  checkType,
  applicantType,
  payload = {},
  surepassConfigured = !!process.env.SUREPASS_TOKEN,
  providerFunctions = DEFAULT_NON_CASHFREE_PROVIDER_FUNCTIONS,
}) => {
  const chain = resolveProviderChain(checkType, applicantType);
  if (chain.cashfreeOnly) {
    throw new Error(
      `verifyViaNonCashfreeProvider: ${checkType} for ${applicantType} is Cashfree-only — ` +
      `this function deliberately never calls Cashfree. Use the existing fieldAgentKyc.service.js ` +
      `flow directly for Cashfree-backed checks.`
    );
  }

  let result;
  if (checkType === CHECK_TYPE.PAN) {
    // Selection by CONFIGURATION PRESENCE ONLY, decided before either
    // provider is ever called — see the Phase 5.4.7 hardening note
    // above. Whichever one is selected, its result (success OR
    // failure) is FINAL; the other is never consulted for this
    // attempt.
    result = surepassConfigured
      ? await providerFunctions.PAN_SUREPASS(payload)
      : await providerFunctions.PAN_MANUAL(payload);
  } else if (checkType === CHECK_TYPE.BANK) {
    result = await providerFunctions.BANK_MANUAL(payload);
  } else if (checkType === CHECK_TYPE.AADHAAR) {
    // Only reachable here for OWNER (FIELD_AGENT's Aadhaar chain is
    // cashfreeOnly and already rejected above).
    result = await providerFunctions.AADHAAR_MANUAL(payload);
  } else {
    throw new Error(`verifyViaNonCashfreeProvider: unsupported checkType "${checkType}"`);
  }

  const shapeCheck = isValidProviderResult(result);
  if (!shapeCheck.valid) {
    // Fails loudly rather than silently passing through a malformed
    // result — this is the contract's enforcement point.
    throw new Error(`verifyViaNonCashfreeProvider: provider result failed contract check: ${shapeCheck.errors.join("; ")}`);
  }

  return result;
};

// ════════════════════════════════════════════════════════════════
// PHASE 5.1 — DORMANT, ADDITIVE CASHFREE DIRECT PATH
// (approved 2026-10-10, restricted to PAN/GST/Bank only)
//
// Built after real, successful Cashfree Sandbox calls for PAN, GST,
// and Bank (confirmed via isolated preflights earlier this session —
// no credentials, PII, or IPs recorded here). verifyViaNonCashfreeProvider
// above is completely unmodified by this section — it still only ever
// calls Manual/Surepass, exactly as before.
//
// Evidence-of-working vs. authorized-to-use are kept as two SEPARATE
// gates on purpose: proving Cashfree works in Sandbox is not the same
// decision as approving the orchestrator to actually route through
// it. Every flag below defaults to false regardless of the Sandbox
// evidence, and only a separate, explicit future approval may flip
// one — this file does not flip its own flags.
// ════════════════════════════════════════════════════════════════

const CASHFREE_DIRECT_SUPPORTED_CHECK_TYPES = [CHECK_TYPE.PAN, CHECK_TYPE.GST, CHECK_TYPE.BANK];

// 2026-10-10, Phase 5.4.5 HARDENING — NOW FROZEN. Previously this was
// deliberately left mutable, reasoned as safe because "default
// disabled, and nothing calls this file" were the two guarantees, not
// object immutability. That reasoning stops holding the moment this
// file gains a real (even indirect) production importer: a shared,
// mutable singleton read by production code and also temporarily
// flipped by a test (even one that restores it in a finally block) is
// a latent cross-test/production race the instant two things touch it
// concurrently — a risk not worth carrying forward now that
// integration work (Phase 5.4.4's readiness audit) is active. Freezing
// closes that gap the same way CASHFREE_CAPABILITY_FLAGS above already
// was closed, at zero cost: every real call site must now use the
// already-supported `flags` parameter (dependency injection) to
// exercise a non-default state, exactly like
// verifyCashfreeDirectSuccessPath.mjs already does. No production
// caller exists today that needs to flip this at runtime — only tests
// do, and tests should inject their own disposable object rather than
// mutate this one. verifyCashfreeDirectCapability.mjs was updated in
// this same phase to stop mutating this export directly (see that
// file's own header for what changed).
//
// Object.freeze() is SHALLOW — freezing only the outer map here would
// leave each nested `{ enabled, reason }` object itself still
// mutable (the exact gap this phase's own offline integration test
// caught: a direct `CASHFREE_DIRECT_CAPABILITY_FLAGS.PAN.enabled = true`
// silently succeeded with only an outer freeze). Each nested object is
// therefore ALSO individually frozen below, so a mutation attempt at
// either level now throws a TypeError (this file and its test files
// run as ES modules, which are strict-mode by default).
export const CASHFREE_DIRECT_CAPABILITY_FLAGS = Object.freeze({
  [CHECK_TYPE.PAN]: Object.freeze({
    enabled: false,
    reason: "Proven in a real Cashfree Sandbox call (2026-10-10) — not yet approved for orchestrator use. Requires separate authorization to enable.",
  }),
  [CHECK_TYPE.GST]: Object.freeze({
    enabled: false,
    reason: "Proven in a real Cashfree Sandbox call (2026-10-10) — not yet approved for orchestrator use. Requires separate authorization to enable.",
  }),
  [CHECK_TYPE.BANK]: Object.freeze({
    enabled: false,
    reason: "Proven in a real Cashfree Sandbox call (2026-10-10) — not yet approved for orchestrator use. Requires separate authorization to enable.",
  }),
});

/**
 * @param {string} checkType - one of CHECK_TYPE's values
 * @param {Object} [flags] - defaults to the real, shared, production
 *   flags. Phase 5.3 — made overridable so tests can inject their own
 *   disposable flag object instead of mutating the shared singleton
 *   (see verifyCashfreeDirectCapability.mjs for the still-supported
 *   mutation-based style, and verifyCashfreeDirectSuccessPath.mjs for
 *   the new injection-based style). No production caller ever passes
 *   a second argument, so real behavior is unaffected by this change.
 * @returns {boolean} true ONLY for PAN/GST/BANK with their flag
 *   explicitly set to true. Always false for AADHAAR/FACE/LIVENESS
 *   (they have no entry in this map at all) and for anything unknown
 *   — fails closed by construction, not by a default parameter.
 */
export const isCashfreeDirectCapabilityEnabled = (checkType, flags = CASHFREE_DIRECT_CAPABILITY_FLAGS) => {
  const flag = flags[checkType];
  return flag ? flag.enabled === true : false;
};

// Phase 5.3 — private, non-exported default provider-function map.
// Deliberately NOT exported: unlike CASHFREE_DIRECT_CAPABILITY_FLAGS,
// nothing needs to mutate or inspect this from outside — a test that
// wants a different behavior injects its OWN map via the `providerFunctions`
// parameter below, rather than reaching into this one. Keeping it
// private means there is no way for anything, including a test, to
// alter what a REAL (no-override) call actually does.
const DEFAULT_CASHFREE_DIRECT_PROVIDER_FUNCTIONS = Object.freeze({
  [CHECK_TYPE.PAN]: (payload) => verifyPANCashfree({ panNumber: payload.panNumber, nameOnPAN: payload.nameOnPAN }),
  [CHECK_TYPE.GST]: (payload) => verifyGSTCashfree({ gstNumber: payload.gstNumber }),
  [CHECK_TYPE.BANK]: (payload) => verifyBankCashfree({
    accountNumber: payload.accountNumber,
    ifsc: payload.ifsc,
    accountHolder: payload.accountHolder,
  }),
});

/**
 * Calls ONE of the three proven-in-Sandbox Cashfree functions
 * directly (or, for tests only, an injected stand-in — see below).
 * Does NOT persist anything, does NOT touch KYC/Mongo, does NOT
 * decide KYC status — identical division of responsibility to
 * verifyViaNonCashfreeProvider above. Has NO caller anywhere in this
 * codebase outside its own tests — confirmed by this file never being
 * imported by any route/controller/service, and by this function
 * never being re-exported through any of them.
 *
 * Rejection order, both fail closed, BOTH evaluated before `payload`
 * is ever consulted for anything other than the provider call itself:
 *   1. checkType not in {PAN, GST, BANK} at all (covers AADHAAR, FACE,
 *      LIVENESS, and anything unrecognized) → explicit, named refusal.
 *      This check happens unconditionally, regardless of what `flags`
 *      or `providerFunctions` are passed in — an unsupported checkType
 *      can never be smuggled through even with permissive overrides.
 *   2. checkType is one of the three, but its flag (real or injected)
 *      is still false → explicit "not yet enabled" refusal.
 * Only past both gates does this ever call a provider function.
 *
 * SECURITY NOTE — `payload` can never enable a capability: `flags` and
 * `providerFunctions` are read ONLY from this function's own top-level
 * named parameters, never from any property inside `payload`. A
 * caller supplying `payload: { flags: {...}, enabled: true, ... }`
 * has no effect whatsoever on the gating decision — `payload` is
 * forwarded as-is to the resolved provider function and nowhere else.
 *
 * @param {Object} params
 * @param {string} params.checkType - one of CHECK_TYPE's values
 * @param {Object} [params.payload] - fields required by the underlying provider
 * @param {Object} [params.flags] - defaults to the real, shared,
 *   production flags (CASHFREE_DIRECT_CAPABILITY_FLAGS). Overriding
 *   this is a test-only seam — no production caller exists to use it.
 * @param {Object} [params.providerFunctions] - defaults to the real
 *   Cashfree-calling functions. Overriding this is the offline
 *   success-path test seam (Phase 5.3) — it lets a test drive this
 *   function's real validation logic with a deterministic, synchronous
 *   stand-in result instead of a live network call, WITHOUT monkey-
 *   patching any ES module export and WITHOUT touching cashfree.provider.js.
 *   No production caller exists to use this override either.
 * @returns {Promise<Object>} a ProviderResult (see providerAdapter.contract.js),
 *   already validated against both the shape contract and the PII guard.
 */
export const verifyViaCashfreeProvider = async ({
  checkType,
  payload = {},
  flags = CASHFREE_DIRECT_CAPABILITY_FLAGS,
  providerFunctions = DEFAULT_CASHFREE_DIRECT_PROVIDER_FUNCTIONS,
}) => {
  if (!CASHFREE_DIRECT_SUPPORTED_CHECK_TYPES.includes(checkType)) {
    throw new Error(
      `verifyViaCashfreeProvider: "${checkType}" is not supported by this path. ` +
      `Only PAN, GST, and BANK may be routed through Cashfree here — Aadhaar OTP, ` +
      `Face Match, and Liveness are explicitly excluded pending unresolved contract/product confirmation.`
    );
  }

  if (!isCashfreeDirectCapabilityEnabled(checkType, flags)) {
    throw new Error(
      `verifyViaCashfreeProvider: ${checkType} is proven in Sandbox but not yet enabled — ` +
      `flip CASHFREE_DIRECT_CAPABILITY_FLAGS.${checkType}.enabled to true only after separate authorization.`
    );
  }

  const providerFn = providerFunctions[checkType];
  if (typeof providerFn !== "function") {
    throw new Error(`verifyViaCashfreeProvider: no provider function registered for "${checkType}".`);
  }
  const result = await providerFn(payload);

  const shapeCheck = isValidProviderResult(result);
  if (!shapeCheck.valid) {
    throw new Error(`verifyViaCashfreeProvider: provider result failed contract check: ${shapeCheck.errors.join("; ")}`);
  }

  const piiCheck = isDataFreeOfObviousPII(result.data);
  if (!piiCheck.valid) {
    throw new Error(`verifyViaCashfreeProvider: provider result failed PII check: ${piiCheck.errors.join("; ")}`);
  }

  return result;
};

/**
 * Hard guard (constraint: verification must stay separate from
 * business approval, and automated approval must never be extended to
 * any role beyond the one it already applies to). Throws for every
 * role except FIELD_AGENT. This function performs no approval itself
 * — it only gates whether a FUTURE caller would even be allowed to
 * attempt one. The real, only auto-approval mechanism in production
 * remains fieldAgentKyc.service.js's attemptFieldAgentAutoApproval,
 * untouched and not called from here.
 *
 * @param {string} applicantType - one of APPLICANT_TYPE's values
 * @throws if applicantType !== APPLICANT_TYPE.FIELD_AGENT, or is unknown
 */
export const assertAutoApprovalAllowed = (applicantType) => {
  const config = getRoleConfig(applicantType); // throws on unknown role
  if (!config.autoApprovalEligible) {
    throw new Error(
      `assertAutoApprovalAllowed: auto-approval is not permitted for applicantType "${applicantType}". ` +
      `Only FIELD_AGENT has an approved auto-approval mechanism.`
    );
  }
};
