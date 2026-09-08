import mongoose from "mongoose";

import { TEMPLATE_STATUS, TEMPLATE_STATUS_VALUES, WEEKDAYS } from "../constants/weeklyScheduleTemplate.constants.js";

//////////////////////////////////////////////////////////////
// DEVELOPER NOTES — READ BEFORE TOUCHING THIS FILE
//////////////////////////////////////////////////////////////
//
// Weekly Schedule Template — C4 Phase 1 (backend, config storage only).
//
// A salon can have MULTIPLE versions of this document over time, each
// with its own `effectiveFrom` date — NOT a single mutable "the
// template." Resolution for any given calendar date is: the version
// with the LATEST effectiveFrom that is <= that date. This is
// deliberately the same shape/precedence style as Salon.timings (one
// embedded object keyed by lowercase weekday name), just versioned by
// effectiveFrom instead of being a single static document — see the
// approved C4 audit for why this hybrid shape was chosen over either
// a pure dynamic-resolution model or full day-by-day materialization
// at write time.
//
// NOTE 1 — This collection is PURE CONFIGURATION. It never creates,
//   reads, or references ProfessionalChairAssignment rows, and no
//   materializer exists yet (that is C4 Phase 2, not built). Nothing
//   here changes what is actually bookable today.
//
// NOTE 2 — effectiveFrom is a "YYYY-MM-DD" string, matching every
//   other date field in this codebase (Booking.bookingDate,
//   HolidayOverride.date, ProfessionalChairAssignment.date) so it can
//   be compared/queried without date-range math.
//
// NOTE 3 — Immutability once effective (service-level, not a DB
//   constraint): once a version's effectiveFrom has been reached, its
//   `days` content must not be mutated, and it must not be cancelled —
//   see weeklyScheduleTemplate.service.js. This is enforced in the
//   service layer (like ProfessionalChairAssignment's "cannot update a
//   cancelled assignment" rule), not via a Mongoose hook, so the exact
//   error message/behavior stays easy to evolve.
//
// NOTE 4 — status, not hard delete. Cancelling sets status: CANCELLED
//   rather than deleting the row, preserving history — same convention
//   as ProfessionalChairAssignment/ChairAvailabilityOverride.
//
//////////////////////////////////////////////////////////////

const WeeklyScheduleEntrySchema = new mongoose.Schema(
  {
    professionalId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Staff",
      required: true,
    },
    chairId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Chair",
      required: true,
    },
    startTime: {
      type:     String,
      required: true,
      match:    /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    endTime: {
      type:     String,
      required: true,
      match:    /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
  },
  { _id: false }
);

const WeeklyDaySchema = new mongoose.Schema(
  {
    entries: { type: [WeeklyScheduleEntrySchema], default: [] },
  },
  { _id: false }
);

const daysField = {};
for (const day of WEEKDAYS) {
  daysField[day] = { type: WeeklyDaySchema, default: () => ({ entries: [] }) };
}

const WeeklyScheduleTemplateSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // SALON
    //////////////////////////////////////////////////////////
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // VERSIONING — See NOTE 2
    //////////////////////////////////////////////////////////
    effectiveFrom: {
      type:     String,
      required: true,
      match:    /^\d{4}-\d{2}-\d{2}$/,
    },

    // Recorded for clarity/future-proofing only — every date field in
    // this codebase is IST by established convention (see
    // getISTDayName/todayIST duplicated per-file); this is not read by
    // any engine today and does not make the salon's actual timezone
    // configurable.
    timezone: {
      type:    String,
      default: "Asia/Kolkata",
    },

    //////////////////////////////////////////////////////////
    // WEEKLY PATTERN — one sub-object per weekday, each holding zero
    // or more {professionalId, chairId, startTime, endTime} entries.
    //////////////////////////////////////////////////////////
    days: daysField,

    //////////////////////////////////////////////////////////
    // STATUS — See NOTE 4
    //////////////////////////////////////////////////////////
    status: {
      type:    String,
      enum:    TEMPLATE_STATUS_VALUES,
      default: TEMPLATE_STATUS.ACTIVE,
    },

    //////////////////////////////////////////////////////////
    // AUDIT
    //////////////////////////////////////////////////////////
    createdBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },

    updatedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// INDEXES
//////////////////////////////////////////////////////////////

// One salon can never have two versions effective from the same date —
// enforced at the DB level (not just service-level pre-checks). This
// same compound index also serves the primary read pattern: "latest
// version for this salon with effectiveFrom <= requested date" is a
// range query + sort on this exact key.
WeeklyScheduleTemplateSchema.index({ salonId: 1, effectiveFrom: 1 }, { unique: true });

export default mongoose.models.WeeklyScheduleTemplate ||
  mongoose.model("WeeklyScheduleTemplate", WeeklyScheduleTemplateSchema);
