import mongoose from "mongoose";
import { RATING_TYPE } from "./ServiceRating.js";

//////////////////////////////////////////////////////////////
// 📖 MODEL OVERVIEW — Rating & Review Engine, Phase 2
//
// Persistent transactional outbox (Phase 1 Decision 5 — approved:
// no external queue infrastructure; a MongoDB-backed, distributed-
// safe, database-claimed outbox instead). One row is written in the
// SAME transaction as its originating ServiceRating row (see
// services/ratingSubmission.service.js), so a rating can never exist
// without a corresponding event to eventually update the aggregate,
// and vice versa.
//
// Consumed by jobs/ratingOutbox.job.js via an atomic
// findOneAndUpdate claim (PENDING -> PROCESSING), safe across
// multiple backend instances polling concurrently — no two workers
// can ever claim the same event. See that file for the full
// claim/apply/idempotency design.
//////////////////////////////////////////////////////////////

export const RATING_EVENT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
};

// R1 (Rating Consistency Fix): distinguishes an aggregate-increasing
// event from an aggregate-decreasing one. `delta.stars`/`delta.count`
// always stay positive (Step 5 of the approved R1 plan) — the SIGN of
// the adjustment is derived from eventType alone in
// jobs/ratingOutbox.job.js::applyEventToAggregate, not encoded into
// the delta. Defaulting to RATING_CREATED makes this field purely
// additive: every existing RatingEvent.insertMany(...) call site
// (services/ratingSubmission.service.js) is untouched and continues
// to produce RATING_CREATED events exactly as before.
export const RATING_EVENT_TYPE = {
  RATING_CREATED: "RATING_CREATED",
  RATING_HIDDEN: "RATING_HIDDEN",
  RATING_UNHIDDEN: "RATING_UNHIDDEN",
};

const RatingEventSchema = new mongoose.Schema(
  {
    ratingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRating",
      required: true,
    },

    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
    },

    type: {
      type: String,
      enum: Object.values(RATING_TYPE),
      required: true,
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    delta: {
      count: { type: Number, required: true, default: 1 },
      stars: { type: Number, required: true, min: 1, max: 5 },
    },

    // R1: default preserves the pre-R1 implicit meaning of every
    // event ("this is a creation, always add") without touching the
    // existing submission write path at all.
    eventType: {
      type: String,
      enum: Object.values(RATING_EVENT_TYPE),
      default: RATING_EVENT_TYPE.RATING_CREATED,
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(RATING_EVENT_STATUS),
      default: RATING_EVENT_STATUS.PENDING,
    },

    // Set atomically at claim time — a PROCESSING row whose claimedAt
    // is older than the job's stale-claim threshold is treated as an
    // abandoned claim (worker crashed mid-processing) and becomes
    // reclaimable again. Same "lockUntil"-style expiry idiom as
    // Booking.js's own HOLD expiry.
    claimedAt: {
      type: Date,
      default: null,
    },

    claimedBy: {
      type: String,
      default: null,
    },

    attempts: {
      type: Number,
      default: 0,
    },

    lastError: {
      type: String,
      default: null,
    },

    processedAt: {
      type: Date,
      default: null,
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

// The consumer's claim-scan query: { status: "PENDING" } oldest
// first. Partial filter keeps the index tiny once most events reach
// PROCESSED — mirrors Booking.js's own partial-index-for-active-
// subset idiom (e.g. the HOLD-only holdExpiresAt index).
RatingEventSchema.index(
  { status: 1, createdAt: 1 },
  {
    partialFilterExpression: {
      status: { $in: [RATING_EVENT_STATUS.PENDING, RATING_EVENT_STATUS.PROCESSING] },
    },
  }
);

export default mongoose.models.RatingEvent || mongoose.model("RatingEvent", RatingEventSchema);
