/**
 * BARBER ENGINE V1
 * backend/modules/kyc/models/KYC.js
 * Enterprise KYC Model — Phase 6A — 10/10 FROZEN
 *
 * v1.1 — SECURITY HARDENING (PAN India / DPDP Act compliance):
 * Removed the plaintext-named `number` field from IdentityValueSchema
 * and the plaintext-named `accountNumber` field from bank.* entirely.
 *
 * Rationale: these fields were never written or read anywhere in the
 * codebase (verified via full-repo grep before removal — only a single
 * comment referenced them, confirming intent that they "stay null").
 * Keeping a field literally named `number` / `accountNumber` next to
 * `encryptedNumber` / `encryptedAccount` is a live footgun — any future
 * developer (or AI-assisted change) could accidentally write a raw
 * PAN/Aadhaar/bank-account value into it, silently creating a
 * plaintext-PII compliance violation. Removing the field eliminates
 * that attack surface by design rather than relying on convention.
 *
 * No other field, index, or behavior in this file changed.
 *
 * FA-3.1 — Added `applicantType` (additive, defaults every existing
 * and new OWNER record to "OWNER" — no migration required, since
 * Mongoose applies schema defaults on read for a field genuinely
 * absent from a stored document). `ownerId` itself is NOT renamed and
 * its `unique: true` constraint is NOT touched — a User can still
 * only ever have exactly one KYC record, regardless of applicant
 * type, which is correct since a User has exactly one `role` at a
 * time elsewhere in this codebase.
 */

import mongoose from "mongoose";
import {
    APPLICANT_TYPE,
    KYC_STATUS,
    RISK_FLAG,
    VERIFICATION_LEVEL,
    VERIFICATION_SOURCE,
    VERIFICATION_STATUS,
} from "../constants/kyc.constants.js";

// ─── Verification Lifecycle Sub-Schema ───────────────────
// Used ONLY under verification.* — single source of truth
const VerificationSchema = new mongoose.Schema({
  status:             { type: String, enum: Object.values(VERIFICATION_STATUS), default: VERIFICATION_STATUS.NOT_SUBMITTED },
  verified:           { type: Boolean, default: false },
  verifiedAt:         { type: Date,    default: null  },
  verifiedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verificationSource: { type: String,  enum: Object.values(VERIFICATION_SOURCE), default: null },
  remarks:            { type: String,  default: null, maxlength: 500 },
  reverifyAfter:      { type: Date,    default: null },
}, { _id: false });

// ─── Identity Value Sub-Schema ───────────────────────────
// ✅ Fix 1 — stores ONLY identity values, NO verification state
// ✅ v1.1 — plaintext `number` field removed (see file header). Only
// the masked display value and the AES-encrypted value are ever stored.
const IdentityValueSchema = new mongoose.Schema({
  maskedNumber:    { type: String, default: null }, // ABCDE****F
  encryptedNumber: { type: String, default: null }, // AES-256
}, { _id: false });

// ─── Main KYC Schema ─────────────────────────────────────
const KYCSchema = new mongoose.Schema(
  {
    ///////////////////////////////////////////////////
    // OWNER REFERENCE
    ///////////////////////////////////////////////////
    ownerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      unique:   true,
      index:    true,
    },

    ///////////////////////////////////////////////////
    // APPLICANT TYPE — FA-3.1, additive
    // Server-controlled only (see kyc.service.js's getOrCreateKYC) —
    // never read from client input anywhere in this module.
    ///////////////////////////////////////////////////
    applicantType: {
      type:    String,
      enum:    Object.values(APPLICANT_TYPE),
      default: APPLICANT_TYPE.OWNER,
      index:   true,
    },

    ///////////////////////////////////////////////////
    // KYC STATUS
    ///////////////////////////////////////////////////
    status: {
      type:    String,
      enum:    Object.values(KYC_STATUS),
      default: KYC_STATUS.DRAFT,
      index:   true,
    },

    verificationLevel: {
      type:    Number,
      default: VERIFICATION_LEVEL.LEVEL_0,
      min:     0,
      max:     7,
    },

    ///////////////////////////////////////////////////
    // CONTACT — stores values only
    // ✅ Fix 2 — no VerificationSchema here
    // verification state lives under verification.*
    ///////////////////////////////////////////////////
    contact: {
      phone: { type: String, default: null },
      email: { type: String, default: null },
    },

    ///////////////////////////////////////////////////
    // IDENTITY — stores values only
    // ✅ Fix 1 — no verification state here
    // verification state lives under verification.*
    ///////////////////////////////////////////////////
    identity: {
      pan:     { ...IdentityValueSchema.obj },
      aadhaar: { ...IdentityValueSchema.obj },
      gst: {
        maskedNumber:    { type: String, default: null },
        encryptedNumber: { type: String, default: null },
      },
    },

    ///////////////////////////////////////////////////
    // BANK ACCOUNT
    // ✅ v1.1 — plaintext `accountNumber` field removed (see file
    // header). Only maskedAccount + encryptedAccount are ever stored.
    ///////////////////////////////////////////////////
    bank: {
      accountHolder:    { type: String, default: null },
      maskedAccount:    { type: String, default: null }, // XXXX1234
      encryptedAccount: { type: String, default: null }, // AES-256
      ifsc:             { type: String, default: null },
      bankName:         { type: String, default: null },
      pennyDropStatus:  { type: String, enum: ["NOT_INITIATED", "PENDING", "SUCCESS", "FAILED"], default: "NOT_INITIATED" },
      pennyDropRef:     { type: String, default: null },
    },

    ///////////////////////////////////////////////////
    // AADHAAR VERIFICATION SESSION — Phase 2B (Cashfree), additive only
    //
    // Distinct from identity.aadhaar (raw masked/encrypted value) and
    // verification.aadhaar (the generic KYC-wide verified/status flag
    // shared by every field under verification.*). This tracks the
    // CASHFREE OTP SESSION itself — a `verificationId` downstream Face
    // Match/Liveness calls need (Cashfree's own error responses require
    // it — confirmed live), the OTP transaction's own `refId`, and a
    // small session-lifecycle status independent of the generic
    // VERIFICATION_STATUS enum. Not registered in calcLevel()/
    // calcKYCStatus() — a session cache only, never a business-rule
    // input. Was previously held in Redis only (short-lived, per-user
    // key); moved here because a LATER, separate request (Face Match/
    // Liveness) needs to read verificationId, and this document is
    // already the one thing every one of those self-serve calls loads.
    ///////////////////////////////////////////////////
    aadhaar: {
      verificationId: { type: String, default: null },
      refId:          { type: String, default: null },
      sessionStatus:  { type: String, enum: ["NOT_STARTED", "OTP_SENT", "VERIFIED", "FAILED"], default: "NOT_STARTED" },
      otpGeneratedAt: { type: Date, default: null },
    },

    ///////////////////////////////////////////////////
    // DOCUMENTS (refs to KYCDocument collection)
    ///////////////////////////////////////////////////
    documents: {
      panCard:         { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
      aadhaarFront:    { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
      aadhaarBack:     { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
      cancelledCheque: { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
      gstCertificate:  { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
      selfie:          { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
      other:           [{ type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument" }],
    },

    ///////////////////////////////////////////////////
    // VERIFICATION — single source of truth
    // ✅ Fix 1 + Fix 2 — ALL verification state here
    //
    // Phase 7A audit fix — re-examined whether `liveness`/`gst` each
    // genuinely need their own additive slot here, per the "reuse
    // existing schema wherever possible" directive:
    //
    //   GST — REMOVED. GST is optional, never gates auto-approval, and
    //   is used only for display. Its "verified" outcome is now derived
    //   on read from the existing, already-queried VerificationLog
    //   collection (latest {field:"gst"} row's `success`) instead of a
    //   stored boolean — see fieldAgentKyc.controller.js's DTO. No new
    //   field needed; identity.gst.{maskedNumber,encryptedNumber}
    //   (pre-existing, Owner-era fields) already hold the value side.
    //
    //   liveness — KEPT. Unlike GST, liveness is MANDATORY and gates
    //   MANDATORY_AUTO_VERIFY_FIELDS in fieldAgentKyc.service.js,
    //   evaluated synchronously after every verification step. Every
    //   other field this checklist reads (pan/aadhaar/bank/face) uses
    //   this exact stored-boolean VerificationSchema shape; deriving
    //   liveness differently (e.g. from raw VerificationLog history)
    //   would need its own "is this still the latest, unsuperseded
    //   success" rule — a real logic addition, not a pure reuse, and
    //   the ticket instructing this fix explicitly requires "no
    //   business logic changes." Keeping it identical in shape to its
    //   7 existing siblings is the lower-risk, more consistent option.
    ///////////////////////////////////////////////////
    verification: {
      phone:        { ...VerificationSchema.obj },
      email:        { ...VerificationSchema.obj },
      pan:          { ...VerificationSchema.obj },
      aadhaar:      { ...VerificationSchema.obj },
      bank:         { ...VerificationSchema.obj },
      ocr:          { ...VerificationSchema.obj },
      face:         { ...VerificationSchema.obj },
      liveness:     { ...VerificationSchema.obj },
      manualReview: { ...VerificationSchema.obj },
    },

    ///////////////////////////////////////////////////
    // RISK ENGINE
    ///////////////////////////////////////////////////
    risk: {
      score:                { type: Number, default: 0, min: 0, max: 100 },
      flags:                [{ type: String, enum: Object.values(RISK_FLAG) }],
      manualReviewRequired: { type: Boolean, default: false },
      lastUpdatedAt:        { type: Date,    default: null },
    },

    ///////////////////////////////////////////////////
    // ADMIN REVIEW
    ///////////////////////////////////////////////////
    review: {
      assignedTo:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      assignedAt:   { type: Date,   default: null },
      reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt:   { type: Date,   default: null },
      rejectReason: { type: String, default: null, maxlength: 500 },
      notes:        { type: String, default: null, maxlength: 1000 },
    },

    ///////////////////////////////////////////////////
    // TIMELINE
    ///////////////////////////////////////////////////
    submittedAt: { type: Date, default: null },
    approvedAt:  { type: Date, default: null },
    rejectedAt:  { type: Date, default: null },
    expiresAt:   { type: Date, default: null },

    ///////////////////////////////////////////////////
    // SOFT DELETE
    ///////////////////////////////////////////////////
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false }
);

// ─── Indexes ──────────────────────────────────────────────
KYCSchema.index({ status: 1, createdAt: -1 });
KYCSchema.index({ "risk.score": -1 });
KYCSchema.index({ "risk.manualReviewRequired": 1, status: 1 });
KYCSchema.index({ submittedAt: -1 });
KYCSchema.index({ expiresAt: 1 }, { sparse: true });

export default mongoose.models.KYC || mongoose.model("KYC", KYCSchema);