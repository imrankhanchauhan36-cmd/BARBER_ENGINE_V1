/**
 * BARBER ENGINE V1
 * backend/modules/kyc/constants/kyc.constants.js
 * Enterprise KYC Constants — FROZEN
 *
 * v1.1 — Added 3 new VERIFICATION_ACTION values for the owner-facing
 * submission flow (IDENTITY_SUBMITTED, BANK_SUBMITTED, KYC_SUBMITTED).
 * Purely additive — every existing constant and value is unchanged.
 *
 * FA-3.1 — Added APPLICANT_TYPE (OWNER default, FIELD_AGENT new).
 * Purely additive, same pattern as v1.1 above — every existing
 * constant and value is unchanged.
 */

// ─── Applicant Type ──────────────────────────────────────
// ← NEW (FA-3.1). The KYC module was originally Salon-Owner-only
// (every record implicitly assumed to belong to an OWNER). This
// discriminator lets a KYC record belong to a different actor type
// without renaming/removing the existing `ownerId` field or its
// uniqueness constraint — see models/KYC.js.
export const APPLICANT_TYPE = {
  OWNER:       "OWNER",
  FIELD_AGENT: "FIELD_AGENT",
};

// ─── KYC Status ──────────────────────────────────────────
export const KYC_STATUS = {
  DRAFT:               "DRAFT",
  PENDING:             "PENDING",
  UNDER_REVIEW:        "UNDER_REVIEW",
  PARTIALLY_VERIFIED:  "PARTIALLY_VERIFIED",
  VERIFIED:            "VERIFIED",
  REJECTED:            "REJECTED",
  EXPIRED:             "EXPIRED",
  REVERIFY_REQUIRED:   "REVERIFY_REQUIRED",
};

// ─── Verification Status ──────────────────────────────────
export const VERIFICATION_STATUS = {
  NOT_SUBMITTED: "NOT_SUBMITTED",
  PENDING:       "PENDING",
  VERIFIED:      "VERIFIED",
  FAILED:        "FAILED",
  EXPIRED:       "EXPIRED",
};

// ─── Verification Sources ─────────────────────────────────
export const VERIFICATION_SOURCE = {
  MANUAL:     "MANUAL",
  OCR:        "OCR",
  SYSTEM:     "SYSTEM",
  SIGNZY:     "SIGNZY",
  KARZA:      "KARZA",
  DIGILOCKER: "DIGILOCKER",
  SUREPASS:   "SUREPASS",
  CASHFREE:   "CASHFREE",
  UIDAI:      "UIDAI",
  NPCI:       "NPCI",
};

// ─── Verification Levels ──────────────────────────────────
export const VERIFICATION_LEVEL = {
  LEVEL_0: 0, // Phone
  LEVEL_1: 1, // Email
  LEVEL_2: 2, // PAN
  LEVEL_3: 3, // Aadhaar
  LEVEL_4: 4, // Bank
  LEVEL_5: 5, // OCR
  LEVEL_6: 6, // Face
  LEVEL_7: 7, // Manual Review → Full Verified
};

// ─── Document Types ───────────────────────────────────────
export const DOCUMENT_TYPE = {
  PAN_CARD:          "PAN_CARD",
  AADHAAR_FRONT:     "AADHAAR_FRONT",
  AADHAAR_BACK:      "AADHAAR_BACK",
  CANCELLED_CHEQUE:  "CANCELLED_CHEQUE",
  GST_CERTIFICATE:   "GST_CERTIFICATE",
  TRADE_LICENSE:     "TRADE_LICENSE",
  SELFIE:            "SELFIE",
  OTHER:             "OTHER",
};

// ─── Document Status ──────────────────────────────────────
export const DOCUMENT_STATUS = {
  UPLOADED:  "UPLOADED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED:  "APPROVED",
  REJECTED:  "REJECTED",
};

// ─── Risk Flags ───────────────────────────────────────────
export const RISK_FLAG = {
  FRAUD:              "FRAUD",
  DUPLICATE_PAN:      "DUPLICATE_PAN",
  DUPLICATE_AADHAAR:  "DUPLICATE_AADHAAR",
  NAME_MISMATCH:      "NAME_MISMATCH",
  BANK_MISMATCH:      "BANK_MISMATCH",
  SUSPICIOUS_UPLOAD:  "SUSPICIOUS_UPLOAD",
  MULTIPLE_ACCOUNTS:  "MULTIPLE_ACCOUNTS",
  MANUAL_REVIEW:      "MANUAL_REVIEW",
};

// ─── Identity Types ───────────────────────────────────────
export const IDENTITY_TYPE = {
  PAN:      "PAN",
  AADHAAR:  "AADHAAR",
  GST:      "GST",
};

// ─── Verification Log Actions ─────────────────────────────
export const VERIFICATION_ACTION = {
  KYC_INITIATED:       "KYC_INITIATED",
  DOCUMENT_UPLOADED:   "DOCUMENT_UPLOADED",
  DOCUMENT_REJECTED:   "DOCUMENT_REJECTED",
  OCR_COMPLETED:       "OCR_COMPLETED",
  PHONE_VERIFIED:      "PHONE_VERIFIED",
  EMAIL_VERIFIED:      "EMAIL_VERIFIED",
  PAN_VERIFIED:        "PAN_VERIFIED",
  AADHAAR_VERIFIED:    "AADHAAR_VERIFIED",
  BANK_VERIFIED:       "BANK_VERIFIED",
  FACE_VERIFIED:       "FACE_VERIFIED",
  ADMIN_APPROVED:      "ADMIN_APPROVED",
  ADMIN_REJECTED:      "ADMIN_REJECTED",
  RISK_SCORE_UPDATED:  "RISK_SCORE_UPDATED",
  KYC_EXPIRED:         "KYC_EXPIRED",
  REVERIFY_TRIGGERED:  "REVERIFY_TRIGGERED",
  KYC_ASSIGNED:        "KYC_ASSIGNED",
  // ← NEW (v1.1) — owner-facing submission flow
  IDENTITY_SUBMITTED:  "IDENTITY_SUBMITTED",
  BANK_SUBMITTED:      "BANK_SUBMITTED",
  KYC_SUBMITTED:       "KYC_SUBMITTED",
  // ← NEW (Phase 7A — Cashfree Secure ID)
  LIVENESS_VERIFIED:   "LIVENESS_VERIFIED",
  GST_VERIFIED:        "GST_VERIFIED",
  AUTO_VERIFIED:       "AUTO_VERIFIED",
};

// ─── Penny Drop Config ────────────────────────────────────
export const PENNY_DROP = {
  AMOUNT_PAISE: 100, // ₹1
  DESCRIPTION:  "Barber Engine KYC Verification",
};

// ─── KYC Expiry ───────────────────────────────────────────
export const KYC_EXPIRY_DAYS = 365; // 1 year

// ─── Risk Score Thresholds ────────────────────────────────
export const RISK_THRESHOLD = {
  LOW:    30,
  MEDIUM: 60,
  HIGH:   80,
};

// ─── Document Categories ──────────────────────────────────
export const DOCUMENT_CATEGORY = {
  IDENTITY: "IDENTITY",
  BANK:     "BANK",
  BUSINESS: "BUSINESS",
  LICENSE:  "LICENSE",
  SELFIE:   "SELFIE",
  OTHER:    "OTHER",
};

// ─── Verification Provider (Method vs Vendor) ─────────────
export const VERIFICATION_PROVIDER = {
  MANUAL: "MANUAL",
  OCR:    "OCR",
  API:    "API",
};

// ─── Owner-Submittable Document Keys ──────────────────────
// ← NEW (v1.1). Maps the camelCase keys used in URLs/request bodies
// (and already used by admin's validateRequestReupload) to the
// DOCUMENT_TYPE enum values stored on KYCDocument. Single source of
// truth — both the owner upload route and the admin reupload validator
// should reference this instead of maintaining separate lists.
export const OWNER_DOCUMENT_KEY_MAP = {
  panCard:         DOCUMENT_TYPE.PAN_CARD,
  aadhaarFront:    DOCUMENT_TYPE.AADHAAR_FRONT,
  aadhaarBack:     DOCUMENT_TYPE.AADHAAR_BACK,
  cancelledCheque: DOCUMENT_TYPE.CANCELLED_CHEQUE,
  gstCertificate:  DOCUMENT_TYPE.GST_CERTIFICATE,
  selfie:          DOCUMENT_TYPE.SELFIE,
};

// ─── Documents required before KYC can be submitted ───────
// ← NEW (v1.1). Derived dynamically from OWNER_DOCUMENT_KEY_MAP rather
// than maintained as a separate hardcoded list — if a document key is
// ever renamed/added/removed above, this list updates automatically
// instead of silently drifting out of sync. GST certificate is the
// only key marked optional — not every salon owner has GST registration.
export const OPTIONAL_DOCUMENT_KEYS = ["gstCertificate"];

export const REQUIRED_DOCUMENT_KEYS = Object.keys(OWNER_DOCUMENT_KEY_MAP)
  .filter((key) => !OPTIONAL_DOCUMENT_KEYS.includes(key));

// ─── Field Agent-Submittable Document Keys ────────────────
// FA-3.2 — deliberately NOT derived from OWNER_DOCUMENT_KEY_MAP: Field
// Agent is an individual applicant, not a Salon business, so GST
// certificate and cancelled cheque (both Salon-business concepts) are
// excluded by design, not by accident.
//
// Phase 1A — locked product decision: Cashfree Secure ID (PAN Verify +
// Aadhaar OTP) is now the identity source for Field Agent, replacing
// manual photo review for panCard/aadhaarFront/aadhaarBack. This map
// itself is UNCHANGED on purpose — POST /kyc/documents/:documentType
// still accepts all four documentType values (no API contract change;
// uploading a legacy photo still works if ever called). Only the
// COMPLETENESS gate below narrows to what submitFieldAgentKYC() should
// now actually require.
export const FIELD_AGENT_DOCUMENT_KEY_MAP = {
  panCard:      DOCUMENT_TYPE.PAN_CARD,
  aadhaarFront: DOCUMENT_TYPE.AADHAAR_FRONT,
  aadhaarBack:  DOCUMENT_TYPE.AADHAAR_BACK,
  selfie:       DOCUMENT_TYPE.SELFIE,
};

// Same "derive, don't hardcode" pattern already used by
// REQUIRED_DOCUMENT_KEYS above — panCard/aadhaarFront/aadhaarBack move
// to optional (verification for these now happens via Cashfree, not a
// photo), selfie stays the one required document (Face Match +
// Liveness still need it).
export const FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS = ["panCard", "aadhaarFront", "aadhaarBack"];

export const FIELD_AGENT_REQUIRED_DOCUMENT_KEYS = Object.keys(FIELD_AGENT_DOCUMENT_KEY_MAP)
  .filter((key) => !FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS.includes(key));