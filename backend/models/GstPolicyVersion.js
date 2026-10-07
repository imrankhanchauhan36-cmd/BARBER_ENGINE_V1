/**
 * BARBER ENGINE V1
 * backend/models/GstPolicyVersion.js
 *
 * PAN-India GST configuration, versioned. Exact DRAFT -> PUBLISHED ->
 * RETIRED lifecycle and "at most one PUBLISHED" partial-unique-index
 * idiom as modules/fieldAgent/models/CommercialPolicyVersion.js (same
 * proven pattern, different bounded context).
 *
 * A booking snapshots gstRatePercent/gstAmountInPaise onto itself at
 * lockSlot time (booking.controller.js) — this document is never read
 * again for an existing booking, so publishing a new rate here can
 * never retroactively change a past booking's GST.
 *
 * SALON GST LAUNCH PHASE (2026-10): replaced the single flat
 * `ratePercent` with two rates — `registeredRatePercent` (salons with
 * GST registration) and `unregisteredRatePercent` (salons without).
 * Launch values: registered=5, unregistered=0. Both are schema-
 * required with no default, so every NEW write must state both
 * explicitly (same "no silent single-rate fallback" discipline as
 * Platform Fee's `scope`/`calculationType` additions) — this is
 * deliberate: a document missing either rate must never be mistaken
 * for a valid 2-rate policy. A pre-existing PUBLISHED document from
 * before this change (old single-rate shape, `ratePercent` only) is
 * untouched by this migration — never backfilled, never deleted — but
 * is also structurally incapable of satisfying the new required
 * fields, so services/gstPolicy.service.js#getPublishedGstPolicy
 * treats such a document as "no usable GST policy" (returns null,
 * same as no policy published at all) rather than computing with an
 * undefined rate. GST NEVER blocks a booking — see that function's
 * own header for the full reasoning.
 *
 * No CGST/SGST/IGST breakup — two flat rates, per the locked business
 * rule for this phase. ratePercent itself is intentionally NOT kept
 * as a legacy field on the schema (nothing should be able to write it
 * again); any already-stored legacy value on an old document is
 * simply inert data the schema no longer declares.
 */

import mongoose from "mongoose";

export const GST_POLICY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

const gstPolicyVersionSchema = new mongoose.Schema(
  {
    registeredRatePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    unregisteredRatePercent: {
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
