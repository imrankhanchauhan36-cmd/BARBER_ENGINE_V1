/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/CommercialPolicyVersion.js
 *
 * FA-5.1 — the versioned, admin-authored source of every configurable
 * commercial number/rule FA-5 needs (acquisition incentive amount,
 * territory partner commission %, license term, claim expiry,
 * obligations/performance/coverage rules). Exact DRAFT -> PUBLISHED ->
 * RETIRED lifecycle as TestVersion/TrainingVersion — same immutability
 * discipline (published/retired never mutate; a correction is a new
 * DRAFT version), same "at most one PUBLISHED" partial-unique-index
 * guarantee.
 *
 * FA-5 Architecture Decision Lock §11 (pinning): a future
 * TerritoryPartnerLicense pins this version's values at ISSUANCE; a
 * future SalonAttribution pins the values at ATTRIBUTION. Neither is
 * implemented in FA-5.1 — this model only has to exist, version
 * correctly, and never retroactively mutate a value a later phase has
 * already pinned. No such pinning consumer exists yet in this phase.
 *
 * FA-5.1 does NOT calculate, reserve, or move money. This document is
 * configuration only — see commercialPolicy.service.js's own header
 * for the explicit financial boundary.
 */

import mongoose from "mongoose";
import {
  COMMERCIAL_POLICY_STATUS,
  ACQUISITION_INCENTIVE_MIN_PAISE,
  TERRITORY_COMMISSION_PERCENT_MIN,
  TERRITORY_COMMISSION_PERCENT_MAX,
  LICENSE_TERM_MONTHS_MIN,
  CLAIM_EXPIRY_DAYS_MIN,
  POLICY_ITEM_KEY_MAX_LENGTH,
  POLICY_ITEM_DESCRIPTION_MAX_LENGTH,
} from "../constants/commercialPolicy.constants.js";

// Explicit, structured, validated shape — never an unrestricted
// arbitrary Mongo object (FA-5 Architecture Decision Lock §7). Reused
// for obligations/performanceFactors/coverageRules — each is a
// business-configurable LIST of these, not a free-form document.
const policyItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: POLICY_ITEM_KEY_MAX_LENGTH },
    description: { type: String, required: true, trim: true, maxlength: POLICY_ITEM_DESCRIPTION_MAX_LENGTH },
  },
  { _id: false }
);

const commercialPolicyVersionSchema = new mongoose.Schema(
  {
    versionNumber: {
      type: Number,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: Object.values(COMMERCIAL_POLICY_STATUS),
      default: COMMERCIAL_POLICY_STATUS.DRAFT,
      required: true,
    },

    // Path A — Acquisition Agent's one-time incentive. RESERVED as of
    // FA-8: retained for historical/schema compatibility, currently
    // NOT consumed by any Field Agent earning engine. The FA-8 audit
    // found this flat one-time amount does not represent the approved
    // percentage-of-commission-until-cap earning model (see
    // acquisitionAgentCommissionPercent / acquisitionEarningTargetInPaise
    // below); it is deliberately not renamed, deleted, or reinterpreted
    // as either of those. Any future use requires an explicit,
    // separate business decision. No longer required — production
    // CommercialPolicyVersion count was zero at the time this was
    // relaxed, so no migration was needed.
    acquisitionIncentiveAmountInPaise: {
      type: Number,
      required: false,
      min: ACQUISITION_INCENTIVE_MIN_PAISE,
      validate: {
        validator: Number.isInteger,
        message: "acquisitionIncentiveAmountInPaise must be a whole number (paise, not rupees)",
      },
    },

    // FA-8 — Acquisition Agent's ongoing per-booking commission rate,
    // a percentage of the authoritative Booking.commissionAmountInPaise
    // (this file never reads that field itself — see file header),
    // mirroring territoryPartnerCommissionPercent's own semantics
    // exactly. Earned only from eligible booking-generated ZEMISH
    // economics, never an upfront payment — the eligibility/accrual/cap
    // mechanics themselves are explicitly out of scope for this model
    // (a future earning engine's concern, not configuration).
    acquisitionAgentCommissionPercent: {
      type: Number,
      required: true,
      min: TERRITORY_COMMISSION_PERCENT_MIN,
      max: TERRITORY_COMMISSION_PERCENT_MAX,
    },

    // FA-8 — the nationally configured cumulative acquisition earning
    // target/cap per salon, in paise. Once a salon's cumulative
    // Acquisition Agent earning (tracked by a future earning engine,
    // not here) reaches this amount, that agent's acquisition earning
    // entitlement for that salon ends. This model holds only the
    // configured number — per-salon progress against it is explicitly
    // out of scope here.
    acquisitionEarningTargetInPaise: {
      type: Number,
      required: true,
      min: ACQUISITION_INCENTIVE_MIN_PAISE,
      validate: {
        validator: Number.isInteger,
        message: "acquisitionEarningTargetInPaise must be a whole number (paise, not rupees)",
      },
    },

    // Path B — Territory Partner's ongoing commission rate, a
    // percentage of the authoritative Booking.commissionAmountInPaise
    // (FA-5.1 never reads that field itself — see file header).
    territoryPartnerCommissionPercent: {
      type: Number,
      required: true,
      min: TERRITORY_COMMISSION_PERCENT_MIN,
      max: TERRITORY_COMMISSION_PERCENT_MAX,
    },

    licenseTermMonths: {
      type: Number,
      required: true,
      min: LICENSE_TERM_MONTHS_MIN,
      validate: {
        validator: Number.isInteger,
        message: "licenseTermMonths must be a whole number of months",
      },
    },

    claimExpiryDays: {
      type: Number,
      required: true,
      min: CLAIM_EXPIRY_DAYS_MIN,
      validate: {
        validator: Number.isInteger,
        message: "claimExpiryDays must be a whole number of days",
      },
    },

    obligations: { type: [policyItemSchema], default: () => [] },
    performanceFactors: { type: [policyItemSchema], default: () => [] },
    coverageRules: { type: [policyItemSchema], default: () => [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one PUBLISHED version at a time — same partial-unique-index
// idiom as TestVersion/TrainingVersion.
commercialPolicyVersionSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: COMMERCIAL_POLICY_STATUS.PUBLISHED },
  }
);

export default mongoose.models.CommercialPolicyVersion ||
  mongoose.model("CommercialPolicyVersion", commercialPolicyVersionSchema);
