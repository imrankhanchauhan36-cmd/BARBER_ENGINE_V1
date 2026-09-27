/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/TerritoryRevenueSettings.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine. A completely isolated
 * admin-configured module for Territory Partner commission, per the
 * ticket's own field list. Same DRAFT -> PUBLISHED -> RETIRED lifecycle
 * and the same "at most one PUBLISHED version, MongoDB-enforced via a
 * partial unique index" idiom already proven by GstPolicyVersion.js,
 * AreaPlatformFeePolicy.js, CommercialPolicyVersion.js and
 * modules/finance/models/RevenueSettings.js (the closest structural
 * template, per the STEP 5.1 audit's own recommendation).
 *
 * LOCKED — this module does NOT modify, read, or write:
 * RevenueSettings, RevenueSplit, GstLedger/GstReport, Razorpay,
 * Refund Engine, the Field Agent Acquisition Engine, Wallet, or Booking.
 * It also does NOT touch CommercialPolicyVersion or
 * CommercialPolicyOverride (the pre-existing, separately-owned
 * territoryPartnerCommissionPercent field flagged in the STEP 5.1
 * read-only audit) — this is a deliberately separate system per the
 * ticket's own "completely isolated module" instruction, not a
 * migration or replacement of that field. Nothing outside this module
 * reads TerritoryRevenueSettings yet.
 */

import mongoose from "mongoose";
import {
  TERRITORY_REVENUE_STATUS,
  TERRITORY_COMMISSION_MIN_PERCENT,
  TERRITORY_COMMISSION_MAX_PERCENT,
  TERRITORY_MINIMUM_PAYOUT_MIN_PAISE,
} from "../constants/territoryRevenue.constants.js";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const territoryRevenueSettingsSchema = new mongoose.Schema(
  {
    // Percentage, e.g. 8 = 8%. Pure configuration — this module performs
    // no calculation and credits no ledger; a future consumer would own
    // that logic, per the ticket's own scope.
    territoryCommissionPercent: {
      type: Number,
      required: true,
      min: [TERRITORY_COMMISSION_MIN_PERCENT, "territoryCommissionPercent cannot be negative"],
      max: [TERRITORY_COMMISSION_MAX_PERCENT, "territoryCommissionPercent cannot exceed 100"],
    },

    minimumPayoutInPaise: {
      type: Number,
      required: true,
      min: [TERRITORY_MINIMUM_PAYOUT_MIN_PAISE, "minimumPayoutInPaise cannot be negative"],
      validate: integerPaiseValidator,
    },

    // Monotonically increasing, human-readable version number. Assigned
    // by TerritoryRevenueSettingsService (last version + 1), never
    // client-suppliable — same idiom as RevenueSettings.version.
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: "version must be a whole number" },
    },

    status: {
      type: String,
      enum: Object.values(TERRITORY_REVENUE_STATUS),
      default: TERRITORY_REVENUE_STATUS.DRAFT,
      required: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Not in the ticket's own field list, but kept for the same audit
    // discipline every other DRAFT->PUBLISHED->RETIRED model in this
    // codebase already applies (publishedBy/retiredBy alongside
    // publishedAt/retiredAt) — additive only, never read by anything
    // outside this module.
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one PUBLISHED territory revenue settings version at a time —
// MongoDB-enforced, not application-level discipline. Same idiom as
// RevenueSettings / GstPolicyVersion / AreaPlatformFeePolicy /
// CommercialPolicyVersion.
territoryRevenueSettingsSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TERRITORY_REVENUE_STATUS.PUBLISHED },
  }
);

// Every version number is unique — the same "last version + 1" resolver
// used elsewhere relies on this to make a collision impossible even
// under a rare race (bounded-retry on the resulting E11000, exactly
// like RevenueSettingsService.createDraftRevenueSettings).
territoryRevenueSettingsSchema.index({ version: 1 }, { unique: true });

export default mongoose.models.TerritoryRevenueSettings ||
  mongoose.model("TerritoryRevenueSettings", territoryRevenueSettingsSchema);
