/**
 * BARBER ENGINE V1
 * backend/modules/kyc/services/verification.service.js
 * Verification Engine — Phase 6B
 * Controller never talks directly to providers — only this service does
 */

import mongoose from "mongoose";
import {
    KYC_STATUS,
    VERIFICATION_ACTION
} from "../constants/kyc.constants.js";
import VerificationLog from "../models/VerificationLog.js";
import { verifyAadhaarManual, verifyBankManual, verifyPANManual } from "../providers/manual.provider.js";
import { verifyPANSurepass } from "../providers/surepass.provider.js";
import {
    initiateAadhaarOTPCashfree,
    verifyAadhaarOTPCashfree,
    verifyBankCashfree,
    verifyFaceMatchCashfree,
    verifyGSTCashfree,
    verifyLivenessCashfree,
    verifyPANCashfree,
} from "../providers/cashfree.provider.js";
import { encrypt } from "./encryption.service.js";
import { maskAadhaar, maskAccount, maskGST, maskPAN } from "./masking.service.js";

// Cashfree is configured only when both credentials are present — same
// "presence of env var decides provider" convention already used for
// Surepass (`!!process.env.SUREPASS_TOKEN`).
const cashfreeConfigured = () => !!(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);

// ─── Log Helper ───────────────────────────────────────────
const log = async (session, payload) => {
  await VerificationLog.create([payload], { session });
};

// ─── Level Calculator ─────────────────────────────────────
const calcLevel = (verification = {}) => {
  const checks = [
    verification.phone?.verified,
    verification.email?.verified,
    verification.pan?.verified,
    verification.aadhaar?.verified,
    verification.bank?.verified,
    verification.ocr?.verified,
    verification.face?.verified,
    verification.manualReview?.verified,
  ];
  return checks.filter(Boolean).length;
};

// ─── KYC Status from level ───────────────────────────────
const calcKYCStatus = (level, currentStatus) => {
  if (currentStatus === KYC_STATUS.VERIFIED)  return KYC_STATUS.VERIFIED;
  if (currentStatus === KYC_STATUS.REJECTED)  return KYC_STATUS.REJECTED;
  if (level === 0) return KYC_STATUS.DRAFT;
  if (level <= 2)  return KYC_STATUS.PARTIALLY_VERIFIED;
  if (level <= 6)  return KYC_STATUS.PARTIALLY_VERIFIED;
  return KYC_STATUS.UNDER_REVIEW;
};

/**
 * ─── VERIFY PAN ──────────────────────────────────────────
 * Uses Surepass if token available, else manual
 *
 * FA-3.2 — added optional actorId/actorRole/actorIsAdmin, all
 * defaulting to the existing adminId/adminLevel/true so every existing
 * (admin) caller is completely unaffected and produces byte-identical
 * verifiedBy/triggeredBy/triggeredByRole output. A non-admin caller
 * (Field Agent self-serve verification) passes actorIsAdmin:false so
 * this KYC record's verifiedBy is NOT falsely credited to a non-admin
 * actor — the true source of truth for "how was this verified" remains
 * verification.pan.verificationSource (SUREPASS/MANUAL), untouched by
 * any of these actor-attribution parameters. Provider selection
 * (useAPI below) and the resulting success/source/status are entirely
 * unaffected by who the actor is.
 */
export const verifyPAN = async ({
  kyc, panNumber, nameOnPAN, requestId,
  adminId, adminLevel,
  actorId = adminId,
  actorRole = adminLevel,
  actorIsAdmin = true,
}) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Choose provider — Cashfree → Surepass → Manual (Phase 7A).
    // Selection is by CONFIGURATION presence, exactly like the existing
    // `useAPI` check below — never a "retry with a weaker provider on
    // failure" chain, so a genuine Cashfree rejection (bad PAN) is
    // final, not silently re-attempted against Manual. This preserves
    // the pre-existing Surepass/Manual either-or semantics exactly;
    // Cashfree is simply inserted ahead of it as a third, higher-
    // priority configuration state.
    let result;
    if (cashfreeConfigured()) {
      result = await verifyPANCashfree({ panNumber, nameOnPAN });
    } else {
      const useAPI = !!process.env.SUREPASS_TOKEN;
      result = useAPI
        ? await verifyPANSurepass({ panNumber })
        : await verifyPANManual({ panNumber, name: nameOnPAN });
    }

    // Encrypt + mask — never store plaintext PAN (identity.pan.number stays null)
    const encryptedPAN = encrypt(panNumber);
    const maskedPAN    = maskPAN(panNumber);

    // Update KYC
    kyc.identity.pan.encryptedNumber   = encryptedPAN;
    kyc.identity.pan.maskedNumber      = maskedPAN;

    kyc.verification.pan.status            = result.status;
    kyc.verification.pan.verified          = result.success;
    kyc.verification.pan.verifiedAt        = result.success ? new Date() : null;
    kyc.verification.pan.verifiedBy        = actorIsAdmin ? actorId : null;
    kyc.verification.pan.verificationSource = result.source;
    kyc.verification.pan.remarks           = result.remarks;

    // Update level + status
    kyc.verificationLevel = calcLevel(kyc.verification);
    kyc.status            = calcKYCStatus(kyc.verificationLevel, kyc.status);
    if (kyc.status !== KYC_STATUS.DRAFT) kyc.submittedAt = kyc.submittedAt || new Date();

    await kyc.save({ session });

    await log(session, {
      kycId:           kyc._id,
      ownerId:         kyc.ownerId,
      action:          result.success ? VERIFICATION_ACTION.PAN_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source:          result.source,
      triggeredBy:     actorId,
      triggeredByRole: actorRole,
      field:           "pan",
      newValue:        maskedPAN,
      success:         result.success,
      errorMsg:        result.success ? null : result.remarks,
      providerRef:     result.providerRef ?? null,
      requestId,
      remarks:         result.remarks,
      riskScoreAfter:  kyc.risk?.score ?? 0,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── VERIFY AADHAAR ──────────────────────────────────────
 */
export const verifyAadhaar = async ({ kyc, last4, adminId, adminLevel, requestId }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result     = await verifyAadhaarManual({ last4 });
    // We only collect last 4 digits — full Aadhaar never stored (privacy by design)
    // Phase 6C (DigiLocker) will provide encrypted full Aadhaar via consent flow
    const maskedAadh = maskAadhaar('XXXXXXXX' + last4);
    // Phase 6B — only last4 collected, full Aadhaar not available
    // encryptedNumber stays null — will be populated in Phase 6C (DigiLocker/UIDAI consent)
    // Encrypting masked value would be semantically incorrect

    kyc.identity.aadhaar.maskedNumber    = maskedAadh;
    kyc.identity.aadhaar.encryptedNumber = null; // Phase 6C will set this
    kyc.verification.aadhaar.status          = result.status;
    kyc.verification.aadhaar.verified        = result.success;
    kyc.verification.aadhaar.verifiedAt      = result.success ? new Date() : null;
    kyc.verification.aadhaar.verifiedBy      = adminId;
    kyc.verification.aadhaar.verificationSource = result.source;
    kyc.verification.aadhaar.remarks         = result.remarks;

    kyc.verificationLevel = calcLevel(kyc.verification);
    kyc.status            = calcKYCStatus(kyc.verificationLevel, kyc.status);

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.AADHAAR_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: adminId, triggeredByRole: adminLevel,
      field: "aadhaar", newValue: maskedAadh,
      success: result.success, requestId, remarks: result.remarks,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── VERIFY BANK ─────────────────────────────────────────
 * Phase 7A — added Cashfree ahead of Manual (no Surepass bank product
 * exists in this codebase, so the priority here is Cashfree → Manual,
 * not a 3-way chain — nothing to preserve beyond Manual, which is left
 * completely unmodified for the case Cashfree isn't configured).
 * Also added the same optional actorId/actorRole/actorIsAdmin triple
 * verifyPAN already uses, so a Field Agent self-serve call attributes
 * correctly without touching admin's existing call sites (all of which
 * omit these and get byte-identical adminId/adminLevel-based behavior).
 */
export const verifyBank = async ({
  kyc, accountNumber, ifsc, bankName, accountHolder, requestId,
  adminId, adminLevel,
  actorId = adminId,
  actorRole = adminLevel,
  actorIsAdmin = true,
}) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result = cashfreeConfigured()
      ? await verifyBankCashfree({ accountNumber, ifsc, accountHolder })
      : await verifyBankManual({ accountNumber, ifsc, bankName, accountHolder });

    kyc.bank.accountHolder    = accountHolder;
    kyc.bank.encryptedAccount = encrypt(accountNumber);
    kyc.bank.maskedAccount    = maskAccount(accountNumber);
    kyc.bank.ifsc             = ifsc;
    kyc.bank.bankName         = bankName;

    kyc.verification.bank.status            = result.status;
    kyc.verification.bank.verified          = result.success;
    kyc.verification.bank.verifiedAt        = result.success ? new Date() : null;
    kyc.verification.bank.verifiedBy        = actorIsAdmin ? actorId : null;
    kyc.verification.bank.verificationSource = result.source;
    kyc.verification.bank.remarks           = result.remarks;

    kyc.bank.pennyDropStatus = result.success ? "SUCCESS" : "FAILED";
    kyc.bank.pennyDropRef    = result.providerRef ?? kyc.bank.pennyDropRef;

    kyc.verificationLevel = calcLevel(kyc.verification);
    kyc.status            = calcKYCStatus(kyc.verificationLevel, kyc.status);

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.BANK_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: actorId, triggeredByRole: actorRole,
      field: "bank", newValue: maskAccount(accountNumber),
      success: result.success, requestId, remarks: result.remarks,
      providerRef: result.providerRef ?? null,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── AADHAAR OTP (2-step, Cashfree only) — Phase 7A ────────────────
 * Deliberately SEPARATE from verifyAadhaar() above (the existing
 * admin-only manual last-4-digit check, which stays completely
 * untouched and remains the admin's own emergency manual-override
 * tool). An OTP exchange needs a fundamentally different call shape
 * (full Aadhaar number + a pending ref/OTP round-trip) that cannot be
 * retrofitted onto verifyAadhaar()'s {last4} signature without risking
 * that existing admin path. No Surepass equivalent exists in this
 * codebase for Aadhaar, so there is no fallback chain here — only
 * Cashfree, or a clear "not available" result that leaves the
 * applicant free to fall back to the existing manual-admin-review path
 * (same non-blocking philosophy as every other verification step).
 *
 * Phase 2B — the pending session (Cashfree's own refId/verificationId,
 * plus a small lifecycle status) now lives on the KYC document itself,
 * under kyc.aadhaar.* (see KYC.js's own header for why: a LATER,
 * separate self-serve call — Face Match/Liveness — needs to read
 * verificationId, and this document is already loaded by every one of
 * those calls, unlike a Redis key scoped to this one flow). This
 * replaces the previous Redis-based session store; no business rule
 * changed — a caller still cannot verify without first initiating, and
 * a session is still single-use (sessionStatus leaves "OTP_SENT"
 * permanently on the first verify attempt, success or failure).
 */
export const initiateAadhaarOTP = async ({ kyc, aadhaarNumber, requestId, actorId, actorRole }) => {
  const result = await initiateAadhaarOTPCashfree({ aadhaarNumber });

  if (result.success) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Masked/encrypted value stored now (at generate time, since this
      // is when the raw number is available) — same "store what the
      // applicant entered, independent of eventual verification outcome"
      // precedent verifyPAN() already established for identity.pan.
      const maskedAadh = maskAadhaar(aadhaarNumber);
      kyc.identity.aadhaar.maskedNumber    = maskedAadh;
      kyc.identity.aadhaar.encryptedNumber = encrypt(aadhaarNumber);

      kyc.aadhaar.refId          = result.data?.refId ?? result.providerRef ?? null;
      kyc.aadhaar.verificationId = result.data?.verificationId ?? kyc.aadhaar.refId;
      kyc.aadhaar.sessionStatus  = "OTP_SENT";
      kyc.aadhaar.otpGeneratedAt = new Date();

      await kyc.save({ session });
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // Initiation is deliberately NOT logged to VerificationLog — unchanged
  // from before (no KYC verification-outcome state changes yet; only
  // the eventual verify outcome below is audit-worthy).
  return { success: result.success, result };
};

export const verifyAadhaarOTP = async ({ kyc, refId, otp, requestId, actorId, actorRole, actorIsAdmin = false }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result = await verifyAadhaarOTPCashfree({ refId, otp });

    kyc.verification.aadhaar.status             = result.status;
    kyc.verification.aadhaar.verified           = result.success;
    kyc.verification.aadhaar.verifiedAt         = result.success ? new Date() : null;
    kyc.verification.aadhaar.verifiedBy         = actorIsAdmin ? actorId : null;
    kyc.verification.aadhaar.verificationSource = result.source;
    kyc.verification.aadhaar.remarks            = result.remarks;

    // Session finalized either way — single-use, matches the previous
    // Redis-delete-after-one-attempt behavior exactly.
    kyc.aadhaar.sessionStatus = result.success ? "VERIFIED" : "FAILED";

    kyc.verificationLevel = calcLevel(kyc.verification);
    kyc.status            = calcKYCStatus(kyc.verificationLevel, kyc.status);

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.AADHAAR_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: actorId, triggeredByRole: actorRole,
      field: "aadhaar", newValue: kyc.identity.aadhaar.maskedNumber,
      success: result.success, requestId, remarks: result.remarks,
      providerRef: result.providerRef ?? null,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── FACE MATCH — Phase 7A (Cashfree only, new capability) ─────────
 * Phase 2C — confirmed via live audit that Cashfree's real /face-match
 * requires the verification_id from the existing Aadhaar OTP session
 * (kyc.aadhaar.verificationId, Phase 2B), not two arbitrary image URLs.
 * The precondition check (verificationId present) lives in the caller
 * (fieldAgentKyc.service.js::verifyFieldAgentFaceMatch) — this function
 * assumes it has already been validated, matching the existing
 * convention where ownership/editability guards live in that wrapper,
 * not here.
 */
export const verifyFaceMatch = async ({ kyc, selfieUrl, requestId, actorId, actorRole, actorIsAdmin = false }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result = await verifyFaceMatchCashfree({ verificationId: kyc.aadhaar.verificationId, selfieUrl });

    kyc.verification.face.status             = result.status;
    kyc.verification.face.verified           = result.success;
    kyc.verification.face.verifiedAt         = result.success ? new Date() : null;
    kyc.verification.face.verifiedBy         = actorIsAdmin ? actorId : null;
    kyc.verification.face.verificationSource = result.source;
    kyc.verification.face.remarks            = result.remarks;

    kyc.verificationLevel = calcLevel(kyc.verification);
    kyc.status            = calcKYCStatus(kyc.verificationLevel, kyc.status);

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.FACE_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: actorId, triggeredByRole: actorRole,
      field: "face", newValue: null,
      success: result.success, requestId, remarks: result.remarks,
      providerRef: result.providerRef ?? null,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── LIVENESS — Phase 7A (Cashfree only, new capability) ───────────
 * Phase 2D — confirmed via live audit that Cashfree's real
 * /face-liveness requires the verification_id from the existing
 * Aadhaar OTP session (kyc.aadhaar.verificationId, Phase 2B), same as
 * Face Match. The precondition check (verificationId present) lives in
 * the caller (fieldAgentKyc.service.js::verifyFieldAgentLiveness) —
 * this function assumes it has already been validated.
 */
export const verifyLiveness = async ({ kyc, selfieUrl, requestId, actorId, actorRole, actorIsAdmin = false }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result = await verifyLivenessCashfree({ verificationId: kyc.aadhaar.verificationId, selfieUrl });

    kyc.verification.liveness.status             = result.status;
    kyc.verification.liveness.verified           = result.success;
    kyc.verification.liveness.verifiedAt         = result.success ? new Date() : null;
    kyc.verification.liveness.verifiedBy         = actorIsAdmin ? actorId : null;
    kyc.verification.liveness.verificationSource = result.source;
    kyc.verification.liveness.remarks            = result.remarks;

    // Deliberately NOT fed into calcLevel()/calcKYCStatus() — that
    // shared function also serves the Owner flow, which has no
    // liveness concept. Field Agent's own mandatory checklist
    // (fieldAgentKyc.service.js) reads kyc.verification.liveness.verified
    // directly instead.
    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.LIVENESS_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: actorId, triggeredByRole: actorRole,
      field: "liveness", newValue: null,
      success: result.success, requestId, remarks: result.remarks,
      providerRef: result.providerRef ?? null,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── GST (optional) — Phase 7A (Cashfree only, new capability) ─────
 * Never touches verificationLevel/status — GST is explicitly optional
 * and must never gate progression for any applicant type.
 *
 * Audit fix — no `verification.gst` sub-document exists on KYC.js (see
 * that file's own header for why: GST never gates anything, so its
 * outcome doesn't need a fast in-memory-checkable stored field — it is
 * read back from this call's own VerificationLog row instead, on
 * demand, by fieldAgentKyc.controller.js's DTO). Only the pre-existing
 * identity.gst.{maskedNumber,encryptedNumber} value fields are written
 * here now; the VerificationLog entry below is the sole record of
 * whether this specific attempt succeeded.
 */
export const verifyGST = async ({ kyc, gstNumber, requestId, actorId, actorRole }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result = await verifyGSTCashfree({ gstNumber });
    const maskedGST = maskGST(gstNumber);

    kyc.identity.gst.maskedNumber    = maskedGST;
    kyc.identity.gst.encryptedNumber = encrypt(gstNumber);

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.GST_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: actorId, triggeredByRole: actorRole,
      field: "gst", newValue: maskedGST,
      success: result.success, requestId, remarks: result.remarks,
      providerRef: result.providerRef ?? null,
    });

    await session.commitTransaction();
    return { success: result.success, result, kyc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};