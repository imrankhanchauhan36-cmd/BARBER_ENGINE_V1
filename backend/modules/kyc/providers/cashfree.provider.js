/**
 * BARBER ENGINE V1
 * backend/modules/kyc/providers/cashfree.provider.js
 * Cashfree Secure ID Provider — Phase 7A (Stub — activate with API keys)
 * Docs: https://www.cashfree.com/docs/verification-suite
 *
 * Same shape/contract as providers/surepass.provider.js — every method
 * returns { success, source, status, remarks, providerRef, data }.
 * No Mongo access, no business logic — verification.service.js remains
 * the only orchestration layer (it decides provider priority, updates
 * KYC/VerificationLog, computes verificationLevel/status).
 *
 * ⚠ ENDPOINT PATHS below reflect Cashfree's documented Verification
 * Suite REST shape at the time this was written. Exactly like
 * surepass.provider.js's own header already flags for Surepass —
 * confirm these against the live Cashfree dashboard/docs for the
 * merchant's actual provisioned product set before enabling in
 * production. Until CASHFREE_CLIENT_ID/CASHFREE_CLIENT_SECRET are set,
 * every method below returns success:false so verification.service.js
 * falls through to the next configured provider — same "not configured
 * → fall through" behavior Surepass already has.
 */

import { VERIFICATION_SOURCE, VERIFICATION_STATUS } from "../constants/kyc.constants.js";

const CASHFREE_BASE = process.env.CASHFREE_ENV === "PRODUCTION"
  ? "https://api.cashfree.com/verification"
  : "https://sandbox.cashfree.com/verification";

const TIMEOUT_MS = 20_000;

const getCredentials = () => ({
  clientId:     process.env.CASHFREE_CLIENT_ID,
  clientSecret: process.env.CASHFREE_CLIENT_SECRET,
});

const notConfigured = (method) => ({
  success:     false,
  source:      VERIFICATION_SOURCE.CASHFREE,
  status:      VERIFICATION_STATUS.FAILED,
  remarks:     `Cashfree ${method} not configured — use next provider`,
  providerRef: null,
  data:        null,
});

const failed = (remarks, providerRef = null) => ({
  success: false,
  source:  VERIFICATION_SOURCE.CASHFREE,
  status:  VERIFICATION_STATUS.FAILED,
  remarks,
  providerRef,
  data: null,
});

/**
 * ─── extractProviderRef ───────────────────────────────────────────
 * Phase 2A audit fix. Cashfree does not use one consistent field for
 * its reference/tracking id — confirmed live across real Sandbox
 * responses during the Phase 1 audit:
 *   Shape A: { reference_id: "123" }             (e.g. PAN, Bank, GST)
 *   Shape B: { ref_id: "123" }                    (Aadhaar OTP)
 *   Shape C: { error: { refId / reference_id / ref_id: "123" } }
 * Every verifyXCashfree() below now reads the response through this
 * one helper instead of each hand-rolling its own `json.reference_id
 * ?? null` (which only ever matched Shape A and silently dropped the
 * ref id whenever Cashfree nested it under `error.*`, as it does for
 * several failure responses).
 */
const extractProviderRef = (response = {}) =>
  response?.reference_id
  ?? response?.ref_id
  ?? response?.error?.reference_id
  ?? response?.error?.refId
  ?? response?.error?.ref_id
  ?? null;

// ─── Shared HTTP call — auth headers + timeout only, no interpretation
// of the response body (each method interprets its own shape) ────────
// `extraHeaders` is additive/optional (default {}) — every existing
// caller that doesn't pass it is completely unaffected. Added for
// Phase 2D: Cashfree's /face-liveness endpoint requires an
// `x-api-version` header no other endpoint used so far has needed.
const callCashfree = async (path, body, extraHeaders = {}) => {
  const { clientId, clientSecret } = getCredentials();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${CASHFREE_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "x-client-id":      clientId,
        "x-client-secret":  clientSecret,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    clearTimeout(timeout);
    return { ok: res.ok, json };
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === "AbortError";
    const e = new Error(isTimeout ? "Cashfree API timeout (20s)" : `Cashfree API error: ${err.message}`);
    e.isTimeout = isTimeout;
    throw e;
  }
};

/**
 * ─── PAN ──────────────────────────────────────────────────
 */
export const verifyPANCashfree = async ({ panNumber, nameOnPAN }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("PAN verification");

  try {
    const { ok, json } = await callCashfree("/pan", { pan: panNumber, name: nameOnPAN || undefined });

    if (!ok || json.valid !== true) {
      return failed(json.message || "PAN verification failed", extractProviderRef(json));
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "PAN verified via Cashfree Secure ID",
      providerRef: extractProviderRef(json),
      data: {
        panNumber,
        nameOnPAN:  json.registered_name ?? nameOnPAN ?? null,
        panType:    json.pan_type ?? null,
        verifiedAt: new Date(),
      },
    };
  } catch (err) {
    return failed(err.message);
  }
};

/**
 * ─── AADHAAR (2-step OTP) ─────────────────────────────────
 */
export const initiateAadhaarOTPCashfree = async ({ aadhaarNumber }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("Aadhaar OTP initiation");

  try {
    const { ok, json } = await callCashfree("/offline-aadhaar/otp", { aadhaar_number: aadhaarNumber });
    const providerRef = extractProviderRef(json);

    if (!ok || !json.ref_id) {
      return failed(json.message || "Failed to send Aadhaar OTP", providerRef);
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.PENDING,
      remarks: "Aadhaar OTP sent",
      providerRef,
      // ⚠ verification_id field name UNCONFIRMED — no successful
      // /offline-aadhaar/otp response has been observed live yet (the
      // Phase 1 audit only reached this endpoint's FAILURE path with
      // synthetic Aadhaar numbers). Read defensively under a few
      // plausible names; fall back to reusing this OTP's own ref_id as
      // the session id so downstream code (Face Match/Liveness) always
      // has *something* non-null to key off of. Confirm the real field
      // name against a genuine successful response before trusting this.
      data: {
        refId: json.ref_id,
        verificationId: json.verification_id ?? json.verificationId ?? json.ref_id,
      },
    };
  } catch (err) {
    return failed(err.message);
  }
};

export const verifyAadhaarOTPCashfree = async ({ refId, otp }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("Aadhaar OTP verification");

  try {
    const { ok, json } = await callCashfree("/offline-aadhaar/verify", { ref_id: refId, otp });
    // Prefer the response's own reference id when Cashfree returns one;
    // fall back to the client-tracked refId (our own pending-session
    // identifier) when it doesn't — preserves prior behavior for this
    // specific call exactly when the response carries no ref of its own.
    const providerRef = extractProviderRef(json) ?? refId;

    if (!ok || json.valid !== true) {
      return failed(json.message || "Aadhaar OTP verification failed", providerRef);
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "Aadhaar verified via Cashfree Secure ID",
      providerRef,
      data: {
        nameOnAadhaar: json.name ?? null,
        dob:           json.dob ?? null,
        gender:        json.gender ?? null,
        verifiedAt:    new Date(),
      },
    };
  } catch (err) {
    return failed(err.message, refId);
  }
};

/**
 * ─── BANK ─────────────────────────────────────────────────
 */
export const verifyBankCashfree = async ({ accountNumber, ifsc, accountHolder }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("Bank verification");

  try {
    const { ok, json } = await callCashfree("/bank-account/sync", {
      bank_account: accountNumber,
      ifsc,
      name:         accountHolder,
    });

    if (!ok || json.account_status !== "VALID") {
      return failed(json.message || "Bank account verification failed", extractProviderRef(json));
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "Bank account verified via Cashfree Secure ID",
      providerRef: extractProviderRef(json),
      data: {
        accountHolder,
        nameAtBank:   json.name_at_bank ?? null,
        nameMatchScore: json.name_match_score ?? null,
        verifiedAt:   new Date(),
      },
    };
  } catch (err) {
    return failed(err.message);
  }
};

/**
 * ─── FACE MATCH ───────────────────────────────────────────
 * Phase 2C — rewritten per the live audit's confirmed root cause:
 * Cashfree's real /face-match rejects a raw two-image request with
 * "verification_id is missing in the request" — it requires the
 * verification_id from the EXISTING Aadhaar OTP session (this
 * function does not create or manage that session; the caller resolves
 * it from kyc.aadhaar.verificationId and passes it in). The selfie is
 * still sent — compared against whatever Cashfree already has on file
 * for that session (the Aadhaar photo), not against a second
 * caller-supplied reference image.
 *
 * ⚠ The image field name below (`image`) is UNCONFIRMED — no successful
 * response has been observed live yet for this verification_id-based
 * shape. Mirrors the single-image field name Liveness already uses on
 * this same product as the closest known sibling call; confirm against
 * a real successful response before relying on it.
 */
export const verifyFaceMatchCashfree = async ({ verificationId, selfieUrl }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("Face match");

  try {
    const { ok, json } = await callCashfree("/face-match", {
      verification_id: verificationId,
      image: selfieUrl,
    });

    const matchScore = json.match_score ?? null;
    if (!ok || json.status !== "VALID") {
      return failed(json.message || "Face match failed", extractProviderRef(json));
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "Face match passed via Cashfree Secure ID",
      providerRef: extractProviderRef(json),
      data: { matchScore, verifiedAt: new Date() },
    };
  } catch (err) {
    return failed(err.message);
  }
};

/**
 * ─── LIVENESS ─────────────────────────────────────────────
 * Phase 2D — rewritten per the live audit's confirmed root cause: two
 * separate problems, both now fixed. (1) Cashfree rejected every call
 * with "x-api-version is missing in the header" — Cashfree's own error
 * response named the required value, `2024-12-01`, confirmed live, now
 * sent on every call. (2) Same as Face Match: rejected with
 * "verification_id is missing in the request" — requires the
 * verification_id from the EXISTING Aadhaar OTP session (this function
 * does not create or manage that session; the caller resolves it from
 * kyc.aadhaar.verificationId and passes it in).
 *
 * ⚠ The image field name below (`image`) is UNCONFIRMED — no successful
 * response has been observed live yet for this verification_id-based
 * shape (the audit only reached the header/verification_id error
 * responses). Confirm against a real successful response before
 * relying on it.
 */
const CASHFREE_API_VERSION = "2024-12-01";

export const verifyLivenessCashfree = async ({ verificationId, selfieUrl }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("Liveness check");

  try {
    const { ok, json } = await callCashfree(
      "/face-liveness",
      { verification_id: verificationId, image: selfieUrl },
      { "x-api-version": CASHFREE_API_VERSION }
    );

    if (!ok || json.is_live !== true) {
      return failed(json.message || "Liveness check failed", extractProviderRef(json));
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "Liveness confirmed via Cashfree Secure ID",
      providerRef: extractProviderRef(json),
      data: { livenessScore: json.liveness_score ?? null, verifiedAt: new Date() },
    };
  } catch (err) {
    return failed(err.message);
  }
};

/**
 * ─── GST (optional) ───────────────────────────────────────
 */
export const verifyGSTCashfree = async ({ gstNumber }) => {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) return notConfigured("GST verification");

  try {
    const { ok, json } = await callCashfree("/gstin", { GSTIN: gstNumber });

    if (!ok || json.valid !== true) {
      return failed(json.message || "GST verification failed", extractProviderRef(json));
    }

    return {
      success: true,
      source:  VERIFICATION_SOURCE.CASHFREE,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "GST verified via Cashfree Secure ID",
      providerRef: extractProviderRef(json),
      data: {
        gstNumber,
        legalName:  json.legal_name ?? null,
        tradeName:  json.trade_name ?? null,
        gstStatus:  json.gst_in_status ?? null,
        verifiedAt: new Date(),
      },
    };
  } catch (err) {
    return failed(err.message);
  }
};
