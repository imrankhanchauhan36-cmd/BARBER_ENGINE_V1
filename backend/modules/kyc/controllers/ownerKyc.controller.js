/**
 * BARBER ENGINE V1
 * backend/modules/kyc/controllers/ownerKyc.controller.js
 * Owner-Facing KYC Controller — Phase 6C
 */

import { Errors, successResponse } from "../../../utils/response.js";
import VerificationLog from "../models/VerificationLog.js";
import { getOrCreateKYC } from "../services/kyc.service.js";
import {
    attachDocument,
    submitBank,
    submitIdentity,
    submitKYC,
} from "../services/ownerKyc.service.js";
// ZEMISH onboarding-gate pass — Owner self-serve verification. Reuses
// verifyPAN/verifyBank exactly as Field Agent already does (same
// actorId/actorRole/actorIsAdmin:false triple these functions were
// already built to accept — see verification.service.js's own FA-3.2
// header comment). No change to verification.service.js, no change to
// the frozen schema, no duplicate KYC model.
import {
    initiateAadhaarOTP,
    verifyAadhaarOTP,
    verifyBank,
    verifyFaceMatch,
    verifyGST,
    verifyLiveness,
    verifyPAN,
} from "../services/verification.service.js";
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

  // GST verified status — derived from the latest {field:"gst"} log row,
  // same read-only derivation already used by adminKyc.dto.js and
  // fieldAgentKyc.controller.js's own DTOs (no stored verification.gst
  // field exists on KYC.js by design — see that model's own header).
  // Only queried when a GST number was actually submitted.
  const gstVerified = kyc.identity?.gst?.maskedNumber
    ? !!(await VerificationLog.findOne({ kycId: kyc._id, field: "gst" }).sort({ createdAt: -1 }).select("success").lean())?.success
    : false;

  return {
    id:                kyc._id,
    status:            kyc.status,
    verificationLevel: kyc.verificationLevel,

    identity: {
      pan:     { maskedNumber: kyc.identity?.pan?.maskedNumber ?? null,     verified: kyc.verification?.pan?.verified ?? false },
      // ZEMISH Section B — aadhaarVerificationId is exposed so the web
      // client can decide, without guessing, whether Face Match/
      // Liveness are callable yet (both require it, same precondition
      // Field Agent already enforces server-side — see
      // verifyOwnerFaceMatchHandler/verifyOwnerLivenessHandler below).
      aadhaar: {
        maskedNumber: kyc.identity?.aadhaar?.maskedNumber ?? null,
        verified: kyc.verification?.aadhaar?.verified ?? false,
        aadhaarVerificationId: kyc.aadhaar?.verificationId ?? null,
      },
      gst:     { maskedNumber: kyc.identity?.gst?.maskedNumber ?? null,     verified: gstVerified },
    },

    // ZEMISH Section B — Face Match / Liveness are genuinely supported
    // for Owner (same Cashfree contract Field Agent already uses, no
    // new endpoint — see verifyOwnerFaceMatchHandler/
    // verifyOwnerLivenessHandler below), so their real verified state
    // is now surfaced here instead of being silently absent.
    face:     { verified: kyc.verification?.face?.verified ?? false },
    liveness: { verified: kyc.verification?.liveness?.verified ?? false },

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

/**
 * POST /api/salon/kyc/verify/pan
 * ZEMISH onboarding-gate pass — Owner self-serve PAN verification.
 * Previously Owner PAN verification was entirely Admin-triggered (no
 * such endpoint existed) — this is new, additive surface, not a
 * change to any existing route/contract. Mirrors
 * fieldAgentKyc.controller.js::verifyFieldAgentPANHandler's exact
 * validation + response shape. A failure here is NEVER fatal — the
 * owner can still submit for admin manual review, same non-blocking
 * philosophy as every other self-serve verify endpoint in this app.
 */
export const verifyOwnerPANHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { panNumber, nameOnPAN } = req.body;
    if (!panNumber?.trim()) return next(Errors.badRequest("panNumber is required"));
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber.trim().toUpperCase())) {
      return next(Errors.badRequest("Invalid PAN format. Expected: ABCDE1234F"));
    }

    const kyc = await getOrCreateKYC(ownerId);

    const { success, result } = await verifyPAN({
      kyc,
      panNumber: panNumber.trim().toUpperCase(),
      nameOnPAN: nameOnPAN?.trim() || null,
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
      actorIsAdmin: false,
    });

    return successResponse(res, {
      message: success ? "PAN verified successfully" : "Automatic PAN verification did not succeed — you can continue and it will be reviewed manually.",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/verify/bank
 * ZEMISH onboarding-gate pass — Owner self-serve bank verification.
 * Same rationale and pattern as verifyOwnerPANHandler above, mirroring
 * fieldAgentKyc.controller.js::verifyFieldAgentBankHandler.
 */
export const verifyOwnerBankHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { accountHolder, accountNumber, ifsc, bankName } = req.body;
    if (!accountHolder?.trim()) return next(Errors.badRequest("accountHolder is required"));
    if (!accountNumber?.trim()) return next(Errors.badRequest("accountNumber is required"));
    const digitsOnly = accountNumber.trim().replace(/\D/g, "");
    if (digitsOnly.length < 9 || digitsOnly.length > 18) {
      return next(Errors.badRequest("Account number must be 9–18 digits"));
    }
    if (!ifsc?.trim() || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
      return next(Errors.badRequest("Invalid IFSC format. Expected: ABCD0123456"));
    }
    if (!bankName?.trim()) return next(Errors.badRequest("bankName is required"));

    const kyc = await getOrCreateKYC(ownerId);

    const { success, result } = await verifyBank({
      kyc,
      accountNumber: digitsOnly,
      ifsc: ifsc.trim().toUpperCase(),
      bankName: bankName.trim(),
      accountHolder: accountHolder.trim(),
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
      actorIsAdmin: false,
    });

    return successResponse(res, {
      message: success ? "Bank account verified successfully" : "Automatic bank verification did not succeed — you can continue and it will be reviewed manually.",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/verify/gst
 * ZEMISH final integration pass — Owner self-serve, OPTIONAL GST
 * verification. Mirrors adminKyc.controller.js::verifyGSTHandler and
 * fieldAgentKyc.controller.js::verifyFieldAgentGSTHandler exactly.
 * GST NEVER gates anything — verifyGST itself never touches
 * verificationLevel/status/the onboarding gate (isMandatoryOwnerKycVerified
 * checks only PAN+Bank) — this is purely an optional, additive
 * convenience for an owner who has GST registration.
 */
export const verifyOwnerGSTHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { gstNumber } = req.body;
    if (!gstNumber?.trim()) return next(Errors.badRequest("gstNumber is required"));
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstNumber.trim().toUpperCase())) {
      return next(Errors.badRequest("Invalid GSTIN format. Expected: 22ABCDE1234F1Z5"));
    }

    const kyc = await getOrCreateKYC(ownerId);

    const { success, result } = await verifyGST({
      kyc,
      gstNumber: gstNumber.trim().toUpperCase(),
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
    });

    return successResponse(res, {
      message: success ? "GST verified successfully" : "GST verification did not succeed — this is optional and will not block your salon registration.",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/verify/aadhaar/initiate
 * ZEMISH Section B — Owner self-serve Aadhaar OTP, step 1 of 2.
 *
 * Investigated (not assumed): initiateAadhaarOTPCashfree/
 * verifyAadhaarOTPCashfree in providers/cashfree.provider.js carry no
 * role/purpose coupling to "FIELD_AGENT" anywhere — they are plain,
 * generic Cashfree Aadhaar-OTP API wrappers. initiateAadhaarOTP /
 * verifyAadhaarOTP (verification.service.js) already accept actorRole
 * generically (FA-3.2) and are the exact functions Field Agent's own
 * self-serve flow calls (fieldAgentKyc.service.js::
 * verifyFieldAgentAadhaarInitiate/Complete, confirmed working against
 * real Cashfree per that file's own Phase 2B/2C "live audit" notes).
 * So this is a genuinely supported operation — reused verbatim, zero
 * new provider code, zero new Cashfree contract.
 *
 * Does NOT affect isMandatoryOwnerKycVerified() — that gate remains
 * PAN+Bank only, unchanged. Aadhaar/Face/Liveness here are an
 * additional, optional trust signal for Admin manual review, same as
 * GST — not a new mandatory requirement.
 */
export const verifyOwnerAadhaarInitiateHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { aadhaarNumber } = req.body;
    if (!aadhaarNumber?.trim() || !/^\d{12}$/.test(aadhaarNumber.trim())) {
      return next(Errors.badRequest("A valid 12-digit Aadhaar number is required"));
    }

    const kyc = await getOrCreateKYC(ownerId);

    const { success, result } = await initiateAadhaarOTP({
      kyc,
      aadhaarNumber: aadhaarNumber.trim(),
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
    });

    return successResponse(res, {
      message: success ? "OTP sent to the Aadhaar-linked mobile number" : "Could not send Aadhaar OTP — you can continue and it will be reviewed manually.",
      data: { success, remarks: result.remarks ?? null },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/verify/aadhaar/complete
 * ZEMISH Section B — Owner self-serve Aadhaar OTP, step 2 of 2. Same
 * single-use pending-session guard as
 * fieldAgentKyc.service.js::verifyFieldAgentAadhaarComplete — a repeat
 * call after the session already resolved requires a fresh /initiate.
 */
export const verifyOwnerAadhaarCompleteHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { otp } = req.body;
    if (!otp?.trim() || !/^\d{4,8}$/.test(otp.trim())) {
      return next(Errors.badRequest("A valid OTP is required"));
    }

    const kyc = await getOrCreateKYC(ownerId);
    if (kyc.aadhaar?.sessionStatus !== "OTP_SENT" || !kyc.aadhaar?.refId) {
      return next(Errors.badRequest("No pending Aadhaar OTP request found, or it has expired — please generate a new OTP"));
    }

    const { success, result } = await verifyAadhaarOTP({
      kyc,
      refId: kyc.aadhaar.refId,
      otp: otp.trim(),
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
      actorIsAdmin: false,
    });

    return successResponse(res, {
      message: success ? "Aadhaar verified successfully" : "Aadhaar OTP verification did not succeed — you can continue and it will be reviewed manually.",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/verify/face
 * ZEMISH Section B — Owner self-serve Face Match. Same precondition as
 * fieldAgentKyc.service.js::verifyFieldAgentFaceMatch: Cashfree's real
 * /face-match needs the verification_id from a successful Aadhaar OTP
 * session on THIS kyc record — there is no "two arbitrary images"
 * mode. Reference image is the uploaded selfie document (documents.
 * selfie, already supported by uploadDocumentHandler above).
 */
export const verifyOwnerFaceMatchHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const kyc = await getOrCreateKYC(ownerId);

    if (!kyc.aadhaar?.verificationId) {
      return next(Errors.badRequest("Complete Aadhaar verification first."));
    }

    await kyc.populate({ path: "documents.selfie", select: "originalUrl" });
    const selfieDoc = kyc.documents?.selfie;
    if (!selfieDoc?.originalUrl) {
      return next(Errors.badRequest("Upload a selfie before requesting face match"));
    }

    const { success, result } = await verifyFaceMatch({
      kyc,
      selfieUrl: selfieDoc.originalUrl,
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
      actorIsAdmin: false,
    });

    return successResponse(res, {
      message: success ? "Face match verified successfully" : "Face match did not succeed — you can continue and it will be reviewed manually.",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};

/**
 * POST /api/salon/kyc/verify/liveness
 * ZEMISH Section B — Owner self-serve Liveness. Same precondition as
 * fieldAgentKyc.service.js::verifyFieldAgentLiveness (verification_id
 * from the Aadhaar OTP session, same uploaded selfie).
 */
export const verifyOwnerLivenessHandler = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const kyc = await getOrCreateKYC(ownerId);

    if (!kyc.aadhaar?.verificationId) {
      return next(Errors.badRequest("Complete Aadhaar verification first."));
    }

    await kyc.populate({ path: "documents.selfie", select: "originalUrl" });
    const selfieDoc = kyc.documents?.selfie;
    if (!selfieDoc?.originalUrl) {
      return next(Errors.badRequest("Upload a selfie before requesting a liveness check"));
    }

    const { success, result } = await verifyLiveness({
      kyc,
      selfieUrl: selfieDoc.originalUrl,
      requestId: req.requestId ?? null,
      actorId: ownerId,
      actorRole: "OWNER",
      actorIsAdmin: false,
    });

    return successResponse(res, {
      message: success ? "Liveness verified successfully" : "Liveness check did not succeed — you can continue and it will be reviewed manually.",
      data: { success, source: result.source, remarks: result.remarks },
    });
  } catch (err) { forwardServiceError(err, next); }
};