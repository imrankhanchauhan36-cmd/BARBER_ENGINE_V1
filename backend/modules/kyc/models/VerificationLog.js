/**
 * BARBER ENGINE V1
 * backend/modules/kyc/models/VerificationLog.js
 * Immutable Audit Trail — Phase 6A — 10/10 FROZEN
 */

import mongoose from "mongoose";
import { VERIFICATION_ACTION, VERIFICATION_SOURCE } from "../constants/kyc.constants.js";

const VerificationLogSchema = new mongoose.Schema(
  {
    ownerId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kycId:      { type: mongoose.Schema.Types.ObjectId, ref: "KYC",  required: true, index: true },

    // ✅ Fix 2 — request correlation
    requestId:  { type: String, default: null },

    action:     { type: String, enum: Object.values(VERIFICATION_ACTION), required: true, index: true },
    source:     { type: String, enum: Object.values(VERIFICATION_SOURCE), default: "MANUAL" },

    // Who triggered
    triggeredBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    triggeredByRole: { type: String, default: null }, // ADMIN / SYSTEM / PROVIDER

    // What changed
    field:    { type: String, default: null }, // "pan", "aadhaar", "bank"
    oldValue: { type: String, default: null }, // masked only — never raw
    newValue: { type: String, default: null }, // masked only — never raw

    // Result
    success:   { type: Boolean, default: true },
    errorCode: { type: String,  default: null },
    errorMsg:  { type: String,  default: null },

    // Provider response
    // ⚠ IMPORTANT: Never store raw Aadhaar/PAN/bank/tokens here
    // Store only reference IDs and non-sensitive debug info
    providerRef:      { type: String, default: null },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },

    // Risk tracking
    riskScoreBefore: { type: Number, default: null },
    riskScoreAfter:  { type: Number, default: null },

    remarks:  { type: String, default: null, maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// ✅ Fix 1 — Block save() on existing documents
VerificationLogSchema.pre("save", function(next) {
  if (!this.isNew) return next(new Error("VerificationLog is immutable — updates not allowed"));
  next();
});

// ✅ Fix 1 — Block ALL update query operations
const BLOCKED_OPS = [
  "findOneAndUpdate",
  "updateOne",
  "updateMany",
  "findByIdAndUpdate",
  "update",
];
BLOCKED_OPS.forEach(op => {
  VerificationLogSchema.pre(op, function(next) {
    return next(new Error(`VerificationLog is immutable — ${op} not allowed`));
  });
});

// ─── Indexes ──────────────────────────────────────────────
VerificationLogSchema.index({ kycId: 1,    createdAt: -1 });
VerificationLogSchema.index({ ownerId: 1,  action: 1     });
VerificationLogSchema.index({ requestId: 1              });
VerificationLogSchema.index({ createdAt: -1             });

export default mongoose.models.VerificationLog ||
  mongoose.model("VerificationLog", VerificationLogSchema);