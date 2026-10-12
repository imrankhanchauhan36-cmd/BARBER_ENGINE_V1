/**
 * BARBER ENGINE V1
 * backend/modules/kyc/engine/providerAdapter.contract.js
 * Global Verification Engine — Phase 1 (approved, additive, provider-independent)
 *
 * PURPOSE: formalizes, in one place, the return-value contract already
 * implicit and consistently followed by every existing KYC provider
 * file:
 *   - modules/kyc/providers/manual.provider.js
 *   - modules/kyc/providers/surepass.provider.js
 *   - modules/kyc/providers/cashfree.provider.js
 *
 * This file does NOT call any provider, does NOT touch the network,
 * and does NOT change the behavior of any existing provider function.
 * It documents a shape that already exists in those three files' own
 * `return { success, source, status, remarks, providerRef, data }`
 * statements, and offers a pure, side-effect-free validator
 * (isValidProviderResult) that future code — including the orchestrator
 * in verificationOrchestrator.service.js — can use to assert that
 * shape, in tests or at call sites, without re-deriving it by hand.
 *
 * Nothing in modules/kyc/providers/*.js, modules/kyc/services/*.js, or
 * modules/kyc/constants/kyc.constants.js is imported, modified, or
 * executed by this file beyond the two read-only enum imports below
 * (used only to validate `source`/`status` against the real, live
 * enums — never a redefinition of them).
 */

import { VERIFICATION_SOURCE, VERIFICATION_STATUS } from "../constants/kyc.constants.js";

/**
 * @typedef {Object} ProviderResult
 * @property {boolean} success
 *   Whether this specific provider call verified the submitted value.
 *   `false` does NOT necessarily mean "invalid" — it also covers
 *   "provider not configured" (see manual.provider.js's non-existence
 *   of this case vs. cashfree.provider.js/surepass.provider.js's
 *   `notConfigured()`/early-return pattern) and genuine provider
 *   failures. Callers must read `status`/`remarks` to distinguish.
 * @property {string} source
 *   One of VERIFICATION_SOURCE's values (e.g. "MANUAL", "SUREPASS",
 *   "CASHFREE"). Identifies which provider produced this result —
 *   this is the field VerificationLog.source is populated from.
 * @property {string} status
 *   One of VERIFICATION_STATUS's values (e.g. "VERIFIED", "FAILED").
 *   Distinct from `success` — kept as its own field because the
 *   existing KYC model stores status independently (see
 *   verification.<field>.status in KYC.js) and because a future
 *   provider could introduce an intermediate state (e.g. "PENDING")
 *   that `success: boolean` alone cannot represent.
 * @property {string|null} remarks
 *   Human-readable explanation, always present (never undefined) —
 *   every existing provider function populates this on both success
 *   and failure paths.
 * @property {string|null} [providerRef]
 *   The provider's own tracking/reference id, when the provider
 *   returned one. OPTIONAL in the contract because manual.provider.js
 *   never sets it (there is no external provider call to reference) —
 *   callers must treat a missing providerRef as "no external
 *   reference, not an error."
 * @property {Object|null} data
 *   Provider-specific payload. MUST NEVER contain a raw/plaintext PAN,
 *   Aadhaar, bank account number, or any other sensitive PII value —
 *   every existing provider function already honors this (only
 *   masked/derived fields like `panType`, `nameOnPAN`, `verifiedAt`
 *   ever appear here). This contract makes that rule explicit so any
 *   future provider adapter is held to the same bar.
 */

// ─── Known values, read live from the existing enums — never
// hardcoded here, so this file cannot silently drift from
// kyc.constants.js if a value is ever added/renamed there. ──────────
const KNOWN_SOURCES = new Set(Object.values(VERIFICATION_SOURCE));
const KNOWN_STATUSES = new Set(Object.values(VERIFICATION_STATUS));

/**
 * Pure, side-effect-free shape check. Does not call anything, does
 * not throw — returns a result object so callers (and tests) can
 * inspect exactly which part of the contract failed, rather than
 * catching an exception.
 *
 * @param {*} result - a value returned by any existing provider function
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const isValidProviderResult = (result) => {
  const errors = [];

  if (result === null || typeof result !== "object") {
    return { valid: false, errors: ["result must be a non-null object"] };
  }

  if (typeof result.success !== "boolean") {
    errors.push("success must be a boolean");
  }
  if (typeof result.source !== "string" || !KNOWN_SOURCES.has(result.source)) {
    errors.push(`source must be one of VERIFICATION_SOURCE (got: ${JSON.stringify(result.source)})`);
  }
  if (typeof result.status !== "string" || !KNOWN_STATUSES.has(result.status)) {
    errors.push(`status must be one of VERIFICATION_STATUS (got: ${JSON.stringify(result.status)})`);
  }
  if (result.remarks !== null && typeof result.remarks !== "string") {
    errors.push("remarks must be a string or null");
  }
  if (
    result.providerRef !== undefined &&
    result.providerRef !== null &&
    typeof result.providerRef !== "string"
  ) {
    errors.push("providerRef, when present, must be a string or null");
  }
  if (result.data !== null && typeof result.data !== "object") {
    errors.push("data must be an object or null");
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Best-effort, non-exhaustive PII guard for `result.data`. Flags the
 * most obvious footguns (a field literally named like a raw PAN/
 * Aadhaar/account carrier) so a future provider adapter that
 * accidentally echoes a raw value back is caught by a test rather
 * than discovered in production. This is a heuristic safety net, not
 * a substitute for code review of a new provider file.
 *
 * @param {*} data - the `data` field of a ProviderResult
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const isDataFreeOfObviousPII = (data) => {
  if (data === null || typeof data !== "object") return { valid: true, errors: [] };

  const SUSPECT_KEYS = [
    "panNumberRaw", "aadhaarNumberRaw", "accountNumberRaw",
    "rawPan", "rawAadhaar", "rawAccountNumber",
    "plaintextPan", "plaintextAadhaar", "plaintextAccountNumber",
  ];
  const errors = Object.keys(data)
    .filter((key) => SUSPECT_KEYS.includes(key))
    .map((key) => `data.${key} looks like a raw/plaintext PII field — must be masked or removed`);

  return { valid: errors.length === 0, errors };
};
