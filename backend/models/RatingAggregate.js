import mongoose from "mongoose";
import { RATING_TYPE } from "./ServiceRating.js";

//////////////////////////////////////////////////////////////
// 📖 MODEL OVERVIEW — Rating & Review Engine, Phase 2
//
// Derived, recoverable summary data — NEVER the source of truth
// (Phase 1 constitution rule 9). One document per {salonId, type,
// targetId}: one for the salon itself (type SALON), one per rated
// service (type SERVICE), one per rated professional (type
// PROFESSIONAL). Updated exclusively by the RatingEvent outbox
// consumer (jobs/ratingOutbox.job.js) — never written directly by
// the submission API. If ever suspected corrupted, fully
// recomputable from raw ServiceRating rows (see
// services/ratingAggregate.service.js::recomputeAggregate).
//////////////////////////////////////////////////////////////

const RatingAggregateSchema = new mongoose.Schema(
  {
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

    count: {
      type: Number,
      default: 0,
      min: 0,
    },

    total: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Star-count breakdown ("5★ 72%" style UI). Keyed as a Map so
    // `$inc: {"distribution.5": 1}` dot-path atomic updates work
    // exactly like a plain nested field, without pre-declaring 5
    // separate schema paths.
    distribution: {
      type: Map,
      of: Number,
      default: () => new Map([
        ["1", 0], ["2", 0], ["3", 0], ["4", 0], ["5", 0],
      ]),
    },

    // Idempotency ledger for the outbox consumer — see
    // jobs/ratingOutbox.job.js. An event whose _id already appears
    // here has already been folded into count/total/distribution;
    // re-applying it (e.g. after a worker crash mid-processing) is a
    // guaranteed no-op via the query filter used to update this doc.
    appliedEventIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

RatingAggregateSchema.virtual("averageRating").get(function () {
  if (!this.count) return 0;
  return Number((this.total / this.count).toFixed(1));
});

RatingAggregateSchema.set("toJSON", { virtuals: true });
RatingAggregateSchema.set("toObject", { virtuals: true });

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// One aggregate row per target — salon-first for tenant locality.
RatingAggregateSchema.index({ salonId: 1, type: 1, targetId: 1 }, { unique: true });

export default mongoose.models.RatingAggregate || mongoose.model("RatingAggregate", RatingAggregateSchema);
