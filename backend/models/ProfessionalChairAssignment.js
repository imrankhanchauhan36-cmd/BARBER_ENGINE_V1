import mongoose from "mongoose";

import {
  ASSIGNMENT_STATUS,
  ASSIGNMENT_STATUS_VALUES,
} from "../constants/professionalChairAssignment.constants.js";

//////////////////////////////////////////////////////////////
// DEVELOPER NOTES — READ BEFORE TOUCHING THIS FILE
//////////////////////////////////////////////////////////////
//
// Professional ↔ Chair Assignment Engine — Phase 3 (backend only).
//
// A TIME-BASED scheduler, not a permanent link. Each row is ONE
// concrete (chair, professional, date, time-window) assignment —
// never a recurring rule. Modeled directly on the proven
// ChairAvailabilityOverride shape (same date/startTime/endTime
// string convention, same soft-cancel status, same audit fields),
// per the approved Phase 3 architecture.
//
// NOTE 1 — Chair.js is FROZEN and Staff.chairId is intentionally
//   left untouched (see Phase 1/2 decisions). This collection is
//   the ONLY place a date/time-scoped professional↔chair link is
//   recorded. It does not read or write Staff.chairId at all.
//
// NOTE 2 — date / startTime / endTime are strings, not Date
//   objects — matches Booking.bookingDate's and
//   ChairAvailabilityOverride's "YYYY-MM-DD" / "HH:mm" convention
//   exactly, so all three can be compared without date-range math.
//
// NOTE 3 — status, not hard delete. Cancelling sets status:
//   CANCELLED rather than deleting the row, preserving history.
//   Every live conflict check queries status: ACTIVE only.
//
// NOTE 4 — overlap is NOT enforced by a DB index (same reasoning as
//   ChairAvailabilityOverride's own NOTE 3: a professional or a
//   chair can legitimately have multiple non-overlapping windows on
//   the same date). Overlap against other assignments, existing
//   bookings, and existing chair blocks is validated in
//   professionalChairAssignment.service.js at create/update time.
//
// NOTE 5 — deliberately no `type`/`seriesId` fields. Multi-day
//   creation (per the approved Phase 3 decision) generates one
//   concrete row per date rather than a recurrence rule — there is
//   no reserved-but-unused field here to seed a future recurrence
//   engine, unlike ChairAvailabilityOverride's seriesId.
//
//////////////////////////////////////////////////////////////

const ProfessionalChairAssignmentSchema = new mongoose.Schema(
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
    // CHAIR — See NOTE 1
    //////////////////////////////////////////////////////////
    chairId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Chair",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // PROFESSIONAL — models/Staff.js, See NOTE 1
    //////////////////////////////////////////////////////////
    professionalId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Staff",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // WINDOW — See NOTE 2
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
    // STATUS — See NOTE 3
    //////////////////////////////////////////////////////////
    status: {
      type:    String,
      enum:    ASSIGNMENT_STATUS_VALUES,
      default: ASSIGNMENT_STATUS.ACTIVE,
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
// INDEXES — exactly the three query patterns Phase 3 actually needs
//////////////////////////////////////////////////////////////

// Primary read pattern — list/conflict-check ACTIVE assignments for
// a salon+date.
ProfessionalChairAssignmentSchema.index({ salonId: 1, date: 1, status: 1 });

// Owner-facing per-chair history + chair-conflict check (Rule B).
ProfessionalChairAssignmentSchema.index({ chairId: 1, date: 1 });

// Professional-conflict check (Rule A) + per-professional history.
ProfessionalChairAssignmentSchema.index({ professionalId: 1, date: 1 });

//////////////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.ProfessionalChairAssignment ||
  mongoose.model("ProfessionalChairAssignment", ProfessionalChairAssignmentSchema);
