/**
 * BARBER ENGINE V1
 * backend/modules/kyc/services/ownerKyc.service.js
 * Owner-Facing KYC Submission Service — Phase 6C
 *
 * Mirrors the transaction + audit-log pattern already used in
 * kyc.service.js (admin side). The controller never talks to the
 * KYC/KYCDocument/VerificationLog models directly — only this service
 * (and kyc.service.js's getOrCreateKYC) does, exactly like the admin
 * module's existing layering (Controller → Service → Model).
 */

import crypto from "crypto";
import mongoose from "mongoose";
import {
    KYC_STATUS,
    OWNER_DOCUMENT_KEY_MAP,
    REQUIRED_DOCUMENT_KEYS,
    VERIFICATION_ACTION,
} from "../constants/kyc.constants.js";
import KYCDocument from "../models/KYCDocument.js";
import VerificationLog from "../models/VerificationLog.js";
import { encrypt } from "./encryption.service.js";
import { maskAadhaar, maskAccount, maskGST, maskPAN } from "./masking.service.js";

// ─── Log Helper — same shape as kyc.service.js's internal log() ──
const log = async (session, { kycId, ownerId, action, triggeredBy, field, requestId, remarks, metadata }) => {
  await VerificationLog.create([{
    kycId, ownerId, action,
    triggeredBy:     triggeredBy ?? null,
    triggeredByRole: "OWNER",
    field:           field   ?? null,
    requestId:       requestId ?? null,
    remarks:         remarks  ?? null,
    metadata:        metadata ?? null,
    success: true,
  }], { session });
};

// ─── Editable Guard (Lock Rule from the approved Business Review) ──
// Owner can only edit identity/bank/documents while DRAFT or REJECTED.
// Everything from PENDING onward is read-only to the owner — matches
// the admin's existing review workflow exactly.
export const assertKYCEditable = (kyc) => {
  const EDITABLE = [KYC_STATUS.DRAFT, KYC_STATUS.REJECTED];
  if (!EDITABLE.includes(kyc.status)) {
    const err = new Error(`KYC cannot be edited while status is ${kyc.status}`);
    err.status = 400;
    throw err;
  }
};

/**
 * ─── SUBMIT IDENTITY (PAN / Aadhaar / GST) ──────────────────
 * Stores ONLY masked + AES-encrypted values — never plaintext,
 * matching the hard security rule from the approved plan.
 */
export const submitIdentity = async ({ kyc, panNumber, nameOnPAN, aadhaarNumber, gstNumber, requestId }) => {
  assertKYCEditable(kyc);

  // ✅ Optimization — skip the transaction entirely if nothing identity-
  // related was actually provided (e.g. owner sends only nameOnPAN with
  // no panNumber/aadhaarNumber/gstNumber). Avoids an unnecessary write +
  // audit log entry. Note: the controller-level validator already
  // requires at least one of pan/aadhaar/gst to be present, so this is
  // a defensive second check, not the primary guard.
  const changed = !!(panNumber?.trim() || aadhaarNumber?.trim() || gstNumber?.trim());
  if (!changed) return kyc;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    if (panNumber) {
      kyc.identity.pan.encryptedNumber = encrypt(panNumber);
      kyc.identity.pan.maskedNumber    = maskPAN(panNumber);
    }
    if (aadhaarNumber) {
      kyc.identity.aadhaar.encryptedNumber = encrypt(aadhaarNumber);
      kyc.identity.aadhaar.maskedNumber    = maskAadhaar(aadhaarNumber);
    }
    if (gstNumber) {
      // GST is not classified as sensitive PII the way PAN/Aadhaar are
      // (it's a public business registration number), but we still
      // encrypt+mask for consistency with the rest of the identity block.
      kyc.identity.gst.encryptedNumber = encrypt(gstNumber);
      kyc.identity.gst.maskedNumber    = maskGST(gstNumber);
    }

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.IDENTITY_SUBMITTED,
      triggeredBy: kyc.ownerId,
      requestId,
      remarks: "Owner submitted identity details",
      metadata: {
        panSubmitted:     !!panNumber,
        aadhaarSubmitted: !!aadhaarNumber,
        gstSubmitted:     !!gstNumber,
        // nameOnPAN isn't written onto the KYC record itself — it's
        // reserved for the admin-side PAN verification call (mirrors
        // adminKyc.controller.js's verifyPANHandler, which accepts the
        // same field and forwards it to the Surepass/manual provider
        // for name-match checking). Captured here in the audit trail so
        // it isn't silently dropped before that step runs.
        nameOnPAN: nameOnPAN || null,
      },
    });

    await session.commitTransaction();
    return kyc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── SUBMIT BANK DETAILS ─────────────────────────────────────
 */
export const submitBank = async ({ kyc, accountHolder, accountNumber, ifsc, bankName, requestId }) => {
  assertKYCEditable(kyc);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    kyc.bank.accountHolder    = accountHolder;
    kyc.bank.encryptedAccount = encrypt(accountNumber);
    kyc.bank.maskedAccount    = maskAccount(accountNumber);
    kyc.bank.ifsc             = ifsc;
    kyc.bank.bankName         = bankName;
    kyc.bank.pennyDropStatus  = "NOT_INITIATED"; // reset — admin/verification flow drives this later

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.BANK_SUBMITTED,
      triggeredBy: kyc.ownerId,
      requestId,
      remarks: "Owner submitted bank details",
      metadata: { maskedAccount: kyc.bank.maskedAccount },
    });

    await session.commitTransaction();
    return kyc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── ATTACH DOCUMENT (after Cloudinary upload) ───────────────
 * Always creates a NEW version — never overwrites. Matches the
 * versioning design already built into the KYCDocument model.
 *
 * `documentKey` is the camelCase key (e.g. "panCard") — mapped to the
 * DOCUMENT_TYPE enum via OWNER_DOCUMENT_KEY_MAP (single source of truth,
 * shared with admin's reupload validator).
 */
export const attachDocument = async ({ kyc, documentKey, cloudinaryUrl, mimeType, sizeBytes, fileBuffer, requestId }) => {
  assertKYCEditable(kyc);

  const documentType = OWNER_DOCUMENT_KEY_MAP[documentKey];
  if (!documentType) {
    const err = new Error(`Unknown document key: ${documentKey}`);
    err.status = 400;
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const previousDocId = kyc.documents?.[documentKey] ?? null;
    const previousDoc    = previousDocId
      ? await KYCDocument.findById(previousDocId).session(session)
      : null;

    const sha256Hash = fileBuffer
      ? crypto.createHash("sha256").update(fileBuffer).digest("hex")
      : null;

    const [newDoc] = await KYCDocument.create([{
      ownerId:          kyc.ownerId,
      kycId:            kyc._id,
      documentType,
      originalUrl:      cloudinaryUrl,
      mimeType:         mimeType ?? null,
      sizeBytes:        sizeBytes ?? 0,
      sha256Hash,
      status:           "UPLOADED",
      version:          previousDoc ? previousDoc.version + 1 : 1,
      isCurrentVersion: true,
      uploadedBy:       kyc.ownerId,
    }], { session });

    if (previousDoc) {
      previousDoc.isCurrentVersion = false;
      previousDoc.replacedBy       = newDoc._id;
      previousDoc.replacedAt       = new Date();
      await previousDoc.save({ session });
    }

    kyc.documents[documentKey] = newDoc._id;
    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.DOCUMENT_UPLOADED,
      triggeredBy: kyc.ownerId,
      field: documentKey,
      requestId,
      remarks: `Document uploaded: ${documentKey} (v${newDoc.version})`,
      metadata: { documentId: newDoc._id, version: newDoc.version },
    });

    await session.commitTransaction();
    return { kyc, document: newDoc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── SUBMIT KYC (DRAFT/REJECTED → PENDING) ───────────────────
 * Gated on completeness — all REQUIRED_DOCUMENT_KEYS must be present
 * and identity.pan + bank.ifsc must be filled in.
 */
export const submitKYC = async ({ kyc, requestId }) => {
  assertKYCEditable(kyc);

  const missingDocs = REQUIRED_DOCUMENT_KEYS.filter(key => !kyc.documents?.[key]);
  const missingFields = [];
  if (!kyc.identity?.pan?.maskedNumber)     missingFields.push("identity.pan");
  if (!kyc.identity?.aadhaar?.maskedNumber) missingFields.push("identity.aadhaar");
  // ✅ Fix — bank completeness now checks all 3 fields together, not
  // just ifsc. Previously an owner could fill in only the IFSC code
  // (with no account number or holder name) and still pass this check.
  if (!kyc.bank?.accountHolder) missingFields.push("bank.accountHolder");
  if (!kyc.bank?.maskedAccount) missingFields.push("bank.maskedAccount");
  if (!kyc.bank?.ifsc)          missingFields.push("bank.ifsc");

  if (missingDocs.length || missingFields.length) {
    const err = new Error(
      `KYC incomplete. Missing documents: ${missingDocs.join(", ") || "none"}. ` +
      `Missing fields: ${missingFields.join(", ") || "none"}.`
    );
    err.status = 400;
    err.details = { missingDocs, missingFields };
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    kyc.status      = KYC_STATUS.PENDING;
    kyc.submittedAt = kyc.submittedAt || new Date();
    // Clear any previous rejection reason — this is a fresh submission
    kyc.review.rejectReason = null;

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.KYC_SUBMITTED,
      triggeredBy: kyc.ownerId,
      requestId,
      remarks: "Owner submitted KYC for review",
    });

    await session.commitTransaction();
    return kyc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};