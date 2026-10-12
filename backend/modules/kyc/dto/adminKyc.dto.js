/**
 * BARBER ENGINE V1
 * backend/modules/kyc/dto/adminKyc.dto.js
 * Admin KYC DTOs — Phase 6A
 *
 * ZEMISH completion pass — toDetailDTO now also reports whether GST was
 * verified. No `verification.gst` field exists on KYC.js by design (see
 * that model's own header: GST never gates anything, so its outcome is
 * derived on read from the existing VerificationLog trail instead of a
 * stored boolean) — this mirrors the exact same derivation
 * fieldAgentKyc.controller.js's own DTO already uses for the identical
 * field. toDetailDTO is now async (one extra read-only query) — additive
 * to its return shape only; its one caller (adminKyc.controller.js
 * ::getKYCDetail) now awaits it.
 */

import VerificationLog from "../models/VerificationLog.js";

// ─── Verification field DTO ───────────────────────────────
const verificationField = (v = {}) => ({
  status:             v.status             ?? null,
  verified:           v.verified           ?? false,
  verifiedAt:         v.verifiedAt         ?? null,
  verificationSource: v.verificationSource ?? null,
  remarks:            v.remarks            ?? null,
  reverifyAfter:      v.reverifyAfter      ?? null,
})

// ─── Document ref DTO ────────────────────────────────────
const documentRef = (doc) => {
  if (!doc) return null
  return {
    id:               doc._id,
    documentType:     doc.documentType     ?? null,
    status:           doc.status           ?? null,
    originalUrl:      doc.originalUrl      ?? null,
    thumbnailUrl:     doc.thumbnailUrl     ?? null,
    isCurrentVersion: doc.isCurrentVersion ?? true,
    version:          doc.version          ?? 1,
    rejectedReason:   doc.rejectedReason   ?? null,
    uploadedAt:       doc.createdAt        ?? null,
  }
}

/**
 * Summary DTO
 */
export const toSummaryDTO = (data = {}) => ({
  total:            data.total            ?? 0,
  draft:            data.draft            ?? 0,
  pending:          data.pending          ?? 0,
  underReview:      data.underReview      ?? 0,
  partiallyVerified:data.partiallyVerified?? 0,
  verified:         data.verified         ?? 0,
  rejected:         data.rejected         ?? 0,
  expired:          data.expired          ?? 0,
  reverifyRequired: data.reverifyRequired ?? 0,
  highRisk:         data.highRisk         ?? 0,
  manualReviewQueue:data.manualReviewQueue?? 0,
})

/**
 * List Item DTO
 */
export const toListDTO = (kyc) => {
  const owner = kyc.ownerId || {}
  return {
    id:                kyc._id,
    status:            kyc.status            ?? null,
    verificationLevel: kyc.verificationLevel ?? 0,
    submittedAt:       kyc.submittedAt       ?? null,
    createdAt:         kyc.createdAt         ?? null,
    updatedAt:         kyc.updatedAt         ?? null,

    risk: {
      score:                kyc.risk?.score                ?? 0,
      manualReviewRequired: kyc.risk?.manualReviewRequired ?? false,
      flags:                kyc.risk?.flags                ?? [],
    },

    owner: {
      id:    owner._id   ?? null,
      name:  owner.name  ?? null,
      phone: owner.phone ?? null,
      email: owner.email ?? null,
      accountStatus: owner.accountStatus ?? null,
    },

    verification: {
      phone:   kyc.verification?.phone?.verified   ?? false,
      email:   kyc.verification?.email?.verified   ?? false,
      pan:     kyc.verification?.pan?.verified     ?? false,
      aadhaar: kyc.verification?.aadhaar?.verified ?? false,
      bank:    kyc.verification?.bank?.verified    ?? false,
    },

    review: {
      assignedTo: kyc.review?.assignedTo ?? null,
      reviewedBy: kyc.review?.reviewedBy ?? null,
      reviewedAt: kyc.review?.reviewedAt ?? null,
    },
  }
}

/**
 * Detail DTO
 */
export const toDetailDTO = async (kyc) => {
  const owner = kyc.ownerId || {}

  // GST verified status — derived from the latest {field:"gst"} log row,
  // only queried when a GST number was actually submitted (mirrors
  // fieldAgentKyc.controller.js's identical DTO logic exactly).
  const gstVerified = kyc.identity?.gst?.maskedNumber
    ? !!(await VerificationLog.findOne({ kycId: kyc._id, field: "gst" }).sort({ createdAt: -1 }).select("success").lean())?.success
    : false

  return {
    id:                kyc._id,
    status:            kyc.status            ?? null,
    verificationLevel: kyc.verificationLevel ?? 0,

    owner: {
      id:            owner._id            ?? null,
      name:          owner.name           ?? null,
      phone:         owner.phone          ?? null,
      email:         owner.email          ?? null,
      accountStatus: owner.accountStatus  ?? null,
      createdAt:     owner.createdAt      ?? null,
    },

    contact: {
      phone: kyc.contact?.phone ?? null,
      email: kyc.contact?.email ?? null,
    },

    identity: {
      pan: {
        maskedNumber: kyc.identity?.pan?.maskedNumber ?? null,
      },
      aadhaar: {
        maskedNumber: kyc.identity?.aadhaar?.maskedNumber ?? null,
      },
      gst: {
        maskedNumber: kyc.identity?.gst?.maskedNumber ?? null,
        verified:     gstVerified,
      },
    },

    bank: {
      accountHolder: kyc.bank?.accountHolder ?? null,
      maskedAccount: kyc.bank?.maskedAccount ?? null,
      ifsc:          kyc.bank?.ifsc          ?? null,
      bankName:      kyc.bank?.bankName      ?? null,
      pennyDropStatus: kyc.bank?.pennyDropStatus ?? null,
      verified:      kyc.bank ? (kyc.verification?.bank?.verified ?? false) : false,
    },

    documents: {
      panCard:         documentRef(kyc.documents?.panCard),
      aadhaarFront:    documentRef(kyc.documents?.aadhaarFront),
      aadhaarBack:     documentRef(kyc.documents?.aadhaarBack),
      cancelledCheque: documentRef(kyc.documents?.cancelledCheque),
      gstCertificate:  documentRef(kyc.documents?.gstCertificate),
      selfie:          documentRef(kyc.documents?.selfie),
      other:           (kyc.documents?.other || []).map(documentRef),
    },

    verification: {
      phone:        verificationField(kyc.verification?.phone),
      email:        verificationField(kyc.verification?.email),
      pan:          verificationField(kyc.verification?.pan),
      aadhaar:      verificationField(kyc.verification?.aadhaar),
      bank:         verificationField(kyc.verification?.bank),
      ocr:          verificationField(kyc.verification?.ocr),
      face:         verificationField(kyc.verification?.face),
      liveness:     verificationField(kyc.verification?.liveness),
      manualReview: verificationField(kyc.verification?.manualReview),
    },

    risk: {
      score:                kyc.risk?.score                ?? 0,
      flags:                kyc.risk?.flags                ?? [],
      manualReviewRequired: kyc.risk?.manualReviewRequired ?? false,
      lastUpdatedAt:        kyc.risk?.lastUpdatedAt        ?? null,
    },

    review: {
      assignedTo:   kyc.review?.assignedTo  ?? null,
      assignedAt:   kyc.review?.assignedAt  ?? null,
      reviewedBy:   kyc.review?.reviewedBy  ?? null,
      reviewedAt:   kyc.review?.reviewedAt  ?? null,
      rejectReason: kyc.review?.rejectReason?? null,
      notes:        kyc.review?.notes       ?? null,
    },

    timeline: {
      submittedAt: kyc.submittedAt ?? null,
      approvedAt:  kyc.approvedAt  ?? null,
      rejectedAt:  kyc.rejectedAt  ?? null,
      expiresAt:   kyc.expiresAt   ?? null,
      createdAt:   kyc.createdAt   ?? null,
      updatedAt:   kyc.updatedAt   ?? null,
    },
  }
}