/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/RevenueSplit.js
 *
 * P0 Revenue Calculation Engine — Step 1. The immutable, per-booking
 * snapshot of a RevenueCalculationService.calculateRevenue() result.
 *
 * WHY THIS COLLECTION EXISTS (LOCKED architecture): RevenueSettings is
 * versioned and can change at any time (an admin republishing a new
 * platformFeeInPaise/gstRate). A booking's actual price must never
 * silently move when that happens — "Uber/Zomato/Swiggy industry
 * standard," per the ticket. RevenueSplit is the durable, never-edited
 * record of exactly what was calculated for one booking, at the
 * policyVersion that was PUBLISHED at that moment. It is written once and
 * read forever after — the sole source of truth for that booking's
 * finance breakdown, GST liability and Zemish revenue, for as long as the
 * booking exists.
 *
 * SCOPE (Step 1, per the ticket's explicit "do not touch" list): this
 * model is a pure data shape. Nothing in this step ever creates a
 * RevenueSplit document from a real booking, touches Wallet/Ledger, or is
 * wired into Booking/lockSlot/confirmBooking. That wiring (and the
 * decision of WHEN a split is created relative to the booking lifecycle)
 * is explicitly a later step. This file exists now only so
 * RevenueCalculationService's return shape has a concrete, typed home to
 * eventually be persisted into — the calculation service itself performs
 * NO database writes (see that file's own header).
 *
 * IMMUTABILITY, enforced at the schema level (not just convention) —
 * exact same idiom as models/WalletLedger.js's own append-only guard:
 * once created, a RevenueSplit can never be updated or deleted. A policy
 * correction is always a NEW booking's new split under a NEW published
 * version, never an edit of history.
 */

import mongoose from "mongoose";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const revenueSplitSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
    },

    // ── Inputs, snapshotted ─────────────────────────────────────────
    serviceAmountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },
    platformFeeInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },
    gstRatePercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      immutable: true,
    },

    // ── Calculated outputs ──────────────────────────────────────────
    gstAmountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },
    customerPaidInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },

    // ── Split (LOCKED business rule) ────────────────────────────────
    // salonCreditInPaise === serviceAmountInPaise and
    // zemishRevenueInPaise === platformFeeInPaise today (the LOCKED
    // formula has nowhere else for the money to go) — stored as their
    // own explicit fields anyway, not derived at read time, because this
    // document is the permanent audit/finance record and must remain
    // self-describing even if a future phase changes what feeds the
    // split (e.g. a promo discount absorbed by Zemish) without touching
    // historical rows.
    salonCreditInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },
    zemishRevenueInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },

    // STEP 8.2 (reviewed) — Pricing Engine Unification. Previously the
    // RevenueSettings.version this split was calculated against.
    // RevenueSettings is no longer read here at all (Booking is now the
    // sole pricing source of truth — see
    // RevenueSplitIntegrationService.js), and neither
    // AreaPlatformFeePolicy nor GstPolicyVersion carries a numeric
    // "version" to put here instead — so this field is kept required,
    // but repurposed as a fixed engine-generation marker (see
    // RevenueSplitIntegrationService.js's own
    // REVENUE_SPLIT_ENGINE_GENERATION constant), not a real version
    // count. Real policy traceability now lives in the two fields below
    // instead. A historical row created under the old RevenueSettings-
    // driven engine (if any exist outside this Dev environment) keeps
    // its own original integer untouched — this schema change does not
    // touch existing documents, only what a NEW one may contain.
    policyVersion: {
      type: Number,
      required: true,
      immutable: true,
    },

    // STEP 8.2 (reviewed) — real audit-trail traceability, copied
    // VERBATIM from Booking.platformFeePolicyRef/gstPolicyVersionRef
    // (never independently resolved here, never from a RevenueSettings
    // lookup). null exactly when the booking itself has null there (no
    // area assigned / no GST ever published at lockSlot time) — same
    // null-vs-"never applied" convention Booking already uses.
    platformFeePolicyRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AreaPlatformFeePolicy",
      default: null,
      immutable: true,
    },
    gstPolicyVersionRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GstPolicyVersion",
      default: null,
      immutable: true,
    },
  },
  { timestamps: true }
);

// One split per booking — a booking is priced once. Enforced at the DB
// level so a future caller cannot accidentally create two splits for the
// same booking even under a race.
revenueSplitSchema.index({ bookingId: 1 }, { unique: true });
revenueSplitSchema.index({ policyVersion: 1 });

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE IMMUTABLE-AFTER-CREATION AT THE SCHEMA LEVEL
//
// Same idiom as models/WalletLedger.js: a RevenueSplit must never be
// updated or deleted once written. `immutable: true` on every field
// above already blocks document.save() from changing them; these hooks
// additionally block the query-style mutation methods, which bypass
// per-field immutable checks.
//////////////////////////////////////////////////////////////

const blockMutation = function () {
  throw new Error("RevenueSplit documents are immutable — they cannot be updated or deleted.");
};
revenueSplitSchema.pre("updateOne", blockMutation);
revenueSplitSchema.pre("updateMany", blockMutation);
revenueSplitSchema.pre("findOneAndUpdate", blockMutation);
revenueSplitSchema.pre("deleteOne", blockMutation);
revenueSplitSchema.pre("deleteMany", blockMutation);
revenueSplitSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.RevenueSplit ||
  mongoose.model("RevenueSplit", revenueSplitSchema);
