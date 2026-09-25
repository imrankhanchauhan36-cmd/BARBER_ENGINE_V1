/**
 * BARBER ENGINE V1
 * backend/modules/kyc/controllers/fieldAgentKyc.controller.js
 * Field Agent-Facing KYC Controller — FA-3.2
 *
 * Thin controllers (DTO shaping only) — mirrors ownerKyc.controller.js.
 * Ownership derives exclusively from req.user._id, never from any
 * client-supplied field.
 */

import { Errors, successResponse } from "../../../utils/response.js";
import VerificationLog from "../models/VerificationLog.js";
import {
    attachFieldAgentDocument,
    getOrCreateFieldAgentKYC,
    submitFieldAgentBank,
    submitFieldAgentIdentity,
    submitFieldAgentKYC,
    verifyFieldAgentAadhaarComplete,
    verifyFieldAgentAadhaarInitiate,
    verifyFieldAgentBank,
    verifyFieldAgentFaceMatch,
    verifyFieldAgentGST,
    verifyFieldAgentLiveness,
    verifyFieldAgentPAN,
} from "../services/fieldAgentKyc.service.js";

// ─── Helper — map service-thrown errors to the right HTTP response ──
const forwardServiceError = (err, next) => {
  if (err.status === 400) return next(Errors.badRequest(err.message));
  if (err.status === 403) return next(Errors.forbidden(err.message));
  return next(err);
};

// ─── Document fields on the Field Agent's KYC record ────────────────
const DOCUMENT_FIELDS = ["panCard", "aadhaarFront", "aadhaarBack", "selfie"];

// ─── Field Agent-safe DTO — no admin-only fields (risk.*, review.assignedTo/notes) ──
const toFieldAgentKYCDTO = async (kyc) => {
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
    },

    bank: {
      accountHolder: kyc.bank?.accountHolder ?? null,
      maskedAccount: kyc.bank?.maskedAccount ?? null,
      ifsc:          kyc.bank?.ifsc ?? null,
      bankName:      kyc.bank?.bankName ?? null,
      verified:      kyc.verification?.bank?.verified ?? false,
    },

    // Phase 7A (Cashfree Secure ID)
    faceMatch: { verified: kyc.verification?.face?.verified ?? false },
    liveness:  { verified: kyc.verification?.liveness?.verified ?? false },
    // GST has no stored verification.gst field (audit fix — see KYC.js
    // header: optional, never gates anything, so its outcome is
    // derived on read from the existing VerificationLog trail instead
    // of a dedicated schema slot). Only queried when a GST number was
    // actually submitted, to avoid a wasted lookup on the common case.
    gst: kyc.identity?.gst?.maskedNumber
      ? {
          maskedNumber: kyc.identity.gst.maskedNumber,
          verified: !!(await VerificationLog.findOne({ kycId: kyc._id, field: "gst" }).sort({ createdAt: -1 }).select("success").lean())?.success,
        }
      : { maskedNumber: null, verified: false },

    documents: Object.fromEntries(
      DOCUMENT_FIELDS.map((key) => {
        const doc = kyc.documents?.[key];
        if (!doc) return [key, { uploaded: false }];
        return [key, {
          uploaded:       true,
          documentId:     doc._id,
          version:        doc.version ?? 1,
          status:         doc.status ?? "UPLOADED",
          rejectedReason: doc.rejectedReason ?? null,
          url:            doc.originalUrl ?? null,
          uploadedAt:     doc.createdAt ?? null,
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
 * GET /api/field-agent/kyc
 * Lazy-creates a DRAFT KYC record if the Field Agent doesn't have one
 * yet, and (best-effort) drives the FA-2 SUBMITTED -> KYC_PENDING
 * transition on first touch.
 */
export const getMyFieldAgentKYC = async (req, res, next) => {
  try {
    const kyc = await getOrCreateFieldAgentKYC(req.user._id);
    return successResponse(res, {
      message: "KYC status fetched",
      data: await toFieldAgentKYCDTO(kyc),
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/field-agent/kyc/identity
 */
export const submitFieldAgentIdentityHandler = async (req, res, next) => {
  try {
    const updated = await submitFieldAgentIdentity({
      userId:        req.user._id,
      panNumber:     req.body.panNumber || null,
      nameOnPAN:     req.body.nameOnPAN || null,
      aadhaarNumber: req.body.aadhaarNumber || null,
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: "Identity details submitted",
      data: await toFieldAgentKYCDTO(updated),
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/bank
 */
export const submitFieldAgentBankHandler = async (req, res, next) => {
  try {
    const updated = await submitFieldAgentBank({
      userId:        req.user._id,
      accountHolder: req.body.accountHolder,
      accountNumber: req.body.accountNumber,
      ifsc:          req.body.ifsc,
      bankName:      req.body.bankName,
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: "Bank details submitted",
      data: await toFieldAgentKYCDTO(updated),
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/documents/:documentType
 * The actual multer + Cloudinary upload happens in the route file
 * (mirroring ownerKyc.routes.js's inline pattern) — by the time this
 * handler runs, req.cloudinaryUrl/req.file are already set.
 */
export const uploadFieldAgentDocumentHandler = async (req, res, next) => {
  try {
    const documentKey = req.params.documentType;

    if (!req.cloudinaryUrl) {
      return next(Errors.badRequest("Document upload failed — no file URL returned"));
    }

    const { document } = await attachFieldAgentDocument({
      userId:        req.user._id,
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
 * POST /api/field-agent/kyc/verify/pan
 * Self-serve Option B — automatic PAN verification via the real,
 * unmodified Surepass/manual provider-selection logic. Automatic
 * failure never rejects the application and never blocks Manual KYC.
 */
export const verifyFieldAgentPANHandler = async (req, res, next) => {
  try {
    const { success, result } = await verifyFieldAgentPAN({
      userId:     req.user._id,
      panNumber:  req.body.panNumber,
      nameOnPAN:  req.body.nameOnPAN || null,
      requestId:  req.requestId ?? null,
    });

    return successResponse(res, {
      message: success
        ? "PAN verified successfully"
        : "Automatic PAN verification did not succeed — you can continue with Manual KYC",
      data: {
        success,
        source:  result.source,
        remarks: result.remarks,
      },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/aadhaar/initiate
 * Phase 7A — sends an Aadhaar OTP via Cashfree Secure ID. The pending
 * refId is held server-side (on the KYC document's own aadhaar.*
 * session fields — see KYC.js) — never returned to the client.
 */
export const verifyFieldAgentAadhaarInitiateHandler = async (req, res, next) => {
  try {
    const { success, result } = await verifyFieldAgentAadhaarInitiate({
      userId:        req.user._id,
      aadhaarNumber: req.body.aadhaarNumber,
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "OTP sent to your Aadhaar-linked mobile number" : "Could not send Aadhaar OTP — you can continue with Manual KYC",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/aadhaar/verify
 * Phase 7A — completes the pending Aadhaar OTP exchange.
 */
export const verifyFieldAgentAadhaarCompleteHandler = async (req, res, next) => {
  try {
    const { success, result, kyc } = await verifyFieldAgentAadhaarComplete({
      userId:    req.user._id,
      otp:       req.body.otp,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "Aadhaar verified successfully" : "Aadhaar OTP verification failed — you can continue with Manual KYC",
      data: {
        success, source: result.source, remarks: result.remarks,
        // Phase 2B — the verification session id downstream Face
        // Match/Liveness calls need, only meaningful on success.
        verificationId: success ? (kyc.aadhaar?.verificationId ?? null) : null,
      },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/verify/bank
 * Phase 7A — self-serve instant bank account verification.
 */
export const verifyFieldAgentBankHandler = async (req, res, next) => {
  try {
    const { success, result } = await verifyFieldAgentBank({
      userId:        req.user._id,
      accountHolder: req.body.accountHolder,
      accountNumber: req.body.accountNumber,
      ifsc:          req.body.ifsc,
      bankName:      req.body.bankName,
      requestId:     req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "Bank account verified successfully" : "Automatic bank verification did not succeed — you can continue with Manual KYC",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/verify/face
 * Phase 7A — face match against the already-uploaded selfie.
 */
export const verifyFieldAgentFaceMatchHandler = async (req, res, next) => {
  try {
    const { success, result } = await verifyFieldAgentFaceMatch({
      userId:    req.user._id,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "Face match passed" : "Face match did not succeed — you can continue with Manual KYC",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/verify/liveness
 * Phase 7A — liveness check against the already-uploaded selfie.
 */
export const verifyFieldAgentLivenessHandler = async (req, res, next) => {
  try {
    const { success, result } = await verifyFieldAgentLiveness({
      userId:    req.user._id,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "Liveness confirmed" : "Liveness check did not succeed — you can continue with Manual KYC",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/verify/gst
 * Phase 7A — OPTIONAL. Only ever called when the applicant supplies a
 * GST number; skipping this step entirely is always allowed and never
 * blocks progression.
 */
export const verifyFieldAgentGSTHandler = async (req, res, next) => {
  try {
    const { success, result } = await verifyFieldAgentGST({
      userId:    req.user._id,
      gstNumber: req.body.gstNumber,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "GST verified successfully" : "GST verification did not succeed — this is optional and will not block your application",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/field-agent/kyc/submit
 * DRAFT/REJECTED -> PENDING (gated on completeness).
 */
export const submitFieldAgentKYCHandler = async (req, res, next) => {
  try {
    const updated = await submitFieldAgentKYC({
      userId:    req.user._id,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: "KYC submitted for review",
      data: await toFieldAgentKYCDTO(updated),
    });
  } catch (err) { forwardServiceError(err, next); }
};
