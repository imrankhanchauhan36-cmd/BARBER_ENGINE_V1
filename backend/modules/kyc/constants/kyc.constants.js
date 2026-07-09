/**
 * BARBER ENGINE V1
 * backend/modules/kyc/constants/kyc.constants.js
 * Enterprise KYC Constants — FROZEN
 *
 * v1.1 — Added 3 new VERIFICATION_ACTION values for the owner-facing
 * submission flow (IDENTITY_SUBMITTED, BANK_SUBMITTED, KYC_SUBMITTED).
 * Purely additive — every existing constant and value is unchanged.
 */

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