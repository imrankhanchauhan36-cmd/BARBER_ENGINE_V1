/**
 * BARBER ENGINE V1
 * backend/modules/kyc/controllers/ownerKyc.controller.js
 * Owner-Facing KYC Controller — Phase 6C
 */

import { Errors, successResponse } from "../../../utils/response.js";
import { getOrCreateKYC } from "../services/kyc.service.js";
import {
    attachDocument,
    submitBank,
    submitIdentity,
    submitKYC,
} from "../services/ownerKyc.service.js";
import {
    validateBank,
    validateDocumentKey,
    validateIdentity,
} from "../validators/ownerKyc.validator.js";

// ─── Helper — map service-thrown errors to the right HTTP response ──
// Services throw plain Error objects with an optional `.status` (400
// for validation/state errors). This keeps the service layer framework
// agnostic while controllers stay consistent with the rest of the app's
// Errors.* + next(err) convention.
const forwardServiceError = (err, next) => {
  if (err.status === 400) return next(Errors.badRequest(err.message));
  return next(err);
};

// ─── Document fields we link on the KYC record ─────────────
// Mirrors OWNER_DOCUMENT_KEY_MAP's keys (minus "other", which is a
// free-form array not part of the fixed checklist).
const DOCUMENT_FIELDS = [
  "panCard", "aadhaarFront", "aadhaarBack",
  "cancelledCheque", "gstCertificate", "selfie",
];

// ─── Minimal owner-safe DTO ────────────────────────────────
// Owner should see their own submission progress, masked values, and
// document statuses — but NOT internal admin-only fields like
// risk.score, risk.flags, or review.assignedTo/notes (those are for
// admin eyes only, same separation of concerns as the rest of the app).
//
// ✅ v1.1 — now populates each document ref so the response includes
// version / status / rejectedReason / uploadedAt, not just a boolean.
// Previously the mobile app had no way to show "v1 • 27 Jun 2026" or a
// rejection reason per document — this was a real gap found while
// building the KYC screen UI, fixed here additively (no existing
// field removed or renamed).
const toOwnerKYCDTO = async (kyc) => {
  await kyc.populate(
    DOCUMENT_FIELDS.map((field) => ({
      path:   `documents.${field}`,
      select: "version status rejectedReason originalUrl createdAt",
    }))
  );

  return {
    id:                kyc._id,
    status:            kyc.status,
    verificationLevel: kyc.verificationLevel,

    identity: {
      pan:     { maskedNumber: kyc.identity?.pan?.maskedNumber ?? null,     verified: kyc.verification?.pan?.verified ?? false },
      aadhaar: { maskedNumber: kyc.identity?.aadhaar?.maskedNumber ?? null, verified: kyc.verification?.aadhaar?.verified ?? false },
      gst:     { maskedNumber: kyc.identity?.gst?.maskedNumber ?? null },
    },

    bank: {
      accountHolder: kyc.bank?.accountHolder ?? null,
      maskedAccount: kyc.bank?.maskedAccount ?? null,
      ifsc:          kyc.bank?.ifsc ?? null,
      bankName:      kyc.bank?.bankName ?? null,
      verified:      kyc.verification?.bank?.verified ?? false,
    },

    documents: Object.fromEntries(
      DOCUMENT_FIELDS.map((key) => {
        const doc = kyc.documents?.[key];
        if (!doc) return [key, { uploaded: false }];
        return [key, {
          uploaded:      true,
          documentId:    doc._id,
          version:       doc.version ?? 1,
          status:        doc.status ?? "UPLOADED",
          rejectedReason: doc.rejectedReason ?? null,
          url:           doc.originalUrl ?? null,
          uploadedAt:    doc.createdAt ?? null,
        }];
      })
    ),

    rejectReason: kyc.review?.rejectReason ?? null,
    submittedAt:  kyc.submittedAt ?? null,
    approvedAt:   kyc.approvedAt ?? null,
    rejectedAt:   kyc.rejectedAt ?? null,
  };
};

/**
 * GET /api/salon/kyc
 * Lazy-creates a DRAFT KYC record if the owner doesn't have one yet.
 */
export const getMyKYC = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const kyc = await getOrCreateKYC(ownerId);
    return successResponse(res, {
      message: "KYC status fetched",
      data: await toOwnerKYCDTO(kyc),
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/salon/kyc/identity
 */
export const submitIdentityHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const errors = validateIdentity(req.body);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    const kyc = await getOrCreateKYC(ownerId);

    const updated = await submitIdentity({
      kyc,
      panNumber:     req.body.panNumber?.trim().toUpperCase() || null,
      nameOnPAN:     req.body.nameOnPAN?.trim() || null,
      aadhaarNumber: req.body.aadhaarNumber?.trim() || null,
      gstNumber:     req.body.gstNumber?.trim().toUpperCase() || null,
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: "Identity details submitted",
      data: await toOwnerKYCDTO(updated),
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/bank
 */
export const submitBankHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const errors = validateBank(req.body);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    const kyc = await getOrCreateKYC(ownerId);

    const updated = await submitBank({
      kyc,
      accountHolder: req.body.accountHolder.trim(),
      accountNumber: req.body.accountNumber.trim(),
      ifsc:          req.body.ifsc.trim().toUpperCase(),
      bankName:      req.body.bankName.trim(),
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: "Bank details submitted",
      data: await toOwnerKYCDTO(updated),
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/documents/:documentType
 *
 * IMPORTANT: the actual multer + Cloudinary upload happens in the route
 * file (mirroring the exact inline pattern already used in
 * routes/user.routes.js for profile photo upload) — by the time this
 * handler runs, req.cloudinaryUrl, req.file.mimetype/size/buffer are
 * already set. This handler only persists the KYCDocument + KYC link.
 */
export const uploadDocumentHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const documentKey = req.params.documentType;

    const errors = validateDocumentKey(documentKey);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    if (!req.cloudinaryUrl) {
      return next(Errors.badRequest("Document upload failed — no file URL returned"));
    }

    const kyc = await getOrCreateKYC(ownerId);

    const { document } = await attachDocument({
      kyc,
      documentKey,
      cloudinaryUrl: req.cloudinaryUrl,
      mimeType:      req.file?.mimetype ?? null,
      sizeBytes:     req.file?.size ?? 0,
      fileBuffer:    req.file?.buffer ?? null,
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: "Document uploaded successfully",
      data: {
        documentType: documentKey,
        documentId:   document._id,
        version:      document.version,
        url:          document.originalUrl,
        status:       document.status,
      },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/submit
 * DRAFT/REJECTED → PENDING (gated on completeness — see ownerKyc.service.js)
 */
export const submitKYCHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const kyc = await getOrCreateKYC(ownerId);

    const updated = await submitKYC({ kyc, requestId: req.requestId ?? null });

    return successResponse(res, {
      message: "KYC submitted for review",
      data: await toOwnerKYCDTO(updated),
    });
  } catch (err) { forwardServiceError(err, next); }
};