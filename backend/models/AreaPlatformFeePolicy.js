/**
 * BARBER ENGINE V1
 * backend/models/AreaPlatformFeePolicy.js
 *
 * PAN-India area-wise Platform Fee configuration. This is NOT a second
 * customer-facing fee — it is the configured SOURCE of the one existing
 * customer-facing fee, which continues to be stored on Booking as
 * commissionAmountInPaise (unchanged field name, unchanged downstream
 * consumers — Field Agent earning, both cancel paths,
 * RefundExecutionService, both frontends — all keep reading that exact
 * field regardless of how its value was produced).
 *
 * Same DRAFT -> PUBLISHED -> RETIRED lifecycle as GstPolicyVersion /
 * CommercialPolicyVersion, scoped per Area instead of global: at most
 * one PUBLISHED fee per areaRef at a time.
 *
 * A booking resolves and snapshots the fee amount at lockSlot time
 * (booking.controller.js) via Salon.location.territory.areaRef — the
 * client never supplies an area or a fee amount. Publishing a new fee
 * for an area only ever affects bookings locked after that publish;
 * historical bookings keep whatever was resolved at the time.
 *
 * Deliberately does NOT model District/City/AreaSet scoping tiers
 * (unlike the structurally similar but unrelated
 * modules/fieldAgent/models/CommercialPolicyOverride.js) — the locked
 * V1 business requirement is area-only, and introducing broader tiers
 * here would be scope creep against that explicit instruction.
 */

import mongoose from "mongoose";

export const AREA_PLATFORM_FEE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

const areaPlatformFeePolicySchema = new mongoose.Schema(
  {
    areaRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Area",
      required: true,
    },

    feeInPaise: {
      type: Number,
      required: true,
      min: [0, "feeInPaise cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "feeInPaise must be a whole number (paise, not rupees)",
      },
    },

    status: {
      type: String,
      enum: Object.values(AREA_PLATFORM_FEE_STATUS),
      default: AREA_PLATFORM_FEE_STATUS.DRAFT,
      required: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one PUBLISHED fee per area at a time — MongoDB-enforced.
areaPlatformFeePolicySchema.index(
  { areaRef: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: AREA_PLATFORM_FEE_STATUS.PUBLISHED },
  }
);

// Non-unique — supports the admin history view's "all versions for
// this area, newest first" query without scanning the whole collection.
areaPlatformFeePolicySchema.index({ areaRef: 1, createdAt: -1 });

export default mongoose.models.AreaPlatformFeePolicy ||
  mongoose.model("AreaPlatformFeePolicy", areaPlatformFeePolicySchema);
