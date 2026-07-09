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
import { encrypt } from "./encryption.service.js";
import { maskAadhaar, maskAccount, maskPAN } from "./masking.service.js";

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
 */
export const verifyPAN = async ({ kyc, panNumber, nameOnPAN, adminId, adminLevel, requestId }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Choose provider
    const useAPI   = !!process.env.SUREPASS_TOKEN;
    const result   = useAPI
      ? await verifyPANSurepass({ panNumber })
      : await verifyPANManual({ panNumber, name: nameOnPAN });

    // Encrypt + mask — never store plaintext PAN (identity.pan.number stays null)
    const encryptedPAN = encrypt(panNumber);
    const maskedPAN    = maskPAN(panNumber);

    // Update KYC
    kyc.identity.pan.encryptedNumber   = encryptedPAN;
    kyc.identity.pan.maskedNumber      = maskedPAN;

    kyc.verification.pan.status            = result.status;
    kyc.verification.pan.verified          = result.success;
    kyc.verification.pan.verifiedAt        = result.success ? new Date() : null;
    kyc.verification.pan.verifiedBy        = adminId;
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
      triggeredBy:     adminId,
      triggeredByRole: adminLevel,
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
 */
export const verifyBank = async ({ kyc, accountNumber, ifsc, bankName, accountHolder, adminId, adminLevel, requestId }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const result = await verifyBankManual({ accountNumber, ifsc, bankName, accountHolder });

    kyc.bank.accountHolder    = accountHolder;
    kyc.bank.encryptedAccount = encrypt(accountNumber);
    kyc.bank.maskedAccount    = maskAccount(accountNumber);
    kyc.bank.ifsc             = ifsc;
    kyc.bank.bankName         = bankName;

    kyc.verification.bank.status            = result.status;
    kyc.verification.bank.verified          = result.success;
    kyc.verification.bank.verifiedAt        = result.success ? new Date() : null;
    kyc.verification.bank.verifiedBy        = adminId;
    kyc.verification.bank.verificationSource = result.source;
    kyc.verification.bank.remarks           = result.remarks;

    if (result.success) {
      kyc.bank.pennyDropStatus = "SUCCESS";
    }

    kyc.verificationLevel = calcLevel(kyc.verification);
    kyc.status            = calcKYCStatus(kyc.verificationLevel, kyc.status);

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: result.success ? VERIFICATION_ACTION.BANK_VERIFIED : VERIFICATION_ACTION.DOCUMENT_REJECTED,
      source: result.source,
      triggeredBy: adminId, triggeredByRole: adminLevel,
      field: "bank", newValue: maskAccount(accountNumber),
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