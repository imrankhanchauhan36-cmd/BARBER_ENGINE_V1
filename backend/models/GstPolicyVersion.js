/**
 * BARBER ENGINE V1
 * backend/models/GstPolicyVersion.js
 *
 * PAN-India GST configuration — one global rate, versioned. Exact
 * DRAFT -> PUBLISHED -> RETIRED lifecycle and "at most one PUBLISHED"
 * partial-unique-index idiom as
 * modules/fieldAgent/models/CommercialPolicyVersion.js (same proven
 * pattern, different bounded context — this file has no relationship
 * to the Field Agent commercial domain).
 *
 * A booking snapshots gstRatePercent/gstAmountInPaise onto itself at
 * lockSlot time (booking.controller.js) — this document is never read
 * again for an existing booking, so publishing a new rate here can
 * never retroactively change a past booking's GST.
 *
 * No CGST/SGST/IGST breakup in V1 — a single flat ratePercent, per the
 * locked business rule.
 */

import mongoose from "mongoose";

export const GST_POLICY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

const gstPolicyVersionSchema = new mongoose.Schema(
  {
    ratePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    status: {
      type: String,
      enum: Object.values(GST_POLICY_STATUS),
      default: GST_POLICY_STATUS.DRAFT,
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

// At most one PUBLISHED GST policy at a time — MongoDB-enforced, not
// application-level discipline. Same idiom as CommercialPolicyVersion.
gstPolicyVersionSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: GST_POLICY_STATUS.PUBLISHED },
  }
);

export default mongoose.models.GstPolicyVersion ||
  mongoose.model("GstPolicyVersion", gstPolicyVersionSchema);
