import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 📖 MODEL OVERVIEW — Rating & Review Engine, Phase 2
//
// Normalized row-per-dimension design (Phase 1 design, approved).
// One completed booking with 3 services + 1 professional produces
// up to 5 ServiceRating rows: one SERVICE row per serviceId in
// Booking.serviceRefs, one PROFESSIONAL row for Booking.professionalRef
// (only if non-null), and one SALON row (always).
//
// Option A (approved product rule): ONE booking = ONE professional.
// A PROFESSIONAL-type row's targetId is always exactly
// Booking.professionalRef — never a per-service performer. Per-service
// multiple professionals is explicitly out of scope; this model does
// not and must not support it.
//
// Immutability: once created, a row's content (stars, review, type,
// targetId, bookingId, customerId, salonId, serviceCompletedAt) can
// never change — enforced below at the schema layer, not just by the
// absence of PUT/DELETE routes. Only isHidden/trustStatus/adminNote
// (admin moderation fields) may ever be modified after creation.
//////////////////////////////////////////////////////////////

export const RATING_TYPE = {
  SALON: "SALON",
  SERVICE: "SERVICE",
  PROFESSIONAL: "PROFESSIONAL",
};

export const RATING_TRUST_STATUS = {
  NORMAL: "NORMAL",
  SUSPICIOUS: "SUSPICIOUS",
  UNDER_REVIEW: "UNDER_REVIEW",
  RESTRICTED: "RESTRICTED",
};

// Only these fields may ever be changed after a row is created —
// everything else is content, and content is immutable forever.
const MODERATION_ONLY_FIELDS = new Set(["isHidden", "trustStatus", "adminNote", "updatedAt", "__v"]);

function assertOnlyModerationFieldsTouched(paths) {
  for (const path of paths) {
    const root = path.split(".")[0];
    if (!MODERATION_ONLY_FIELDS.has(root)) {
      throw new Error(
        `ServiceRating is immutable — field "${root}" cannot be modified after creation. ` +
        `Only isHidden/trustStatus/adminNote may be changed, and only via admin moderation.`
      );
    }
  }
}

const ServiceRatingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
    },

    // Denormalized from booking.salonRef at write time — present on
    // EVERY row regardless of type, so every query/index stays
    // salon-first (tenant locality) without a $lookup into Booking.
    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      immutable: true,
    },

    // Denormalized from booking.userRef at write time.
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    type: {
      type: String,
      enum: Object.values(RATING_TYPE),
      required: true,
      immutable: true,
    },

    // SALON rows: targetId === salonId (kept for a uniform shape).
    // SERVICE rows: targetId === one entry from booking.serviceRefs.
    // PROFESSIONAL rows: targetId === booking.professionalRef exactly.
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },

    stars: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
      immutable: true,
      validate: {
        validator: Number.isInteger,
        message: "stars must be a whole number (1-5)",
      },
    },

    // Optional written review — Phase 1 Decision 2 (approved): only
    // ever populated on the SALON-type row. SERVICE/PROFESSIONAL rows
    // are always star-only in Phase 1. Not enforced here at the
    // schema level (services/ratingSubmission.service.js is the
    // single write path and is responsible for this), since a schema-
    // level type-conditional requirement adds complexity without a
    // real integrity benefit — a stray review on a SERVICE row would
    // be inert (never read/displayed by any Phase 1 read path).
    review: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
      immutable: true,
    },

    // Copied from booking.completedAt at submission time — lets
    // analytics/read paths avoid a join back to Booking.
    serviceCompletedAt: {
      type: Date,
      required: true,
      immutable: true,
    },

    //////////////////////////////////////////////////////////
    // MODERATION FIELDS — the only fields ever mutable post-creation
    //////////////////////////////////////////////////////////

    trustStatus: {
      type: String,
      enum: Object.values(RATING_TRUST_STATUS),
      default: RATING_TRUST_STATUS.NORMAL,
    },

    isHidden: {
      type: Boolean,
      default: false,
    },

    adminNote: {
      type: String,
      default: null,
      maxlength: 300,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🔒 IMMUTABILITY GUARD — belt-and-suspenders on top of the
// per-field `immutable: true` above, which Mongoose enforces on
// `.save()` of a fetched document but does not reliably enforce
// against query-style updates (`updateOne`/`findOneAndUpdate`).
// This hook is the actual authority for both paths.
//////////////////////////////////////////////////////////////

ServiceRatingSchema.pre("save", function (next) {
  if (this.isNew) return next();
  try {
    assertOnlyModerationFieldsTouched(this.modifiedPaths());
  } catch (err) {
    return next(err);
  }
  next();
});

ServiceRatingSchema.pre(["updateOne", "findOneAndUpdate", "updateMany"], function (next) {
  const update = this.getUpdate() || {};
  const flatFields = {
    ...(update.$set || {}),
    ...Object.fromEntries(Object.entries(update).filter(([k]) => !k.startsWith("$"))),
  };
  try {
    assertOnlyModerationFieldsTouched(Object.keys(flatFields));
  } catch (err) {
    return next(err);
  }
  next();
});

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// DUPLICATE PROTECTION + IDEMPOTENCY AUTHORITY (Phase 1 Decisions
// 4/6/7). One customer can rate the same dimension of the same
// booking exactly once — this single compound unique index protects
// SALON, SERVICE, and PROFESSIONAL rows identically. A retried
// submission (network timeout, double-tap) for a dimension that
// already has a row hits this index, not app logic — see
// services/ratingSubmission.service.js for how the 11000 is handled.
ServiceRatingSchema.index(
  { bookingId: 1, type: 1, targetId: 1, customerId: 1 },
  { unique: true }
);

// Paginated per-target review lists (cursor-based on createdAt+_id),
// salon-first for tenant locality at 50-lakh-salon scale.
ServiceRatingSchema.index({ salonId: 1, type: 1, targetId: 1, createdAt: -1 });

// "My ratings" screen.
ServiceRatingSchema.index({ customerId: 1, createdAt: -1 });

// Dimension lookup for eligibility resolution (all rows for one
// booking+customer, regardless of type).
ServiceRatingSchema.index({ bookingId: 1, customerId: 1 });

export default mongoose.models.ServiceRating || mongoose.model("ServiceRating", ServiceRatingSchema);
