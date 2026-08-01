import mongoose from "mongoose";

import {
  CHAIR_AVAILABILITY_STATUS,
  CHAIR_AVAILABILITY_STATUS_VALUES,
  CHAIR_AVAILABILITY_TYPE,
  CHAIR_AVAILABILITY_TYPE_VALUES,
} from "../constants/chairAvailability.constants.js";

//////////////////////////////////////////////////////
// DEVELOPER NOTES — READ BEFORE TOUCHING THIS FILE
//////////////////////////////////////////////////////
//
// Chair Availability Engine — Phase 1 (backend only).
//
// A TIME-BASED scheduler, not a Chair ON/OFF switch. Each row is
// ONE concrete (chair, date, time-window) block — never a rule.
// Chair.js already has `disabledUntil` for a blanket "disabled
// until timestamp X" state; this collection is deliberately
// separate because it represents a scoped [startTime, endTime)
// window that coexists with normal availability before/after it,
// and because Chair.js is FROZEN (v4 — FINAL LOCK) and must not
// be touched.
//
// NOTE 1 — date / startTime / endTime are strings, not Date
//   objects. `date` matches Booking.bookingDate's and
//   HolidayOverride.date's "YYYY-MM-DD" format so all three can be
//   compared/queried without date-range math. `startTime`/`endTime`
//   are "HH:mm" (24h), matching Salon.timings' break format — the
//   read path (chairTimeline.service.js) parses them with the exact
//   same IST-offset technique already used for breaks.
//
// NOTE 2 — status, not hard delete
//   Cancelling a block sets status: CANCELLED rather than deleting
//   the row, preserving an audit trail of what was blocked and
//   when it was lifted. The Chair Timeline read path only ever
//   queries status: ACTIVE — a cancelled block is invisible to it.
//
// NOTE 3 — overlap is NOT enforced by a DB index
//   A chair can legitimately have multiple non-overlapping blocks
//   on the same date (e.g. 10–11 AM AND 2–4 PM). Overlap against
//   existing bookings AND existing active blocks is validated in
//   chairAvailability.service.js at create time — see NOTE 3 there
//   for why a unique index can't express that rule.
//
// NOTE 4 — type + seriesId are extensibility fields, unused by any
//   engine today
//   `type` is descriptive-only (owner UI / reporting) — reserved
//   values (MAINTENANCE, CLEANING, VIP_RESERVATION, etc.) already
//   exist in chairAvailability.constants.js so future phases can
//   start using them without a schema migration. `seriesId` is
//   reserved for a future recurrence generator (daily/weekly
//   blocks) that would pre-create multiple concrete rows sharing
//   one seriesId — see the approved architecture doc, §5. Neither
//   field is read by chairTimeline.service.js today.
//
//////////////////////////////////////////////////////

const ChairAvailabilityOverrideSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // SALON
    //////////////////////////////////////////////////////////
    // No standalone index here — {salonId:1, date:1, status:1} below
    // already covers every salonId-only query as its leading prefix.
    // A separate single-field index would be pure duplicate write
    // overhead with zero additional query coverage.
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // CHAIR — See NOTE 1
    //////////////////////////////////////////////////////////
    // No standalone index here — {chairId:1, date:1} below already
    // covers every chairId-only query as its leading prefix.
    chairId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Chair",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // WINDOW — See NOTE 1
    //////////////////////////////////////////////////////////
    date: {
      type:     String,
      required: true,
      match:    /^\d{4}-\d{2}-\d{2}$/,
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

    //////////////////////////////////////////////////////////
    // CLASSIFICATION — See NOTE 4
    //////////////////////////////////////////////////////////
    type: {
      type:    String,
      enum:    CHAIR_AVAILABILITY_TYPE_VALUES,
      default: CHAIR_AVAILABILITY_TYPE.MANUAL,
    },

    reason: {
      type:      String,
      default:   null,
      trim:      true,
      maxlength: 200,
    },

    //////////////////////////////////////////////////////////
    // STATUS — See NOTE 2
    //////////////////////////////////////////////////////////
    // No standalone index here — every current query filters status
    // together with salonId (via the compound index above); status
    // is never queried alone across all salons, so a dedicated
    // single-field index would sit unused.
    status: {
      type:    String,
      enum:    CHAIR_AVAILABILITY_STATUS_VALUES,
      default: CHAIR_AVAILABILITY_STATUS.ACTIVE,
    },

    //////////////////////////////////////////////////////////
    // FUTURE RECURRENCE — See NOTE 4 — reserved, unused Phase 1
    //////////////////////////////////////////////////////////
    seriesId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
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

// Primary read pattern — chairTimeline.service.js fetches every
// ACTIVE block for a salon+date, then groups by chairId in memory.
ChairAvailabilityOverrideSchema.index({ salonId: 1, date: 1, status: 1 });

// Owner-facing per-chair block list/history.
ChairAvailabilityOverrideSchema.index({ chairId: 1, date: 1 });

// Future recurrence lookups (cancel/list an entire series).
ChairAvailabilityOverrideSchema.index({ seriesId: 1 });

//////////////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////////////
export default mongoose.models.ChairAvailabilityOverride ||
  mongoose.model("ChairAvailabilityOverride", ChairAvailabilityOverrideSchema);
