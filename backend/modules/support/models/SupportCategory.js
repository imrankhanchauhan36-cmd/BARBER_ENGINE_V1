/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportCategory.js
 *
 * Phase C — Support Core. Frozen per Phase B §5.
 *
 * Deliberately a real collection, not a hardcoded enum (requirement
 * #16) — admin-configurable, self-referencing parentCategoryRef
 * allows future sub-categories without a schema change.
 */

import mongoose from "mongoose";

const supportCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 50 },
    description: { type: String, default: null, maxlength: 500 },

    parentCategoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportCategory",
      default: null,
    },

    // Phase H Step 1 — classification only, for the future Verification
    // Resolver to know which authoritative domain a category's tickets
    // belong to. NOT a verification result, NOT copied onto
    // SupportTicket, and not read by any code yet — purely additive
    // metadata on the taxonomy Support already owns. Nullable exactly
    // like Booking.cancellationPolicy's own enum (null included in the
    // enum array itself, the existing convention in this codebase for
    // an optional-but-constrained string field), so every existing
    // category is unaffected until an admin explicitly classifies it.
    // Domain list is the exact set confirmed to exist as real business
    // domains in this repository (Phase H Step 1 audit) — no invented
    // domain, no Refund/Order/Subscription/Dispute (all confirmed NOT
    // FOUND as standalone domains).
    businessDomain: {
      type: String,
      default: null,
      enum: [null, "PAYMENT", "BOOKING", "WALLET", "PAYOUT", "USER", "SALON", "SERVICE"],
    },

    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

supportCategorySchema.index({ code: 1 }, { unique: true });

export default mongoose.models.SupportCategory || mongoose.model("SupportCategory", supportCategorySchema);
