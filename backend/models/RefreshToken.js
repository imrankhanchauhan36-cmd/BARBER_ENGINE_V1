import mongoose from "mongoose";

const RefreshTokenSchema = new mongoose.Schema(
  {
    userRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    familyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    rotatedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RefreshToken",
      default: null,
      index: true,
    },

    tokenVersion: {
      type: Number,
      required: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    absoluteExpiresAt: {
      type: Date,
      required: true,
    },

    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },

    revokedReason: {
      type: String,
      default: null,
    },

    isCompromised: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: null,
      index: true,
    },

    ipAddress: {
      type: String,
      default: null,
    },

    userAgent: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/* ======================================================
   TTL AUTO CLEANUP (ENTERPRISE SAFE)
   Use absoluteExpiresAt (hard session expiry)
====================================================== */

RefreshTokenSchema.index(
  { absoluteExpiresAt: 1 },
  { expireAfterSeconds: 0 }
);

/* ======================================================
   PERFORMANCE INDEXES
====================================================== */

RefreshTokenSchema.index({
  userRef: 1,
  revokedAt: 1,
  expiresAt: 1,
});

RefreshTokenSchema.index({
  familyId: 1,
  revokedAt: 1,
});

/* ======================================================
   EXPORT (ES MODULE DEFAULT)
====================================================== */

const RefreshToken = mongoose.model(
  "RefreshToken",
  RefreshTokenSchema
);

export default RefreshToken;
