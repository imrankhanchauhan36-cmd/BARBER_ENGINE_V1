//////////////////////////////////////////////////////////////
// PROFESSIONAL ↔ CHAIR ASSIGNMENT ENGINE — SERVICE (PHASE 3)
//
// Owner-facing, date/time-windowed assignment of a Professional
// (models/Staff.js) to a Chair (models/Chair.js) — a new, dedicated
// collection (ProfessionalChairAssignment), per the approved Phase 3
// architecture. Does NOT touch Chair.js, Staff.chairId, Booking.js,
// the Slot Engine, or Chair Timeline's core algorithms.
//
// Concurrency: deliberately the SAME lightweight, no-transaction
// pattern chairAvailability.service.js already uses (sequential
// application-level conflict checks) — an approved decision, since
// this is an owner-only administrative operation, not customer slot
// contention. Multi-day creation instead uses an explicit two-pass
// validate-all-then-create-all approach so a single conflicting date
// never leaves partial data (see createAssignment below).
//////////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Chair from "../models/Chair.js";
import Staff from "../models/Staff.js";
import Booking from "../models/Booking.js";
import ChairAvailabilityOverride from "../models/ChairAvailabilityOverride.js";
import ProfessionalChairAssignment from "../models/ProfessionalChairAssignment.js";

import { ACTIVE_BOOKING_STATUSES, CHAIR_AVAILABILITY_STATUS } from "../constants/chairAvailability.constants.js";
import { ASSIGNMENT_STATUS } from "../constants/professionalChairAssignment.constants.js";
import { computeOccupiedEnd, toISTDateTime, toAbsoluteInstant } from "./chairTimeline.service.js";
import { Errors } from "../utils/response.js";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////////////////

// Same local-duplication convention chairAvailability.service.js and
// professional.service.js already use — independent copy, not shared.
const resolveOwnerSalon = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
  if (!salon) throw Errors.notFound("Salon not found");
  return salon;
};

const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isValidCalendarDate = (dateStr) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth()    === month - 1 &&
    parsed.getUTCDate()     === day
  );
};

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

// Inclusive "YYYY-MM-DD" list between startDate and endDate. Used
// only for the owner-convenience multi-day create — this never
// builds a recurrence rule, just the concrete list of dates to
// create one row each for (approved decision).
const enumerateDates = (startDate, endDate) => {
  const dates = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
};

const assertChairEligible = async (salonId, chairId) => {
  const chair = await Chair.findOne({ _id: chairId, salonId, isDeleted: false }).select("_id isActive").lean();
  if (!chair) throw Errors.notFound("Chair not found in this salon");
  if (!chair.isActive) throw Errors.badRequest("Chair is inactive");
  return chair;
};

const assertProfessionalEligible = async (salonId, professionalId) => {
  const staff = await Staff.findOne({ _id: professionalId, salonId, isDeleted: false }).select("_id isActive").lean();
  if (!staff) throw Errors.notFound("Professional not found in this salon");
  if (!staff.isActive) throw Errors.badRequest("Professional is inactive");
  return staff;
};

//////////////////////////////////////////////////////////////
// 🧠 CONFLICT CHECK — Rules A, B, C, D (single date+window)
//
// Throws Errors.conflict(...) with a specific, attributable reason
// the moment any rule is violated. Never partially applies — pure
// read-only check, no writes.
//////////////////////////////////////////////////////////////

const checkConflicts = async ({ chairId, professionalId, date, startTime, endTime, excludeAssignmentId }) => {
  const proposedStart = toISTDateTime(date, startTime);
  const proposedEnd   = toISTDateTime(date, endTime);

  const excludeFilter = excludeAssignmentId ? { _id: { $ne: excludeAssignmentId } } : {};

  // ── RULE A — same professional, overlapping window, ANY chair
  // (this also naturally catches an exact same-chair duplicate) ──
  const professionalRows = await ProfessionalChairAssignment.find({
    professionalId, date, status: ASSIGNMENT_STATUS.ACTIVE, ...excludeFilter,
  }).select("startTime endTime chairId").lean();

  const professionalConflict = professionalRows.find((row) =>
    overlaps(toISTDateTime(date, row.startTime), toISTDateTime(date, row.endTime), proposedStart, proposedEnd)
  );
  if (professionalConflict) {
    throw Errors.conflict(
      `This professional is already assigned to another chair from ${professionalConflict.startTime} to ${professionalConflict.endTime} on ${date}.`,
      { rule: "SAME_PROFESSIONAL_OVERLAP", conflictingAssignmentId: professionalConflict._id }
    );
  }

  // ── RULE B — same chair, overlapping window, ANY professional ──
  const chairRows = await ProfessionalChairAssignment.find({
    chairId, date, status: ASSIGNMENT_STATUS.ACTIVE, ...excludeFilter,
  }).select("startTime endTime professionalId").lean();

  const chairConflict = chairRows.find((row) =>
    overlaps(toISTDateTime(date, row.startTime), toISTDateTime(date, row.endTime), proposedStart, proposedEnd)
  );
  if (chairConflict) {
    throw Errors.conflict(
      `This chair is already assigned to another professional from ${chairConflict.startTime} to ${chairConflict.endTime} on ${date}.`,
      { rule: "SAME_CHAIR_OVERLAP", conflictingAssignmentId: chairConflict._id }
    );
  }

  // ── RULE C — overlapping ACTIVE booking on this chair ──
  // Same day-boundary + buffer-aware overlap technique
  // chairAvailability.service.js::createChairBlock already uses.
  const dayStart = toISTDateTime(date, "00:00");
  const dayEnd   = new Date(toISTDateTime(date, "23:59").getTime() + 60 * 1000);

  const activeBookings = await Booking.find({
    chairRef:  chairId,
    startTime: { $gte: dayStart, $lt: dayEnd },
    status:    { $in: ACTIVE_BOOKING_STATUSES },
  }).select("startTime endTime bufferTime").lean();

  // Phase D fix — b.endTime is already buffer-inclusive (see
  // chairTimeline.service.js's Phase D note); computeOccupiedEnd() must
  // not be re-applied on top of stored booking data.
  const bookingConflict = activeBookings.find((b) =>
    overlaps(toAbsoluteInstant(b.startTime), toAbsoluteInstant(b.endTime), proposedStart, proposedEnd)
  );
  if (bookingConflict) {
    throw Errors.conflict(
      "This chair has an active booking overlapping the requested window — the existing booking is protected and was not modified.",
      { rule: "EXISTING_BOOKING_OVERLAP", conflictingBookingId: bookingConflict._id }
    );
  }

  // ── RULE D — overlapping ACTIVE ChairAvailabilityOverride block ──
  const activeBlocks = await ChairAvailabilityOverride.find({
    chairId, date, status: CHAIR_AVAILABILITY_STATUS.ACTIVE,
  }).select("startTime endTime").lean();

  const blockConflict = activeBlocks.find((b) =>
    overlaps(toISTDateTime(date, b.startTime), toISTDateTime(date, b.endTime), proposedStart, proposedEnd)
  );
  if (blockConflict) {
    throw Errors.conflict(
      "This chair is blocked (Chair Availability Override) during the requested window.",
      { rule: "CHAIR_BLOCK_OVERLAP", conflictingBlockId: blockConflict._id }
    );
  }
};

//////////////////////////////////////////////////////////////
// 🚀 1. CREATE ASSIGNMENT — single date OR a date range
//
// Range mode generates one concrete row per date (no recurrence
// rule). Two-pass, no transaction (approved decision): PASS 1
// validates + conflict-checks EVERY requested date with zero writes;
// if ANY date fails, the entire request is rejected and NOTHING is
// created. Only if every date clears does PASS 2 create all rows.
//////////////////////////////////////////////////////////////

export const createAssignment = async ({ ownerId, chairId, professionalId, date, startDate, endDate, startTime, endTime }) => {
  const salon = await resolveOwnerSalon(ownerId);

  await assertChairEligible(salon._id, chairId);
  await assertProfessionalEligible(salon._id, professionalId);

  const dates = date ? [date] : enumerateDates(startDate, endDate);

  const today = todayIST();
  for (const d of dates) {
    if (!isValidCalendarDate(d)) {
      throw Errors.badRequest(`${d} is not a valid calendar date`);
    }
    if (d < today) {
      throw Errors.badRequest(`${d} is in the past — past dates cannot be assigned`);
    }
  }

  // PASS 1 — validate every date, write nothing yet.
  for (const d of dates) {
    await checkConflicts({ chairId, professionalId, date: d, startTime, endTime });
  }

  // PASS 2 — every date is conflict-free; create all rows.
  const created = [];
  for (const d of dates) {
    const row = await ProfessionalChairAssignment.create({
      salonId: salon._id, chairId, professionalId, date: d, startTime, endTime,
      status: ASSIGNMENT_STATUS.ACTIVE, createdBy: ownerId, updatedBy: ownerId,
    });
    created.push(row.toObject());
  }

  return created;
};

//////////////////////////////////////////////////////////////
// 🚀 2. LIST ASSIGNMENTS
//////////////////////////////////////////////////////////////

export const listAssignments = async ({ ownerId, date, chairId, professionalId, status = ASSIGNMENT_STATUS.ACTIVE, page = 1, limit = 20 }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const filter = { salonId: salon._id };
  if (date)           filter.date = date;
  if (chairId)        filter.chairId = chairId;
  if (professionalId) filter.professionalId = professionalId;
  if (status !== "ALL") filter.status = status;

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    ProfessionalChairAssignment.find(filter)
      .populate("chairId", "name position")
      .populate("professionalId", "name profession")
      .sort({ date: 1, startTime: 1 })
      .skip(skip).limit(limit).lean(),
    ProfessionalChairAssignment.countDocuments(filter),
  ]);

  return { items, pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 } };
};

//////////////////////////////////////////////////////////////
// 🚀 3. GET ONE ASSIGNMENT
//////////////////////////////////////////////////////////////

export const getAssignmentById = async ({ ownerId, assignmentId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const assignment = await ProfessionalChairAssignment.findOne({ _id: assignmentId, salonId: salon._id })
    .populate("chairId", "name position")
    .populate("professionalId", "name profession")
    .lean();

  if (!assignment) throw Errors.notFound("Assignment not found");
  return assignment;
};

//////////////////////////////////////////////////////////////
// 🚀 4. UPDATE (REASSIGN) — chair/date/time only, never status
//////////////////////////////////////////////////////////////

export const updateAssignment = async ({ ownerId, assignmentId, payload }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const assignment = await ProfessionalChairAssignment.findOne({ _id: assignmentId, salonId: salon._id });
  if (!assignment) throw Errors.notFound("Assignment not found");
  if (assignment.status === ASSIGNMENT_STATUS.CANCELLED) {
    throw Errors.badRequest("Cannot update a cancelled assignment — create a new one instead");
  }

  const proposed = {
    chairId:   payload.chairId   ?? String(assignment.chairId),
    date:      payload.date      ?? assignment.date,
    startTime: payload.startTime ?? assignment.startTime,
    endTime:   payload.endTime   ?? assignment.endTime,
  };

  if (payload.chairId) {
    await assertChairEligible(salon._id, payload.chairId);
  }
  if (payload.date) {
    if (!isValidCalendarDate(proposed.date)) throw Errors.badRequest(`${proposed.date} is not a valid calendar date`);
    if (proposed.date < todayIST()) throw Errors.badRequest("Past dates cannot be assigned");
  }

  await checkConflicts({
    chairId:        proposed.chairId,
    professionalId: String(assignment.professionalId),
    date:           proposed.date,
    startTime:      proposed.startTime,
    endTime:        proposed.endTime,
    excludeAssignmentId: assignment._id,
  });

  assignment.chairId   = proposed.chairId;
  assignment.date      = proposed.date;
  assignment.startTime = proposed.startTime;
  assignment.endTime   = proposed.endTime;
  assignment.updatedBy = ownerId;

  await assignment.save();
  return assignment.toObject();
};

//////////////////////////////////////////////////////////////
// 🚀 5. CANCEL (soft — status: CANCELLED, never deleted, idempotent)
//////////////////////////////////////////////////////////////

export const cancelAssignment = async ({ ownerId, assignmentId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const assignment = await ProfessionalChairAssignment.findOne({ _id: assignmentId, salonId: salon._id });
  if (!assignment) throw Errors.notFound("Assignment not found");

  // Idempotent no-op — same pattern chairAvailability.service.js uses.
  if (assignment.status === ASSIGNMENT_STATUS.CANCELLED) {
    return assignment.toObject();
  }

  assignment.status    = ASSIGNMENT_STATUS.CANCELLED;
  assignment.updatedBy = ownerId;
  await assignment.save();

  return assignment.toObject();
};
