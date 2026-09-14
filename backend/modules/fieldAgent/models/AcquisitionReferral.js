/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/AcquisitionReferral.js
 *
 * FA-5.3 — a Field Agent's acquisition INTENT, issued before any Salon
 * exists. This is the "controlled workflow" bridge: an agent can never
 * type or select an arbitrary existing salonId to claim (see
 * AcquisitionClaim.js's own header) — they can only issue an opaque
 * code representing their own intent, which some Salon Owner, acting
 * in their own authenticated session, chooses to redeem against their
 * own Salon (see acquisitionClaim.service.js#redeemReferral).
 *
 * code is server-generated (AQ-YYYYMMDD-XXXXXX), globally unique,
 * immutable after creation. "Expired" is deliberately NOT a stored
 * status — see acquisitionClaim.constants.js's own header for why.
 */

import mongoose from "mongoose";
import { REFERRAL_STATUS } from "../constants/acquisitionClaim.constants.js";

const AcquisitionReferralSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
    },

    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(REFERRAL_STATUS),
      required: true,
      default: REFERRAL_STATUS.ISSUED,
    },

    consumedSalonRef: { type: mongoose.Schema.Types.ObjectId, ref: "Salon", default: null },
    consumedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// "My referrals" listing.
AcquisitionReferralSchema.index({ fieldAgentRef: 1, status: 1 });

export default mongoose.models.AcquisitionReferral ||
  mongoose.model("AcquisitionReferral", AcquisitionReferralSchema);
