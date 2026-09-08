//////////////////////////////////////////////////////////////
// ROLLING-WINDOW MATERIALIZER — SERVICE (C4 Phase 2)
//
// Orchestration ONLY. This file never reimplements eligibility,
// ownership, or conflict logic — every concrete row it creates goes
// through the existing, unmodified createAssignment() (Rules A-D,
// chair/professional eligibility, salon ownership) in
// professionalChairAssignment.service.js. This file's only jobs are:
//
//   1. Find salons with an ACTIVE WeeklyScheduleTemplate.
//   2. For each, compute the current rolling window (today..today+N-1)
//      from Salon.business.bookingWindowDays (default 7).
//   3. For each date in that window, resolve the applicable template
//      version (latest ACTIVE version with effectiveFrom <= date),
//      skip the date entirely if the salon is closed/holiday that
//      date (existing authoritative sources only — Salon.timings,
//      HolidayOverride — never a new closure rule).
//   4. For each weekday entry, skip if ANY row already exists for
//      {salonId, professionalId, chairId, date} regardless of status
//      (never resurrect a cancelled owner exception) — otherwise
//      attempt createAssignment({..., source: "TEMPLATE"}).
//
// Never touches Booking, the Slot Engine, Chair Timeline, or
// professionalAvailability.service.js. Never wrapped in one giant
// transaction — every entry is independently try/caught, matching
// every existing background job's own per-candidate resilience
// convention (jobs/autoComplete.job.js, jobs/serviceOverdue.job.js,
// etc.).
//////////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import HolidayOverride from "../models/HolidayOverride.js";
import WeeklyScheduleTemplate from "../models/WeeklyScheduleTemplate.js";
import ProfessionalChairAssignment from "../models/ProfessionalChairAssignment.js";

import { WEEKDAYS } from "../constants/weeklyScheduleTemplate.constants.js";
import { ASSIGNMENT_SOURCE } from "../constants/professionalChairAssignment.constants.js";
import { createAssignment } from "./professionalChairAssignment.service.js";
import logger from "../utils/logger.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

// Recommended default and ceiling for Salon.business.bookingWindowDays
// — kept here (not just in the model) because this is the one place
// that actually consumes the value and needs a safe fallback when a
// salon has never set one. A rolling MATERIALIZATION window is a
// continuously-recreating daily cost, unlike C1's own one-time
// MAX_ASSIGNMENT_RANGE_DAYS=62 (a single owner action) — 30 is a
// deliberately tighter, more conservative ceiling for that reason.
export const DEFAULT_BOOKING_WINDOW_DAYS = 7;
export const MAX_BOOKING_WINDOW_DAYS = 30;

// Bounds how many salons are loaded into memory per DB round-trip —
// mirrors the BATCH_SIZE convention every existing job in jobs/ uses.
const SALON_BATCH_SIZE = 100;

const JOB_NAME = "[WeeklyScheduleMaterializer]";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS — same local-duplication convention every other service
// in this codebase already uses (independent copy, not shared).
//////////////////////////////////////////////////////////////

const IST_TZ = "Asia/Kolkata";

const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: IST_TZ }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// "YYYY-MM-DD" -> "YYYY-MM-DD" + n days, staying in plain calendar-date
// arithmetic (UTC-anchored, since the string itself carries no time
// component) — matches enumerateDates()'s own technique in
// professionalChairAssignment.service.js.
const addDaysToDateString = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const getISTDayName = (dateStr) =>
  new Date(`${dateStr}T12:00:00Z`)
    .toLocaleDateString("en-US", { timeZone: IST_TZ, weekday: "long" })
    .toLowerCase();

// LOCKED Decision #1 — today + (N-1) future calendar days, inclusive.
export const computeWindowDates = (windowDays) => {
  const today = todayIST();
  const dates = [];
  for (let i = 0; i < windowDays; i++) {
    dates.push(addDaysToDateString(today, i));
  }
  return dates;
};

// Latest ACTIVE version with effectiveFrom <= targetDate. CANCELLED
// versions never participate (excluded by the status filter itself,
// not by any extra logic). Returns null if no applicable version
// exists — "nothing to materialize for this date," not an error.
export const resolveTemplateForDate = async (salonId, targetDate) => {
  return WeeklyScheduleTemplate.findOne({
    salonId,
    effectiveFrom: { $lte: targetDate },
    status: "ACTIVE",
  })
    .sort({ effectiveFrom: -1 })
    .lean();
};

// Existing-authoritative-source closure check ONLY — Salon.timings'
// own recurring weekly isClosed flag. HolidayOverride (date-specific)
// is checked separately by the caller so it gets its own distinct
// counter (skippedHoliday vs skippedClosed) — same underlying
// precedence slotEngine.service.js already uses live (holiday still
// wins first), just attributed to two different reasons for
// observability. Never a new closure rule; this file only reads.
const isSalonClosedForDate = (salon, dateStr) => {
  const dayName = getISTDayName(dateStr);
  const timing = salon?.timings?.[dayName];
  return !!timing?.isClosed;
};

//////////////////////////////////////////////////////////////
// 🔎 ERROR CLASSIFICATION — turns an AppError (or a raw Mongo error)
// from createAssignment() into one of the fixed reason codes for
// structured logging. Never swallows the original message.
//////////////////////////////////////////////////////////////

const classifyCreateError = (err) => {
  if (err?.code === 11000) return "DUPLICATE_RACE";
  if (err?.code === "CONFLICT") return "CONFLICT";
  if (err?.code === "NOT_FOUND") return "INVALID_REFERENCE";
  if (err?.code === "BAD_REQUEST") {
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("chair is inactive"))        return "INVALID_CHAIR";
    if (msg.includes("professional is inactive")) return "INVALID_PROFESSIONAL";
    if (msg.includes("past"))                     return "PAST_DATE";
    return "INVALID_REFERENCE";
  }
  return "DB_ERROR";
};

//////////////////////////////////////////////////////////////
// 🚀 MATERIALIZE ONE ENTRY (one professional+chair+date combination)
//////////////////////////////////////////////////////////////

const materializeEntry = async ({ salon, date, weekday, templateId, entry }) => {
  const identity = {
    salonId: String(salon._id),
    templateId: String(templateId),
    date,
    weekday,
    professionalId: String(entry.professionalId),
    chairId: String(entry.chairId),
  };

  // Existing-row rule (LOCKED) — ANY row for this exact combination,
  // regardless of status (ACTIVE or CANCELLED), blocks materialization.
  // This is intentionally a SEPARATE check from checkConflicts()'s own
  // Rule A/B (which only look at ACTIVE rows) — a cancelled owner
  // exception must never be resurrected, and checkConflicts() alone
  // cannot see it.
  const existing = await ProfessionalChairAssignment.exists({
    salonId: salon._id,
    professionalId: entry.professionalId,
    chairId: entry.chairId,
    date,
  });

  if (existing) {
    logger.info(`${JOB_NAME} skip`, { ...identity, result: "SKIPPED", reason: "ALREADY_EXISTS" });
    return { result: "skippedExisting" };
  }

  try {
    await createAssignment({
      ownerId: salon.ownerId,
      chairId: entry.chairId,
      professionalId: entry.professionalId,
      date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      source: ASSIGNMENT_SOURCE.TEMPLATE,
    });
    logger.info(`${JOB_NAME} created`, { ...identity, result: "CREATED" });
    return { result: "created" };
  } catch (err) {
    const reason = classifyCreateError(err);
    // A race against another materializer instance/tick resolving to
    // the exact same combination, or an expected validation rejection
    // (conflict, inactive reference), is a normal per-entry outcome —
    // not a job failure — so it's logged at warn. A genuinely
    // unexpected failure (DB_ERROR) is logged at error so it stays
    // visible/alertable, never silently swallowed, per the explicit
    // "do not swallow unexpected errors" requirement.
    const logFn = reason === "DB_ERROR" ? logger.error : logger.warn;
    logFn(`${JOB_NAME} skip`, { ...identity, result: "SKIPPED", reason, message: err.message });

    const resultByReason = {
      DUPLICATE_RACE:      "duplicateRace",
      CONFLICT:            "skippedConflict",
      INVALID_REFERENCE:   "skippedInvalidReference",
      INVALID_CHAIR:       "skippedInvalidReference",
      INVALID_PROFESSIONAL:"skippedInvalidReference",
      PAST_DATE:           "skippedInvalidReference",
    };
    return { result: resultByReason[reason] || "error", reason };
  }
};

//////////////////////////////////////////////////////////////
// 🚀 MATERIALIZE ONE SALON'S CURRENT WINDOW
//////////////////////////////////////////////////////////////

const materializeSalon = async (salon, counters) => {
  const windowDaysRaw = salon.business?.bookingWindowDays;
  const windowDays = Number.isInteger(windowDaysRaw) && windowDaysRaw > 0
    ? Math.min(windowDaysRaw, MAX_BOOKING_WINDOW_DAYS)
    : DEFAULT_BOOKING_WINDOW_DAYS;

  const dates = computeWindowDates(windowDays);

  // One query for every holiday in the window, instead of one query
  // per date — bounded by windowDays, never N+1 across dates.
  const holidayRows = await HolidayOverride.find({
    salonId: salon._id,
    date: { $in: dates },
    isHoliday: true,
  }).select("date").lean();
  const holidayDates = new Set(holidayRows.map((h) => h.date));

  for (const date of dates) {
    counters.datesChecked++;

    if (holidayDates.has(date)) {
      counters.skippedHoliday++;
      continue;
    }
    if (isSalonClosedForDate(salon, date)) {
      counters.skippedClosed++;
      continue;
    }

    const template = await resolveTemplateForDate(salon._id, date);
    if (!template) {
      counters.skippedNoTemplate++;
      continue;
    }

    const weekday = getISTDayName(date);
    const entries = template.days?.[weekday]?.entries || [];

    for (const entry of entries) {
      const { result } = await materializeEntry({ salon, date, weekday, templateId: template._id, entry });
      switch (result) {
        case "created":                 counters.created++; break;
        case "skippedExisting":         counters.skippedExisting++; break;
        case "duplicateRace":           counters.duplicateRace++; break;
        case "skippedConflict":         counters.skippedConflict++; break;
        case "skippedInvalidReference": counters.skippedInvalidReference++; break;
        default:                        counters.errors++;
      }
    }
  }
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN ENTRY POINT — one full, idempotent pass. Never assumes the
// previous run succeeded; always recomputes the window from "today"
// fresh on every call.
//////////////////////////////////////////////////////////////

export const runMaterializerOnce = async () => {
  const counters = {
    salonsProcessed: 0,
    datesChecked: 0,
    created: 0,
    skippedExisting: 0,
    skippedClosed: 0,
    skippedHoliday: 0,
    skippedNoTemplate: 0,
    skippedConflict: 0,
    skippedInvalidReference: 0,
    duplicateRace: 0,
    errors: 0,
  };

  // Only salons that actually have an ACTIVE template do any work at
  // all — a salon with none costs nothing (LOCKED scale requirement).
  const salonIds = await WeeklyScheduleTemplate.distinct("salonId", { status: "ACTIVE" });

  for (let i = 0; i < salonIds.length; i += SALON_BATCH_SIZE) {
    const batchIds = salonIds.slice(i, i + SALON_BATCH_SIZE);
    const salons = await Salon.find({ _id: { $in: batchIds }, isDeleted: { $ne: true } })
      .select("ownerId timings business.bookingWindowDays")
      .lean();

    for (const salon of salons) {
      try {
        await materializeSalon(salon, counters);
        counters.salonsProcessed++;
      } catch (err) {
        counters.errors++;
        logger.error(`${JOB_NAME} salon-level failure`, { salonId: String(salon._id), message: err.message });
      }
    }
  }

  logger.info(`${JOB_NAME} run complete`, counters);
  return counters;
};
