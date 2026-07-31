import mongoose from "mongoose";

//////////////////////////////////////////////////////
// DEVELOPER NOTES
//////////////////////////////////////////////////////
//
// Holiday Override Engine — Phase 1 (backend only).
//
// A date-specific exception on top of Salon.timings' recurring WEEKLY
// schedule (e.g. "closed every Monday"). This collection only ever
// holds dates the owner has explicitly marked as a holiday — turning
// a date back OFF deletes its row rather than storing isHoliday:false,
// so the collection never accumulates dead entries. "No row for a
// date" == "not a holiday".
//
// Phase 1 scope: record + validate only. The Slot Engine does NOT
// read this collection yet (Phase 2) — see salon.holiday.controller.js.
//
//////////////////////////////////////////////////////

const HolidayOverrideSchema = new mongoose.Schema(
  {
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
      index:    true,
    },

    // "YYYY-MM-DD" — matches Booking.bookingDate's format so both can
    // be compared/queried without any date-range math.
    date: {
      type:     String,
      required: true,
      match:    /^\d{4}-\d{2}-\d{2}$/,
    },

    isHoliday: {
      type:    Boolean,
      default: true,
    },

    // Optional owner-facing note — "Diwali", "Maintenance", etc.
    reason: {
      type:      String,
      default:   null,
      trim:      true,
      maxlength: 200,
    },

    //////////////////////////////////////////////////////////
    // AUDIT
    //////////////////////////////////////////////////////////
    createdBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:      "User",
      default: null,
    },

    updatedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:      "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// One override per salon per date — also the lookup this collection
// exists to serve (single-date reads, future range reads for a
// calendar view in Phase 2/3).
HolidayOverrideSchema.index({ salonId: 1, date: 1 }, { unique: true });

export default mongoose.models.HolidayOverride || mongoose.model("HolidayOverride", HolidayOverrideSchema);
