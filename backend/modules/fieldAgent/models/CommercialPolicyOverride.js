/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/CommercialPolicyOverride.js
 *
 * FA-9 — geography-scoped commercial policy, additive to (never a
 * modification of) the frozen national CommercialPolicyVersion (FA-8).
 * Answers "what rate/target applies in THIS geography", a genuinely
 * different question from CommercialTerritory's "who commercially
 * operates this geography" — deliberately a separate collection, never
 * a reuse/substitute for CommercialTerritory, Salon.location.territory,
 * or Area Serviceability (FA-9 Business Decision Lock report §5).
 *
 * scopeType/scopeKey/districtRef/cityRef/areaRefs mirror
 * CommercialTerritory's own proven shape exactly (same three scope
 * types, same "district always required, city/area conditionally
 * required" discipline, same server-computed canonical scopeKey) — see
 * commercialPolicyOverride.service.js#computeOverrideScopeKey. This is
 * pattern reuse, not collection reuse: CommercialTerritory itself is
 * never read or written by this model or its service.
 *
 * Lifecycle is DRAFT -> PUBLISHED -> RETIRED, mirroring
 * CommercialPolicyVersion's own exact discipline, but the "at most one
 * PUBLISHED" invariant is scoped PER exact scopeKey, not global —
 * publishing a new version of the SAME scopeKey auto-retires the prior
 * one (same auto-supersession commercialPolicy.service.js#publishPolicyVersion
 * already proves); publishing a DIFFERENT scopeKey that geographically
 * overlaps an existing PUBLISHED override is instead BLOCKED (mirrors
 * CommercialTerritory's own ACTIVE-vs-ACTIVE overlap prevention) — see
 * commercialPolicyOverride.service.js#publishPolicyOverride for both
 * mechanisms combined.
 *
 * Effective-time semantics are implicit, exactly like CommercialPolicyVersion:
 * publishedAt = effective start, retiredAt = effective end. No separate
 * effectiveFrom/effectiveUntil field is introduced (FA-9 corrected plan §7).
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): this file never reads
 * Booking, never computes a commission amount, never creates a ledger
 * entry. Configuration only — same boundary commercialPolicy.service.js's
 * own header already established for the national policy.
 */

import mongoose from "mongoose";
import { POLICY_OVERRIDE_SCOPE_TYPE, POLICY_OVERRIDE_STATUS } from "../constants/commercialPolicyOverride.constants.js";
import {
  ACQUISITION_INCENTIVE_MIN_PAISE,
  TERRITORY_COMMISSION_PERCENT_MIN,
  TERRITORY_COMMISSION_PERCENT_MAX,
} from "../constants/commercialPolicy.constants.js";

const CommercialPolicyOverrideSchema = new mongoose.Schema(
  {
    scopeType: {
      type: String,
      enum: Object.values(POLICY_OVERRIDE_SCOPE_TYPE),
      required: true,
    },

    // Server-computed canonical composition key — see
    // commercialPolicyOverride.service.js#computeOverrideScopeKey.
    // Used both for "no two DRAFT overrides with identical composition"
    // and for "at most one PUBLISHED override per exact scope".
    scopeKey: {
      type: String,
      required: true,
    },

    // versionNumber is a per-scopeKey sequence (bounded-retry
    // generated), NOT a global sequence — two different scopes can
    // both have a versionNumber of 1.
    versionNumber: {
      type: Number,
      required: true,
    },

    stateRef: { type: mongoose.Schema.Types.ObjectId, ref: "State", required: true },
    districtRef: { type: mongoose.Schema.Types.ObjectId, ref: "District", required: true },

    // Required for CITY/AREA_SET, null for DISTRICT — enforced in the
    // service layer (AREA-2.4.1 lesson: `this.scopeType` is unreliable
    // inside findOneAndUpdate).
    cityRef: { type: mongoose.Schema.Types.ObjectId, ref: "City", default: null },

    // Non-empty only for AREA_SET, [] otherwise.
    areaRefs: { type: [mongoose.Schema.Types.ObjectId], ref: "Area", default: [] },

    status: {
      type: String,
      enum: Object.values(POLICY_OVERRIDE_STATUS),
      default: POLICY_OVERRIDE_STATUS.DRAFT,
      required: true,
    },

    // Mirrors CommercialPolicyVersion's own three configurable
    // financial fields exactly — same bounds, same semantics, applied
    // to this geography instead of nationally.
    acquisitionAgentCommissionPercent: {
      type: Number,
      required: true,
      min: TERRITORY_COMMISSION_PERCENT_MIN,
      max: TERRITORY_COMMISSION_PERCENT_MAX,
    },

    acquisitionEarningTargetInPaise: {
      type: Number,
      required: true,
      min: ACQUISITION_INCENTIVE_MIN_PAISE,
      validate: {
        validator: Number.isInteger,
        message: "acquisitionEarningTargetInPaise must be a whole number (paise, not rupees)",
      },
    },

    territoryPartnerCommissionPercent: {
      type: Number,
      required: true,
      min: TERRITORY_COMMISSION_PERCENT_MIN,
      max: TERRITORY_COMMISSION_PERCENT_MAX,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Per-scopeKey versionNumber uniqueness (bounded-retry generated, same
// idiom as CommercialPolicyVersion's global versionNumber unique index).
CommercialPolicyOverrideSchema.index({ scopeKey: 1, versionNumber: 1 }, { unique: true });

// Duplicate-DRAFT prevention within one scope — mirrors CommercialTerritory's
// own {scopeKey,status:DRAFT} partial-unique index exactly.
CommercialPolicyOverrideSchema.index(
  { scopeKey: 1, status: 1 },
  { name: "scopeKey_status_draft_unique", unique: true, partialFilterExpression: { status: POLICY_OVERRIDE_STATUS.DRAFT } }
);

// At most one PUBLISHED override per exact scope — the new invariant
// this model adds beyond CommercialTerritory's own shape (CommercialTerritory
// has no equivalent, since ACTIVE-vs-ACTIVE overlap there is enforced
// via TerritoryActivationLock, not an index — same mechanism is reused
// here in commercialPolicyOverride.service.js#publishPolicyOverride for
// CROSS-scope overlap; this index instead guards the SAME-scope case).
CommercialPolicyOverrideSchema.index(
  { scopeKey: 1, status: 1 },
  { name: "scopeKey_status_published_unique", unique: true, partialFilterExpression: { status: POLICY_OVERRIDE_STATUS.PUBLISHED } }
);

// Resolution lookup indexes — exact mirror of CommercialTerritory's own
// three lookup indexes, since resolveApplicableCommercialPolicyForBooking
// runs the identical shape of query against this collection.
CommercialPolicyOverrideSchema.index({ status: 1, scopeType: 1, districtRef: 1 });
CommercialPolicyOverrideSchema.index({ status: 1, scopeType: 1, cityRef: 1 });
CommercialPolicyOverrideSchema.index({ status: 1, scopeType: 1, areaRefs: 1 });

// Admin scoped listing.
CommercialPolicyOverrideSchema.index({ districtRef: 1, status: 1 });

export default mongoose.models.CommercialPolicyOverride ||
  mongoose.model("CommercialPolicyOverride", CommercialPolicyOverrideSchema);
