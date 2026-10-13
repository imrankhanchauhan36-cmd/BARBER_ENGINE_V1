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

    // The amount SERVICE GST was actually computed on — the SALON
    // SERVICE AMOUNT, never the Platform Fee (see the separate
    // platformFeeTaxableValueInPaise/platformFeeGstRate/
    // platformFeeGstAmountInPaise trio below for the Platform Fee's
    // OWN, independent GST charge). CORRECTED 2026-10-12: this field
    // previously carried the comment "GST applies only to the
    // Platform Fee — so this always equals platformFeeInPaise below"
    // and GSTLedgerService.js hardcoded it to platformFeeInPaise —
    // that was a stale assumption inherited from a retired pricing
    // engine (RevenueCalculationService.js) and never matched what
    // gstAmountInPaise was actually computed from once the Salon GST
    // Launch phase moved service GST onto the service amount. Rows
    // created before this fix keep their original (incorrect) value —
    // never retroactively corrected, per this collection's own
    // immutability discipline — only new rows are correct going
    // forward. Nullable (not required): a historical booking with no
    // GST policy ever published has null service GST (Booking's own
    // null-vs-zero convention) — a row can still exist purely because
    // Platform-Fee GST was collected (see below).
    taxableValueInPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || (Number.isInteger(v) && v >= 0),
        message: "{PATH} must be a non-negative whole number (paise) or null",
      },
      immutable: true,
    },
    gstRate: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
      immutable: true,
    },
    // No longer `min: 1` (createSaleLedger() can now create a row with
    // gstAmountInPaise === 0 when ONLY Platform-Fee GST was collected
    // — an unregistered salon's booking, for example) — the decision
    // of whether a row gets created at all now lives entirely in
    // createSaleLedger()'s own check across BOTH GST components, not
    // in this field's own minimum.
    gstAmountInPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || (Number.isInteger(v) && v >= 0),
        message: "{PATH} must be a non-negative whole number (paise) or null",
      },
      immutable: true,
    },
    platformFeeInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },

    // PLATFORM-FEE GST (additive, Phase 3) — a SEPARATE GST charge on
    // the Platform Fee itself (platformFeeInPaise above), independent
    // of the service-GST trio above. Nullable: null on any row/booking
    // that predates this feature (or, in principle, any future state
    // where platform-fee GST genuinely isn't configured) — never a
    // fabricated rate/amount.
    platformFeeTaxableValueInPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || (Number.isInteger(v) && v >= 0),
        message: "{PATH} must be a non-negative whole number (paise) or null",
      },
      immutable: true,
    },
    platformFeeGstRate: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
      immutable: true,
    },
    platformFeeGstAmountInPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || (Number.isInteger(v) && v >= 0),
        message: "{PATH} must be a non-negative whole number (paise) or null",
      },
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
    //
    // STEP 8.2 (reviewed) — Pricing Engine Unification.
    // RevenueSplit.policyVersion is kept required and is now a fixed
    // engine-generation marker rather than a RevenueSettings version
    // (see RevenueSplit.js's own comment) — always a real number, never
    // null. Reverted back to required here for exactly that reason:
    // GSTLedgerService.js is unchanged, still copies this field
    // verbatim, unmodified, per its own "never recalculate" rule, and
    // it will always receive a valid number to copy.
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
