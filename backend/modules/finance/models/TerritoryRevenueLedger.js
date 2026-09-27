/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/TerritoryRevenueLedger.js
 *
 * STEP 5.3 — Territory Revenue Distribution Engine. An immutable,
 * append-only record of Territory Partner commission CREDITED (SALE)
 * and REVERSED (REFUND_REVERSAL) on a booking — mirrors
 * modules/finance/models/GSTLedger.js exactly (same "reuse existing
 * finance architecture" instruction), applied to Territory Partner
 * commission instead of GST liability.
 *
 * READS ONLY FROM TerritoryRevenueSplit (same "do not recalculate,
 * snapshot only" discipline as GSTLedgerService reading only from
 * RevenueSplit). No Wallet, no WalletLedger, no Razorpay, no Booking
 * write, no bank transfer — this is a pure internal accounting ledger
 * of what Zemish currently owes each Territory Partner. "Money stays in
 * Zemish until payout request" — SUM(SALE) − SUM(REFUND_REVERSAL) per
 * territoryPartnerRef is that outstanding balance; nothing in this
 * engine moves money anywhere.
 *
 * territoryRevenueSplitId / territoryPartnerRef — denormalized: a
 * Territory Partner's full ledger/balance can be queried directly by
 * territoryPartnerRef without an extra join, mirroring GSTLedger's own
 * bookingId-first design.
 *
 * refundId: null on every SALE row; always set on a REFUND_REVERSAL
 * row, and it is the sole "have we already reversed THIS refund"
 * identity — see the partial unique index below (identical shape to
 * GSTLedger's own refundId index).
 */

import mongoose from "mongoose";
import { TERRITORY_REVENUE_LEDGER_TYPE, TERRITORY_REVENUE_LEDGER_STATUS } from "../constants/territoryRevenueDistribution.constants.js";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const territoryRevenueLedgerSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
    },
    territoryRevenueSplitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TerritoryRevenueSplit",
      required: true,
      immutable: true,
    },
    territoryPartnerRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
      immutable: true,
    },

    ledgerType: {
      type: String,
      enum: Object.values(TERRITORY_REVENUE_LEDGER_TYPE),
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: Object.values(TERRITORY_REVENUE_LEDGER_STATUS),
      required: true,
      immutable: true,
    },

    // The ledger amount: the full territoryShareInPaise for a SALE row,
    // or the proportional apportionment (by refund fraction) for a
    // REFUND_REVERSAL row. Never negative — a reversal is its own
    // positive-magnitude row of type REFUND_REVERSAL, subtracted at
    // balance-read time, exactly like GSTLedger's own REFUND_REVERSAL
    // rows are never stored as negative numbers.
    amountInPaise: {
      type: Number,
      required: true,
      min: 1, // never a zero-value row — TerritoryRevenueService skips those entirely
      validate: integerPaiseValidator,
      immutable: true,
    },

    // Step 5.3's own reversal support — the Razorpay gateway refund id
    // this row reverses (see file header).
    refundId: {
      type: String,
      default: null,
      immutable: true,
    },
  },
  { timestamps: true }
);

territoryRevenueLedgerSchema.index({ bookingId: 1 });
territoryRevenueLedgerSchema.index({ territoryPartnerRef: 1, createdAt: -1 });

// "One SALE ledger per TerritoryRevenueSplit" — DB-enforced, partial so
// a future REFUND_REVERSAL row for the same split is never blocked.
territoryRevenueLedgerSchema.index(
  { territoryRevenueSplitId: 1, ledgerType: 1 },
  { unique: true, partialFilterExpression: { ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.SALE } }
);

// "One reversal per refundId" — DB-enforced, partial so it governs
// REFUND_REVERSAL rows only.
territoryRevenueLedgerSchema.index(
  { refundId: 1, ledgerType: 1 },
  { unique: true, partialFilterExpression: { ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.REFUND_REVERSAL } }
);

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE IMMUTABLE-AFTER-CREATION AT THE SCHEMA LEVEL
// Same idiom as GSTLedger.js / RevenueSplit.js / WalletLedger.js.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("TerritoryRevenueLedger documents are immutable — they cannot be updated or deleted.");
};
territoryRevenueLedgerSchema.pre("updateOne", blockMutation);
territoryRevenueLedgerSchema.pre("updateMany", blockMutation);
territoryRevenueLedgerSchema.pre("findOneAndUpdate", blockMutation);
territoryRevenueLedgerSchema.pre("deleteOne", blockMutation);
territoryRevenueLedgerSchema.pre("deleteMany", blockMutation);
territoryRevenueLedgerSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.TerritoryRevenueLedger ||
  mongoose.model("TerritoryRevenueLedger", territoryRevenueLedgerSchema);
