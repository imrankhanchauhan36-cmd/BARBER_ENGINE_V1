//////////////////////////////////////////////////////////////
// UNIFIED SCHEDULE — SERVICE (owner-facing composition layer)
//
// This file is a pure COMPOSITION layer over already-frozen,
// unmodified production engines — same pattern
// services/bookingReadiness.service.js already established:
//   - services/weeklyScheduleMaterializer.service.js::resolveTemplateForDate
//   - services/professionalChairAssignment.service.js::createAssignment/
//     updateAssignment/cancelAssignment (Rules A/B/C/D untouched)
//   - services/chairTimeline.service.js::toISTDateTime/toAbsoluteInstant
//
// It does NOT reimplement conflict/eligibility logic, does NOT touch
// WeeklyScheduleTemplate, the materializer, Booking Readiness, the
// Slot Engine, or Booking.js. Its only job is to let the owner think
// in terms of ONE per-date "Schedule" (Working Hours + Weekly Staff/
// Chair Schedule + Date Overrides) while every actual write still
// flows through the existing, tested ProfessionalChairAssignment
// engine underneath.
//
// "Date Override" is NOT a new model (approved Phase 2 decision) — it
// is simply an ACTIVE ProfessionalChairAssignment row for that date,
// which the materializer's own existing-row rule already treats as
// permanently outranking the recurring template. `isOverride` on the
// resolved-schedule read below is a COMPUTED comparison against the
// current master, never a stored field.
//////////////////////////////////////////////////////////////

import mongoose from "mongoose";

import Salon from "../models/Salon.js";
import Booking from "../models/Booking.js";
import ProfessionalChairAssignment from "../models/ProfessionalChairAssignment.js";

import { ASSIGNMENT_STATUS, ASSIGNMENT_SOURCE } from "../constants/professionalChairAssignment.constants.js";
import { ACTIVE_BOOKING_STATUSES } from "../constants/chairAvailability.constants.js";
import { resolveTemplateForDate } from "./weeklyScheduleMaterializer.service.js";
import { createAssignment, updateAssignment, cancelAssignment } from "./professionalChairAssignment.service.js";
import { toISTDateTime, toAbsoluteInstant } from "./chairTimeline.service.js";
import { Errors } from "../utils/response.js";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS — same local-duplication convention every other service
// in this codebase already uses (independent copy, not shared).
//////////////////////////////////////////////////////////////

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

const getISTDayName = (dateStr) =>
  new Date(`${dateStr}T12:00:00Z`)
    .toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" })
    .toLowerCase();

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

// Resolves the applicable master template's entries for one date —
// read-only composition over the existing, unmodified
// resolveTemplateForDate(); never a second implementation of
// effectiveFrom precedence.
const getMasterEntriesForDate = async (salonId, date) => {
  const template = await resolveTemplateForDate(salonId, date);
  if (!template) return { template: null, entries: [] };
  const weekday = getISTDayName(date);
  return { template, weekday, entries: template.days?.[weekday]?.entries || [] };
};

//////////////////////////////////////////////////////////////
// 🚀 1. RESOLVED SCHEDULE — read-only, per date
//
// Precedence (approved Phase 1/2 design, not new logic):
//   1. Any ACTIVE ProfessionalChairAssignment row for this date wins
//      unconditionally (the "Date Override" tier).
//   2. Otherwise, the currently-applicable WeeklyScheduleTemplate's
//      matching weekday entries (presented as "what the master
//      provides", even if not yet materialized).
//   3. Otherwise, no schedule for that date.
//////////////////////////////////////////////////////////////

export const getResolvedScheduleForDates = async ({ ownerId, dates }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const rows = await ProfessionalChairAssignment.find({
    salonId: salon._id, date: { $in: dates }, status: ASSIGNMENT_STATUS.ACTIVE,
  }).select("professionalId chairId date startTime endTime source").lean();

  const rowsByDate = {};
  for (const r of rows) {
    (rowsByDate[r.date] ||= []).push(r);
  }

  const result = [];
  for (const date of dates) {
    const weekday = getISTDayName(date);
    const { entries: masterEntries } = await getMasterEntriesForDate(salon._id, date);
    const dateRows = rowsByDate[date] || [];

    // isOverride: COMPUTED, not stored — true whenever this ACTIVE row
    // does not match what the CURRENT master resolves for this exact
    // professional+chair on this weekday (different time, different
    // chair, or the master has no such entry at all). A row that looks
    // exactly like what the recurring pattern would produce is not
    // presented as an override, regardless of its internal `source`.
    //
    // Precedence fix — an ACTIVE PCA row for this date is authoritative
    // and is used exactly as-is whenever ANY exists (never partially
    // replaced/merged with the master). Only when there are NO ACTIVE
    // PCA rows at all does the master's own weekday entries become the
    // presented (not stored, not materialized by this read) resolved
    // schedule — every matching master entry, not just the first —
    // so the owner sees the recurring pattern even on a date the
    // materializer hasn't reached yet, exactly as the approved
    // 3-tier precedence (PCA > master > no schedule) requires.
    const entries = dateRows.length
      ? dateRows.map((row) => {
          const masterMatch = masterEntries.find(
            (m) => String(m.professionalId) === String(row.professionalId) && String(m.chairId) === String(row.chairId)
          );
          const matchesMaster = !!masterMatch && masterMatch.startTime === row.startTime && masterMatch.endTime === row.endTime;
          return {
            professionalId: String(row.professionalId),
            chairId:        String(row.chairId),
            startTime:      row.startTime,
            endTime:        row.endTime,
            isOverride:     !matchesMaster,
          };
        })
      : masterEntries.map((m) => ({
          professionalId: String(m.professionalId),
          chairId:        String(m.chairId),
          startTime:      m.startTime,
          endTime:        m.endTime,
          isOverride:     false, // this IS the master's own entry, not a deviation from it
        }));

    result.push({ date, weekday, entries });
  }

  return result;
};

//////////////////////////////////////////////////////////////
// 🧠 2. BOOKING SAFETY — the approved, non-negotiable guard
//////////////////////////////////////////////////////////////

// Pure function, no DB access. Given an existing row's coverage and a
// proposed new state (or null for a full removal/cancel), returns the
// interval(s) of chair-time that would stop being covered. Moving to a
// different chair vacates the OLD chair's entire window, even if the
// duration is unchanged — the professional is no longer physically
// there during that window on that chair.
export const computeRemovedCoverage = ({ existingRow, proposed }) => {
  if (!existingRow) return [];

  if (!proposed || String(existingRow.chairId) !== String(proposed.chairId)) {
    return [{ chairId: String(existingRow.chairId), startTime: existingRow.startTime, endTime: existingRow.endTime }];
  }

  const removed = [];
  if (proposed.startTime > existingRow.startTime) {
    removed.push({ chairId: String(existingRow.chairId), startTime: existingRow.startTime, endTime: proposed.startTime });
  }
  if (proposed.endTime < existingRow.endTime) {
    removed.push({ chairId: String(existingRow.chairId), startTime: proposed.endTime, endTime: existingRow.endTime });
  }
  return removed;
};

// Throws Errors.conflict(...) if any ACTIVE_BOOKING_STATUSES booking on
// the affected chair overlaps the coverage being removed. Chair-level
// matching only (not also professionalRef) — deliberately mirrors Rule
// C's own existing field choice in checkConflicts(), so this guard is
// never less conservative than the rule it complements. Never modifies,
// cancels, or reassigns the booking it finds — it only ever blocks.
export const assertNoBookingImpact = async ({ date, existingRow, proposed, session }) => {
  const removedIntervals = computeRemovedCoverage({ existingRow, proposed });
  if (!removedIntervals.length) return;

  const dayStart = toISTDateTime(date, "00:00");
  const dayEnd   = new Date(toISTDateTime(date, "23:59").getTime() + 60 * 1000);

  for (const interval of removedIntervals) {
    const removedStart = toISTDateTime(date, interval.startTime);
    const removedEnd   = toISTDateTime(date, interval.endTime);

    const activeBookings = await Booking.find({
      chairRef:  interval.chairId,
      startTime: { $gte: dayStart, $lt: dayEnd },
      status:    { $in: ACTIVE_BOOKING_STATUSES },
    }).select("startTime endTime").session(session || null).lean();

    const conflicting = activeBookings.find((b) =>
      overlaps(toAbsoluteInstant(b.startTime), toAbsoluteInstant(b.endTime), removedStart, removedEnd)
    );

    if (conflicting) {
      throw Errors.conflict(
        "Schedule cannot be changed for this time because a booking already exists.",
        { rule: "BOOKING_IMPACT", conflictingBookingId: conflicting._id, removedWindow: interval }
      );
    }
  }
};

//////////////////////////////////////////////////////////////
// 🚀 3. EDIT SCHEDULE FOR ONE DATE
//
// professionalId + chairId + date + startTime + endTime together
// describe the DESIRED end state. Four cases, all reusing the
// existing, unmodified PCA engine:
//
//   A. This professional already has an ACTIVE row this date, same
//      chair  → pure time edit           → updateAssignment()
//   B. This professional already has an ACTIVE row this date,
//      different chair → a chair move    → updateAssignment()
//      (updateAssignment already supports chairId changes; Rules
//      A/B/D re-validate the new chair automatically)
//   C. A DIFFERENT professional currently occupies the target chair
//      on this date → a genuine staff swap → cancel + create, the
//      one case that is not a single atomic document write, wrapped
//      in a real mongoose transaction (see below)
//   D. Neither exists → brand new           → createAssignment()
//
// Every case runs the booking-safety guard BEFORE any write.
//////////////////////////////////////////////////////////////

export const editScheduleForDate = async ({ ownerId, professionalId, chairId, date, startTime, endTime }) => {
  const salon = await resolveOwnerSalon(ownerId);

  if (date < todayIST()) {
    throw Errors.badRequest(`${date} is in the past — past dates cannot be edited`);
  }

  const existingForProfessional = await ProfessionalChairAssignment.findOne({
    salonId: salon._id, professionalId, date, status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();

  const proposed = { chairId, startTime, endTime };

  // Cases A/B — one document, one write, no transaction needed.
  if (existingForProfessional) {
    await assertNoBookingImpact({ date, existingRow: existingForProfessional, proposed });
    return updateAssignment({
      ownerId,
      assignmentId: existingForProfessional._id,
      payload: { chairId, startTime, endTime },
    });
  }

  const existingForChair = await ProfessionalChairAssignment.findOne({
    salonId: salon._id, chairId, date, status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();

  // Case C — a genuine staff swap. Two documents must change together
  // (the outgoing professional's row cancelled, the incoming
  // professional's row created) — reuses the exact
  // mongoose.startSession()/startTransaction()/commitTransaction()/
  // abortTransaction() pattern already established in
  // controllers/booking.controller.js, never a new transaction
  // architecture. If create fails after cancel succeeded, the whole
  // transaction aborts and the original assignment is restored exactly
  // as it was — no unsafe partial state is ever left behind.
  if (existingForChair) {
    await assertNoBookingImpact({ date, existingRow: existingForChair, proposed: null });

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await cancelAssignment({ ownerId, assignmentId: existingForChair._id, session });
      const created = await createAssignment({
        ownerId, chairId, professionalId, date, startTime, endTime,
        source: ASSIGNMENT_SOURCE.MANUAL, session,
      });
      await session.commitTransaction();
      session.endSession();
      return created[0];
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  // Case D — brand new, nothing to protect.
  const created = await createAssignment({
    ownerId, chairId, professionalId, date, startTime, endTime, source: ASSIGNMENT_SOURCE.MANUAL,
  });
  return created[0];
};

//////////////////////////////////////////////////////////////
// 🚀 4. RESTORE ONE DATE TO THE MASTER SCHEDULE (approved product
// decision — removing an override must NOT leave the date
// unscheduled; it must immediately fall back to whatever the
// currently-effective WeeklyScheduleTemplate provides, synchronously,
// never waiting for the next materializer run).
//////////////////////////////////////////////////////////////

export const restoreDateToMaster = async ({ ownerId, professionalId, date }) => {
  const salon = await resolveOwnerSalon(ownerId);

  if (date < todayIST()) {
    throw Errors.badRequest(`${date} is in the past — past dates cannot be restored`);
  }

  const existing = await ProfessionalChairAssignment.findOne({
    salonId: salon._id, professionalId, date, status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();

  if (!existing) {
    throw Errors.notFound("No active schedule override exists for this professional on this date");
  }

  const { entries: masterEntries } = await getMasterEntriesForDate(salon._id, date);
  const masterEntry = masterEntries.find((m) => String(m.professionalId) === String(professionalId));

  // If the master has no entry for this professional at all that
  // weekday, "restoring" correctly means "no schedule" — not an error,
  // and not left as the old override.
  const proposed = masterEntry
    ? { chairId: masterEntry.chairId, startTime: masterEntry.startTime, endTime: masterEntry.endTime }
    : null;

  await assertNoBookingImpact({ date, existingRow: existing, proposed });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await cancelAssignment({ ownerId, assignmentId: existing._id, session });

    let created = null;
    if (proposed) {
      const rows = await createAssignment({
        ownerId, chairId: proposed.chairId, professionalId, date,
        startTime: proposed.startTime, endTime: proposed.endTime,
        source: ASSIGNMENT_SOURCE.TEMPLATE, session,
      });
      created = rows[0];
    }

    await session.commitTransaction();
    session.endSession();
    return created; // null when the master has nothing for this professional that day
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
};
