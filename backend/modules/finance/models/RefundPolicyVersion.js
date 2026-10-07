/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/RefundPolicyVersion.js
 *
 * Global Refund & Cancellation Policy — the ONE admin-configured policy
 * that governs cancellation refund percentage identically for BOTH
 * customer-initiated and salon-initiated cancellation (no fault-based
 * override, no second engine — see CancellationPolicyService.js, the
 * single evaluation entry point this model feeds).
 *
 * New, isolated model — deliberately NOT merged into
 * CommercialPolicyVersion / AreaPlatformFeePolicy / GstPolicyVersion.
 *
 * Same DRAFT -> PUBLISHED -> RETIRED lifecycle, same partial-unique-
 * index-on-PUBLISHED discipline, as every other commercial policy
 * version in this codebase (GstPolicyVersion, AreaPlatformFeePolicy,
 * TerritoryRevenueSettings).
 *
 * `rules` — ordered array of {minMinutes, maxMinutes, cancellationPercent}.
 *
 * ⚠️ FIELD SEMANTICS (LOCKED, corrected 2026-10 — read before touching
 * this file): `cancellationPercent` is the CANCELLATION/RETENTION/
 * PENALTY percentage — the share of each applicable component the
 * admin configures to be FORFEITED (kept by its original owner —
 * salon/Zemish/GST), NOT the customer's refund percentage. The
 * customer's actual refund fraction is always
 * `1 - cancellationPercent/100`, computed in CancellationPolicyService.js,
 * never stored here directly. An earlier version of this file named
 * this field `refundPercent` with the opposite meaning (customer
 * refund %) — that was a genuine business-semantics bug, corrected
 * before this model ever reached production (no real
 * RefundPolicyVersion was ever published under the old field name —
 * every existing row was this feature's own disposable E2E test data
 * — so this is a straight rename, not a migration).
 *
 * Example: cancellationPercent: 25 means a 25% cancellation hit — the
 * customer gets back 75% of every applicable component, and 25% is
 * retained by the salon (service)/Zemish (Platform Fee)/GST ledger
 * (liability), per booking's own frozen snapshot.
 *
 * Boundary semantics (LOCKED, enforced in RefundPolicyService.js, not
 * here — same "service-layer validation, not a Mongoose cross-field
 * validator" precedent as AreaPlatformFeePolicy's own slabs, see that
 * model's header for the AREA-2.4.1 rationale): each rule's lower
 * bound (minMinutes) is INCLUSIVE; rules must be ascending, gapless,
 * non-overlapping; the first rule must start at minMinutes:0; the
 * last rule must have maxMinutes:null (unlimited). This reproduces
 * the pre-existing hardcoded customer-refund behavior exactly
 * (minutes-until-start >=120 -> 100% refund, >=30 -> 50% refund, else
 * -> 0% refund) via the INVERTED cancellationPercent values:
 * [{0,29,100},{30,119,50},{120,null,0}] — 0-29min is a 100%
 * cancellation hit (0% refund), 120+min is a 0% cancellation hit
 * (100% refund).
 */

import mongoose from "mongoose";

export const REFUND_POLICY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

const refundPolicyRuleSchema = new mongoose.Schema(
  {
    minMinutes: {
      type: Number,
      required: true,
      min: [0, "minMinutes cannot be negative"],
      validate: { validator: Number.isInteger, message: "minMinutes must be a whole number" },
    },
    // null = unlimited — only the structurally-last rule may use this
    // (same convention as AreaPlatformFeePolicy.slabs.maxAmountInPaise).
    maxMinutes: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "maxMinutes must be a whole number or null (unlimited)",
      },
    },
    // The CANCELLATION/RETENTION percentage — see file header. NOT
    // the customer refund percentage.
    cancellationPercent: {
      type: Number,
      required: true,
      min: [0, "cancellationPercent cannot be negative"],
      max: [100, "cancellationPercent cannot exceed 100"],
      validate: { validator: Number.isInteger, message: "cancellationPercent must be a whole integer percent" },
    },
  },
  { _id: false }
);

const refundPolicyVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, unique: true },

    rules: {
      type: [refundPolicyRuleSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "rules must be a non-empty array",
      },
    },

    status: {
      type: String,
      enum: Object.values(REFUND_POLICY_STATUS),
      default: REFUND_POLICY_STATUS.DRAFT,
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

// At most one PUBLISHED refund policy ever exists — MongoDB-enforced,
// same partial-unique idiom as every sibling policy model.
refundPolicyVersionSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: REFUND_POLICY_STATUS.PUBLISHED } }
);

export default mongoose.models.RefundPolicyVersion ||
  mongoose.model("RefundPolicyVersion", refundPolicyVersionSchema);
