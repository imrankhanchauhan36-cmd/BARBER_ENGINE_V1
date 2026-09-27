/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/GSTLedger.js
 *
 * P0 Revenue Calculation Engine — Step 4.1. The GST Ledger Engine: an
 * immutable, append-only record of GST collected (SALE) and — in a
 * future step — reversed (REFUND_REVERSAL) on a booking. This is the
 * durable government-liability record; it is NEVER recalculated and
 * NEVER edited, same immutability discipline as
 * modules/finance/models/RevenueSplit.js (Step 1) and
 * models/WalletLedger.js.
 *
 * READS ONLY FROM RevenueSplit (LOCKED rule: "Do NOT recalculate
 * anything. Read values ONLY from RevenueSplit."). This model performs
 * no calculation itself — GSTLedgerService.js snapshots values straight
 * off an already-created RevenueSplit document. No Wallet, no
 * WalletLedger, no Razorpay, no Booking write, anywhere in this file or
 * its service.
 *
 * bookingId / revenueSplitId — denormalized: bookingId is carried here
 * too (not just reachable via revenueSplitId) so a GST report can query
 * this collection directly by booking without an extra join/lookup,
 * mirroring RevenueSplit's own bookingId-first design.
 *
 * P0 Revenue Calculation Engine — Step 4.2 (GST Reversal Engine) —
 * minimal extension: `refundId`. SALE rows never set it (null); a
 * REFUND_REVERSAL row (GSTLedgerService.js#createRefundReversalLedger)
 * always does, and it is the sole "have we already reversed THIS refund"
 * identity — see the new partial unique index below. The existing
 * SALE-only unique index (revenueSplitId + ledgerType) is unchanged.
 */

import mongoose from "mongoose";
import { GST_LEDGER_TYPE, GST_LEDGER_STATUS } from "../constants/gstLedger.constants.js";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const gstLedgerSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
    },
    revenueSplitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RevenueSplit",
      required: true,
      immutable: true,
    },

    ledgerType: {
      type: String,
      enum: Object.values(GST_LEDGER_TYPE),
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: Object.values(GST_LEDGER_STATUS),
      required: true,
      immutable: true,
    },

    // The amount GST was actually computed on. LOCKED business rule: GST
    // applies only to the Platform Fee — so this always equals
    // platformFeeInPaise below, snapshotted as its own explicit field
    // (not derived at read time) because this document is the permanent
    // government-liability record and must remain self-describing even
    // if a future phase widens what GST is computed on.
    taxableValueInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },
    gstRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      immutable: true,
    },
    gstAmountInPaise: {
      type: Number,
      required: true,
      min: 1, // createSaleLedger() never creates a row for a zero/disabled GST split
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

    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },

    // Snapshotted verbatim from RevenueSplit.policyVersion — never
    // re-resolved, per the same "Booking A stays Version 7 forever"
    // guarantee RevenueSplit itself carries.
    policyVersion: {
      type: Number,
      required: true,
      immutable: true,
    },

    // Step 4.2 — the Razorpay gateway refund id (e.g. "rfnd_...") this
    // row reverses. Optional: null on every SALE row; always set on a
    // REFUND_REVERSAL row, and it is what makes "one reversal per
    // refundId" idempotent (see the partial unique index below).
    refundId: {
      type: String,
      default: null,
      immutable: true,
    },
  },
  { timestamps: true }
);

gstLedgerSchema.index({ bookingId: 1 });

// "One SALE ledger per RevenueSplit" — DB-enforced, partial so a future
// REFUND_REVERSAL row for the same revenueSplitId is never blocked by
// this constraint (which governs SALE rows only).
gstLedgerSchema.index(
  { revenueSplitId: 1, ledgerType: 1 },
  {
    unique: true,
    partialFilterExpression: { ledgerType: GST_LEDGER_TYPE.SALE },
  }
);

// Step 4.2 — "one reversal per refundId": DB-enforced, partial so it
// governs REFUND_REVERSAL rows only (the SALE index above is untouched
// and still governs SALE rows on its own key).
gstLedgerSchema.index(
  { refundId: 1, ledgerType: 1 },
  {
    unique: true,
    partialFilterExpression: { ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL },
  }
);

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE IMMUTABLE-AFTER-CREATION AT THE SCHEMA LEVEL
//
// Same idiom as RevenueSplit.js / WalletLedger.js: every field above is
// already `immutable: true` (blocks document.save() after a mutation),
// and these hooks additionally block every query-style mutation method,
// which bypasses per-field immutable checks.
//////////////////////////////////////////////////////////////

const blockMutation = function () {
  throw new Error("GSTLedger documents are immutable — they cannot be updated or deleted.");
};
gstLedgerSchema.pre("updateOne", blockMutation);
gstLedgerSchema.pre("updateMany", blockMutation);
gstLedgerSchema.pre("findOneAndUpdate", blockMutation);
gstLedgerSchema.pre("deleteOne", blockMutation);
gstLedgerSchema.pre("deleteMany", blockMutation);
gstLedgerSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.GSTLedger || mongoose.model("GSTLedger", gstLedgerSchema);
