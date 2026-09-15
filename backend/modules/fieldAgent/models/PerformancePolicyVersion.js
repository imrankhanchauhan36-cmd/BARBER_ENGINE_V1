/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/PerformancePolicyVersion.js
 *
 * FA-11.1 — the versioned, admin-authored configuration for the Field
 * Agent Performance evidence profile. Exact DRAFT -> PUBLISHED ->
 * RETIRED lifecycle as CommercialPolicyVersion (FA-5.1) — same
 * immutability discipline (published/retired never mutate; a
 * correction is a new DRAFT version), same "at most one PUBLISHED"
 * partial-unique-index guarantee.
 *
 * FA-11 business decision lock (this round): a numeric composite score
 * is DEFERRED. This version therefore configures only the rolling
 * window length and which evidence dimensions are visible — it never
 * carries score weights/thresholds. Do not add them here without a
 * new, explicit business decision superseding this one.
 *
 * FA-11 audit finding (locked): two requested dimensions — Territory
 * Partner support/relationship evidence and complaints — have zero
 * authoritative data behind them (no FieldAgent linkage in
 * SupportTicket; no complaint/grievance model exists anywhere). They
 * are therefore not configurable dimensions here; they are always
 * present on every FieldAgentPerformanceSnapshot as fixed "unavailable"
 * strings (see performance.constants.js), never toggled on/off.
 */

import mongoose from "mongoose";
import {
  PERFORMANCE_POLICY_STATUS,
  PERFORMANCE_DIMENSION,
  ROLLING_WINDOW_DAYS_MIN,
} from "../constants/performance.constants.js";

const performancePolicyVersionSchema = new mongoose.Schema(
  {
    versionNumber: {
      type: Number,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: Object.values(PERFORMANCE_POLICY_STATUS),
      default: PERFORMANCE_POLICY_STATUS.DRAFT,
      required: true,
    },

    // Business-approved default is 90 days — set by whoever authors
    // the DRAFT, never hard-coded here (bounds are structural, the
    // actual number is policy).
    rollingWindowDays: {
      type: Number,
      required: true,
      min: ROLLING_WINDOW_DAYS_MIN,
      validate: {
        validator: Number.isInteger,
        message: "rollingWindowDays must be a whole number of days",
      },
    },

    // Explicit, validated list — never an unrestricted arbitrary
    // array (same discipline as CommercialPolicyVersion's
    // obligations/performanceFactors/coverageRules).
    dimensionsEnabled: {
      type: [String],
      enum: Object.values(PERFORMANCE_DIMENSION),
      default: () => [],
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one PUBLISHED version at a time — same partial-unique-index
// idiom as CommercialPolicyVersion/TestVersion/TrainingVersion.
performancePolicyVersionSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PERFORMANCE_POLICY_STATUS.PUBLISHED },
  }
);

export default mongoose.models.PerformancePolicyVersion ||
  mongoose.model("PerformancePolicyVersion", performancePolicyVersionSchema);
