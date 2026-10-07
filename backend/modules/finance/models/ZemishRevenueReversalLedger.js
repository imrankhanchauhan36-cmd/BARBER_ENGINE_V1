/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/ZemishRevenueReversalLedger.js
 *
 * Global Refund & Cancellation Policy — closes the pre-existing gap
 * where Zemish's own Platform Fee revenue (RevenueSplit.zemishRevenueInPaise)
 * had no reversal mechanism at all (unlike GST, which already has
 * GSTLedger's REFUND_REVERSAL row, and unlike Territory Partner, which
 * already has TerritoryRevenueLedger's own reversal). Uses the
 * EXISTING RevenueSplit as its sole read-only source — this file never
 * recalculates revenue, it only snapshots a proportional reversal of
 * an already-frozen RevenueSplit.zemishRevenueInPaise. The original
 * RevenueSplit is never touched (it is immutable by its own schema) —
 * a refund always creates a NEW row here, never an edit.
 *
 * Structurally identical idiom to modules/finance/models/GSTLedger.js
 * (immutable, append-only, blockMutation hooks on every mutation
 * method) and modules/finance/models/TerritoryRevenueLedger.js.
 *
 * One row per cancelled booking (ledgerType is always REFUND_REVERSAL
 * — there is no separate SALE row here; RevenueSplit itself is already
 * the immutable "sale" record this reverses). `reversalKey` is this
 * ledger's own idempotency key — NOT necessarily a real Razorpay
 * refund id, because the wallet-refund cancellation path (the default,
 * most common path) never creates a gateway Refund document at all.
 * See RefundReversalService.js for the exact key convention used by
 * each caller.
 */

import mongoose from "mongoose";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const zemishRevenueReversalLedgerSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, immutable: true },
    revenueSplitId: { type: mongoose.Schema.Types.ObjectId, ref: "RevenueSplit", required: true, immutable: true },

    // The fraction of the original RevenueSplit.zemishRevenueInPaise
    // this row reverses — copied from the same refundFractionApplied
    // CancellationPolicyService produced for this booking's refund
    // (never independently derived).
    refundFraction: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      immutable: true,
    },

    // Verbatim apportionment of RevenueSplit.zemishRevenueInPaise by
    // refundFraction — never recalculated from live config.
    reversedAmountInPaise: {
      type: Number,
      required: true,
      min: 1, // a zero-value reversal is never created (see service)
      validate: integerPaiseValidator,
      immutable: true,
    },

    // This ledger's own idempotency key — see file header. Unique per
    // row (one reversal per cancelled booking).
    reversalKey: { type: String, required: true, immutable: true },

    reversedAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  { timestamps: true }
);

zemishRevenueReversalLedgerSchema.index({ bookingId: 1 });
zemishRevenueReversalLedgerSchema.index({ revenueSplitId: 1 }, { unique: true });
zemishRevenueReversalLedgerSchema.index({ reversalKey: 1 }, { unique: true });

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE IMMUTABLE-AFTER-CREATION AT THE SCHEMA LEVEL
// Same idiom as GSTLedger.js / RevenueSplit.js / WalletLedger.js.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("ZemishRevenueReversalLedger documents are immutable — they cannot be updated or deleted.");
};
zemishRevenueReversalLedgerSchema.pre("updateOne", blockMutation);
zemishRevenueReversalLedgerSchema.pre("updateMany", blockMutation);
zemishRevenueReversalLedgerSchema.pre("findOneAndUpdate", blockMutation);
zemishRevenueReversalLedgerSchema.pre("deleteOne", blockMutation);
zemishRevenueReversalLedgerSchema.pre("deleteMany", blockMutation);
zemishRevenueReversalLedgerSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.ZemishRevenueReversalLedger ||
  mongoose.model("ZemishRevenueReversalLedger", zemishRevenueReversalLedgerSchema);
