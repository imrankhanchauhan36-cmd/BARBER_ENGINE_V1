/**
 * BARBER ENGINE V1
 * backend/modules/kyc/models/KYCDocument.js
 * Enterprise Document Model with versioning — Phase 6A
 */

import mongoose from "mongoose";
import { DOCUMENT_STATUS, DOCUMENT_TYPE, VERIFICATION_SOURCE } from "../constants/kyc.constants.js";

const KYCDocumentSchema = new mongoose.Schema(
  {
    ownerId:      { type: mongoose.Schema.Types.ObjectId, ref: "User",    required: true, index: true },
    kycId:        { type: mongoose.Schema.Types.ObjectId, ref: "KYC",     required: true, index: true },
    documentType: { type: String, enum: Object.values(DOCUMENT_TYPE), required: true, index: true },

    // ── File Storage ─────────────────────────────────
    originalUrl:    { type: String, default: null }, // Cloudinary/S3
    compressedUrl:  { type: String, default: null },
    thumbnailUrl:   { type: String, default: null },
    mimeType:       { type: String, default: null },
    sizeBytes:      { type: Number, default: 0    },
    sha256Hash:     { type: String, default: null }, // integrity check

    // ── OCR Result ───────────────────────────────────
    ocrResult: {
      raw:       { type: String,  default: null },
      parsed:    { type: mongoose.Schema.Types.Mixed, default: null },
      confidence:{ type: Number,  default: null },
      source:    { type: String,  enum: Object.values(VERIFICATION_SOURCE), default: null },
      processedAt: { type: Date,  default: null },
    },

    // ── Status ───────────────────────────────────────
    status:         { type: String, enum: Object.values(DOCUMENT_STATUS), default: DOCUMENT_STATUS.UPLOADED, index: true },
    rejectedReason: { type: String, default: null, maxlength: 500 },

    // ── Versioning ───────────────────────────────────
    // Never overwrite — always new version
    version:          { type: Number,  default: 1,    min: 1 },
    isCurrentVersion: { type: Boolean, default: true, index: true },
    replacedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", default: null },
    replacedAt:     { type: Date,   default: null },

    // ── Audit ────────────────────────────────────────
    uploadedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt:     { type: Date, default: null },

    isDeleted:      { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false }
);

KYCDocumentSchema.index({ ownerId: 1, documentType: 1, version: -1 });
KYCDocumentSchema.index({ kycId: 1, documentType: 1 });
KYCDocumentSchema.index({ ownerId: 1, documentType: 1, isCurrentVersion: 1 });

export default mongoose.models.KYCDocument || mongoose.model("KYCDocument", KYCDocumentSchema);