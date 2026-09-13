/**
 * BARBER ENGINE V1
 * backend/models/AreaDiscoveryCandidate.js
 *
 * AREA-2.5.1 — foundation only. A candidate is explicitly NOT an Area:
 * it records "ZEMISH observed evidence suggesting a locality may
 * exist," nothing more. It cannot become serviceable, cannot become a
 * Territory, cannot assign acquisition credit, and approving one does
 * NOT create an Area — canonical Area creation remains exclusively
 * the existing, frozen createArea/AREA-2.2 path (AREA-2.5 audit §1).
 *
 * Placed alongside Area/AreaServiceability/City/State (not under
 * modules/fieldAgent/) for the same reason AreaServiceability was:
 * this is a geography-adjacent concept, independent of the Field
 * Agent/Territory domain.
 *
 * Identity mirrors Area.js's own {cityRef, normalizedName} shape
 * exactly: unique {cityRef, normalizedCandidateName} — deliberately
 * consistent, not a new convention.
 *
 * districtRef/stateRef are SERVER-DERIVED from the resolved City at
 * write time (see the controller), never accepted from the client —
 * this makes cross-district/cross-state mismatch structurally
 * impossible rather than merely validated (AREA-2.5 audit §6's "never
 * fuzzy-match geography ancestors" taken to its strictest form).
 *
 * Lifecycle is deliberately narrower than the AREA-2.5 audit's
 * illustrative sketch: MEDIUM_REVIEW/LOW_REVIEW both presuppose a
 * computed confidence split that no scoring engine exists to produce
 * in this phase (no normalization/matching engine is implemented
 * here) — introducing them now would be dead, unreachable states.
 * V1 lifecycle is OBSERVED -> {APPROVED, REJECTED, MERGED}, all three
 * terminal. Confidence-tiered review states are deferred to whichever
 * later phase actually computes confidence.
 */

import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 ENUMS
//////////////////////////////////////////////////////////////

// SALON_ONBOARDING/SALON_UPDATE are declared now (same "declare the
// full future vocabulary, wire it later" convention already used in
// fieldAgent.constants.js) but are NOT reachable through any AREA-2.5.1
// endpoint — only ADMIN/BATCH are accepted server-side in this phase.
// Field Agent and customer-search sources are deliberately absent —
// open business decisions per the AREA-2.5 audit, not decided here.
export const CANDIDATE_SOURCE_TYPE = Object.freeze({
  SALON_ONBOARDING: "SALON_ONBOARDING",
  SALON_UPDATE:     "SALON_UPDATE",
  ADMIN:            "ADMIN",
  BATCH:            "BATCH",
});

export const CANDIDATE_SOURCE_TYPES_ACCEPTED_V1 = Object.freeze([
  CANDIDATE_SOURCE_TYPE.ADMIN,
  CANDIDATE_SOURCE_TYPE.BATCH,
]);

export const CANDIDATE_STATUS = Object.freeze({
  OBSERVED: "OBSERVED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  MERGED:   "MERGED",
});

// Explicit adjacency map, same convention as
// AreaServiceability.VALID_SERVICEABILITY_TRANSITIONS — all three
// outcomes are terminal for this foundation phase (no path exists yet
// to revisit an approved/rejected/merged candidate; that governance
// question is deferred, not silently decided).
export const VALID_CANDIDATE_TRANSITIONS = Object.freeze({
  [CANDIDATE_STATUS.OBSERVED]: [CANDIDATE_STATUS.APPROVED, CANDIDATE_STATUS.REJECTED, CANDIDATE_STATUS.MERGED],
  [CANDIDATE_STATUS.APPROVED]: [],
  [CANDIDATE_STATUS.REJECTED]: [],
  [CANDIDATE_STATUS.MERGED]:   [],
});

// Bounded array sizes — the concrete abuse/scale protection called
// for in the AREA-2.5 audit §9/§12. Enforced atomically at the
// database layer via $push+$slice in the controller, not merely by
// schema maxlength (which would only catch a rewrite of the whole
// array, not incremental $push growth).
export const MAX_RAW_OBSERVED_NAMES = 20;
export const MAX_SOURCE_REFERENCES  = 50;
export const MAX_SAMPLE_COORDINATES = 10;

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const coordinatePairValidator = {
  validator: function (val) {
    if (!val) return true;
    return (
      typeof val.lat === "number" && typeof val.lng === "number" &&
      Number.isFinite(val.lat) && Number.isFinite(val.lng) &&
      val.lat >= -90 && val.lat <= 90 && val.lng >= -180 && val.lng <= 180
    );
  },
  message: "Invalid coordinate pair",
};

const AreaDiscoveryCandidateSchema = new mongoose.Schema(
  {
    normalizedCandidateName: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 100,
    },

    // Distinct raw strings observed for this candidate — bounded,
    // deduplicated on write (see controller). Not itself the identity.
    rawObservedNames: {
      type:      [{ type: String, trim: true, maxlength: 200 }],
      default:   [],
      validate: {
        validator: (arr) => arr.length <= MAX_RAW_OBSERVED_NAMES,
        message:   `rawObservedNames exceeds the maximum of ${MAX_RAW_OBSERVED_NAMES}`,
      },
    },

    //////////////////////////////////////////////////////////
    // 🔗 GEOGRAPHY — hard scope boundary, never fuzzy-matched.
    // districtRef/stateRef are server-derived from cityRef, never
    // client-supplied (see controller) — structurally eliminates
    // cross-district/cross-state mismatch rather than validating it.
    //////////////////////////////////////////////////////////
    cityRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "City",
      required: true,
      index:    true,
    },
    districtRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "District",
      required: true,
    },
    stateRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "State",
      required: true,
    },

    sourceType: {
      type:     String,
      enum:     Object.values(CANDIDATE_SOURCE_TYPE),
      required: true,
    },

    // Bounded, opaque references (e.g. Salon _id once onboarding
    // integration exists in a later phase) — not populated/typed
    // against a single model, since source references may originate
    // from different collections depending on sourceType.
    sourceReferences: {
      type:    [{ type: mongoose.Schema.Types.ObjectId }],
      default: [],
      validate: {
        validator: (arr) => arr.length <= MAX_SOURCE_REFERENCES,
        message:   `sourceReferences exceeds the maximum of ${MAX_SOURCE_REFERENCES}`,
      },
    },

    sampleCoordinates: {
      type: [{
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        _id: false,
      }],
      default: [],
      validate: [
        { validator: (arr) => arr.length <= MAX_SAMPLE_COORDINATES, message: `sampleCoordinates exceeds the maximum of ${MAX_SAMPLE_COORDINATES}` },
        { validator: (arr) => arr.every((p) => coordinatePairValidator.validator(p)), message: "sampleCoordinates contains an invalid coordinate pair" },
      ],
    },

    observationCount: {
      type:    Number,
      default: 1,
      min:     1,
    },

    firstSeenAt: {
      type:    Date,
      default: Date.now,
    },

    lastSeenAt: {
      type:    Date,
      default: Date.now,
    },

    // Reserved for a future confidence-scoring engine (AREA-2.5.2+).
    // No code in this phase computes or sets this field — it exists
    // now only so later phases don't need a schema migration.
    // Deliberately separate from observationCount (raw evidence
    // volume) — this field, if ever populated, would be a computed
    // value, never client-supplied.
    confidence: {
      type:    Number,
      min:     0,
      max:     1,
      default: null,
    },

    status: {
      type:     String,
      enum:     Object.values(CANDIDATE_STATUS),
      required: true,
      default:  CANDIDATE_STATUS.OBSERVED,
      // indexed explicitly below (schema.index) — not duplicated here
    },

    // Set only when status transitions to MERGED — records which
    // existing Area this candidate turned out to correspond to,
    // per human review. Never set automatically.
    matchedAreaRef: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Area",
      default: null,
    },

    reviewedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:      "User",
      default: null,
    },

    reviewedAt: {
      type:    Date,
      default: null,
    },

    reviewNotes: {
      type:      String,
      trim:      true,
      maxlength: 500,
      default:   null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// Canonical identity — same shape as Area.js's own {cityRef,normalizedName}.
AreaDiscoveryCandidateSchema.index({ cityRef: 1, normalizedCandidateName: 1 }, { unique: true });
// Review-queue listing.
AreaDiscoveryCandidateSchema.index({ status: 1 });
// Scoped review-queue listing (mirrors Area's own districtRef+isActive pattern).
AreaDiscoveryCandidateSchema.index({ cityRef: 1, status: 1 });

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.AreaDiscoveryCandidate ||
  mongoose.model("AreaDiscoveryCandidate", AreaDiscoveryCandidateSchema);
