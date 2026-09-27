/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/TerritoryRevenueSplit.js
 *
 * STEP 5.3 — Territory Revenue Distribution Engine. The immutable,
 * per-booking snapshot of how much Territory Partner commission is owed
 * for one booking's RevenueSplit — same "IMMUTABILITY OF PAST BOOKINGS"
 * discipline as models/RevenueSplit.js itself: written once, read
 * forever after, never recalculated even if TerritoryRevenueSettings
 * (STEP 5.1) later publishes a new commission percentage or the salon's
 * SalonTerritoryAssignment (STEP 5.2) later changes.
 *
 * WHY THIS EXISTS SEPARATELY FROM RevenueSplit (LOCKED, untouched):
 * RevenueSplit's own schema is never modified — this is an entirely new,
 * additive collection, keyed by revenueSplitId, exactly the same
 * relationship GSTLedger already has to RevenueSplit (Step 4.1).
 *
 * WHERE THE BASE AMOUNT COMES FROM (baseAmountInPaise): Zemish's own
 * platform revenue for the booking — RevenueSplit.zemishRevenueInPaise —
 * never the salon's own salonCreditInPaise or the customer's total
 * customerPaidInPaise. This mirrors the existing, unmodified precedent
 * in modules/fieldAgent/services/fieldAgentEarning.service.js, where
 * territoryPartnerCommissionPercent is already applied to
 * booking.commissionAmountInPaise (Zemish's own commission from that
 * booking) — never to the salon's or customer's amounts. A Territory
 * Partner earns a cut of what ZEMISH earns for operating that
 * geography, not a cut of the salon's own earnings.
 *
 * ONLY created when BOTH of these hold at RevenueSplit-creation time
 * (checked in TerritoryRevenueService.js, never here):
 *   - the booking's salon has an ACTIVE SalonTerritoryAssignment link
 *     (STEP 5.2 — read-only dependency, never written to)
 *   - a TerritoryRevenueSettings version is currently PUBLISHED
 *     (STEP 5.1 — read-only dependency, never written to)
 * If either is missing, no TerritoryRevenueSplit is created at all —
 * a safe no-op, not an error (same discipline as RevenueSplitIntegration
 * Service's own "no PUBLISHED RevenueSettings — skip" precedent).
 *
 * "Money stays in Zemish until payout request. No automatic bank
 * transfer." — this model (and its companion TerritoryRevenueLedger)
 * is a pure accounting record. It never touches Wallet, WalletLedger,
 * Razorpay, or any bank/payout API.
 */

import mongoose from "mongoose";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const territoryRevenueSplitSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
    },
    // Denormalized — not just reachable via bookingId — so this
    // collection can be queried directly by RevenueSplit, mirroring
    // GSTLedger's own bookingId+revenueSplitId dual-key design exactly.
    revenueSplitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RevenueSplit",
      required: true,
      immutable: true,
    },

    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      immutable: true,
    },

    // The Territory Partner (a FieldAgent) entitled to this commission —
    // resolved from SalonTerritoryAssignment (STEP 5.2) at
    // split-creation time and then frozen forever, same immutability
    // rationale as policyVersion below.
    territoryPartnerRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
      immutable: true,
    },
    // The CommercialTerritory (FA-5.2) this resolution came from —
    // denormalized for traceability/audit only, never re-read.
    territoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialTerritory",
      required: true,
      immutable: true,
    },

    // Zemish's own revenue for this booking (RevenueSplit.
    // zemishRevenueInPaise), snapshotted verbatim — see file header for
    // why this, not salonCreditInPaise or customerPaidInPaise, is the
    // base the commission percentage applies to.
    baseAmountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },

    // Snapshotted from TerritoryRevenueSettings' PUBLISHED version at
    // this exact moment — never re-resolved, per the same "Booking A
    // stays Version 7 forever" guarantee RevenueSplit.policyVersion
    // itself carries. Republishing a new commission % (STEP 5.1) can
    // only ever affect bookings priced AFTER that publish.
    territoryCommissionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      immutable: true,
    },
    territoryRevenueSettingsVersion: {
      type: Number,
      required: true,
      immutable: true,
    },

    // round(baseAmountInPaise * territoryCommissionPercent / 100) —
    // computed once, stored, never re-derived at read time (this
    // document is the permanent record).
    territoryShareInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPaiseValidator,
      immutable: true,
    },
  },
  { timestamps: true }
);

// One TerritoryRevenueSplit per RevenueSplit — the real idempotency
// backstop (TerritoryRevenueService's own pre-check is the fast path;
// this index is what makes a concurrent duplicate impossible).
territoryRevenueSplitSchema.index({ revenueSplitId: 1 }, { unique: true });

territoryRevenueSplitSchema.index({ bookingId: 1 });
territoryRevenueSplitSchema.index({ territoryPartnerRef: 1, createdAt: -1 });

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE IMMUTABLE-AFTER-CREATION AT THE SCHEMA LEVEL
// Same idiom as RevenueSplit.js / GSTLedger.js / WalletLedger.js.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("TerritoryRevenueSplit documents are immutable — they cannot be updated or deleted.");
};
territoryRevenueSplitSchema.pre("updateOne", blockMutation);
territoryRevenueSplitSchema.pre("updateMany", blockMutation);
territoryRevenueSplitSchema.pre("findOneAndUpdate", blockMutation);
territoryRevenueSplitSchema.pre("deleteOne", blockMutation);
territoryRevenueSplitSchema.pre("deleteMany", blockMutation);
territoryRevenueSplitSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.TerritoryRevenueSplit ||
  mongoose.model("TerritoryRevenueSplit", territoryRevenueSplitSchema);
