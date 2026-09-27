/**
 * BARBER ENGINE V1
 * backend/modules/finance/models/RevenueSettings.js
 *
 * P0 Revenue Calculation Engine — Step 1. PAN-India revenue configuration:
 * the Platform ("Convenience") Fee and GST rate every booking's customer
 * price is calculated from, plus the payout knobs listed in the LOCKED
 * spec. Config-driven, never hardcoded — see revenue.constants.js's own
 * header.
 *
 * Same DRAFT -> PUBLISHED -> RETIRED lifecycle, and the exact same
 * "at most one PUBLISHED version, MongoDB-enforced via a partial unique
 * index" idiom already proven by GstPolicyVersion.js,
 * AreaPlatformFeePolicy.js and CommercialPolicyVersion.js. Publish/retire
 * discipline (never mutate a PUBLISHED/RETIRED row; a rate change is
 * always a new DRAFT, then a publish that atomically retires the prior
 * PUBLISHED row) belongs to the future RevenueSettingsService — this file
 * only defines the shape and the DB-level invariant.
 *
 * IMMUTABILITY OF PAST BOOKINGS (LOCKED business rule): a RevenueSplit
 * (see RevenueSplit.js) snapshots policyVersion = this document's `version`
 * number at calculation time and is never recalculated — publishing a new
 * RevenueSettings version can only ever affect bookings priced AFTER that
 * publish. This model itself enforces nothing about that; it is the
 * reason RevenueSplit exists as a separate, immutable collection instead
 * of Booking re-reading this document live.
 *
 * OUT OF SCOPE for Step 1 (per the ticket's explicit "do not touch"
 * list): nothing here reads or writes Wallet, WalletLedger, Razorpay,
 * Cashfree, Booking, Salon payout or Field Agent payout. No route,
 * controller or service reads this model yet — RevenueCalculationService
 * takes a RevenueSettings object as a plain input parameter, never fetches
 * one itself (see that file's own header).
 */

import mongoose from "mongoose";
import {
  REVENUE_SETTINGS_STATUS,
  PLATFORM_FEE_MIN_PAISE,
  GST_RATE_MIN_PERCENT,
  GST_RATE_MAX_PERCENT,
  MINIMUM_PAYOUT_MIN_PAISE,
} from "../constants/revenue.constants.js";

const integerPaiseValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be a whole number (paise, not rupees)",
};

const revenueSettingsSchema = new mongoose.Schema(
  {
    // Customer-facing "Convenience Fee" / "Platform Fee" — the LOCKED
    // formula's second term. Named platformFeeInPaise (not
    // convenienceFeeInPaise) to match the field name the ticket's own
    // RevenueSettings field list specifies.
    platformFeeInPaise: {
      type: Number,
      required: true,
      min: [PLATFORM_FEE_MIN_PAISE, "platformFeeInPaise cannot be negative"],
      validate: integerPaiseValidator,
    },

    // Percentage, e.g. 18 = 18%. Applied ONLY to platformFeeInPaise — the
    // LOCKED business rule ("GST applies only on Platform Fee") is
    // enforced in RevenueCalculationService, not here; this field is pure
    // configuration.
    gstRate: {
      type: Number,
      required: true,
      min: [GST_RATE_MIN_PERCENT, "gstRate cannot be negative"],
      max: [GST_RATE_MAX_PERCENT, "gstRate cannot exceed 100"],
    },

    // Whether GST is applied at all. When false, RevenueCalculationService
    // must treat gstAmountInPaise as 0 regardless of gstRate — kept as an
    // explicit switch (not just "set gstRate to 0") per the admin-panel
    // spec's own separate "GST Enabled ON" control.
    gstEnabled: {
      type: Boolean,
      required: true,
      default: true,
    },

    minimumPayoutInPaise: {
      type: Number,
      required: true,
      min: [MINIMUM_PAYOUT_MIN_PAISE, "minimumPayoutInPaise cannot be negative"],
      validate: integerPaiseValidator,
    },

    autoPayoutEnabled: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Monotonically increasing, human-readable version number — this is
    // the exact value snapshotted onto RevenueSplit.policyVersion, and the
    // number Support/Finance sees in "Booking A → Version 7" style audits.
    // Assigned by the future RevenueSettingsService (last version + 1),
    // never client-suppliable.
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: "version must be a whole number" },
    },

    status: {
      type: String,
      enum: Object.values(REVENUE_SETTINGS_STATUS),
      default: REVENUE_SETTINGS_STATUS.DRAFT,
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

// At most one PUBLISHED revenue settings version at a time —
// MongoDB-enforced, not application-level discipline. Same idiom as
// GstPolicyVersion / AreaPlatformFeePolicy / CommercialPolicyVersion.
revenueSettingsSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: REVENUE_SETTINGS_STATUS.PUBLISHED },
  }
);

// Every version number is unique — the same "last version + 1" resolver
// used elsewhere (commercialPolicy.service.js's createDraftPolicyVersion)
// relies on this to make a collision impossible even under a rare race
// (bounded-retry on the resulting E11000, exactly like that precedent).
revenueSettingsSchema.index({ version: 1 }, { unique: true });

export default mongoose.models.RevenueSettings ||
  mongoose.model("RevenueSettings", revenueSettingsSchema);
