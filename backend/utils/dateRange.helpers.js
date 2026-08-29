//////////////////////////////////////////////////////
// BARBER_ENGINE_V1
// utils/dateRange.helpers.js
//
// Business Performance — Date Range Selector (Phase 2, approved plan).
// Fixed IST (UTC+5:30) date-boundary math — deliberately NOT dependent
// on process.env.TZ or the host machine's locale, and deliberately NOT
// using any date library (dayjs/moment/date-fns), per the approved
// engineering decision. India observes no DST, so a fixed +330 minute
// offset is correct and sufficient on its own — this file must not be
// reused as-is for a timezone that does observe DST.
//
// Pure, synchronous, no I/O, no Mongo/Express imports — safe to
// exercise standalone without a DB connection. Used exclusively by the
// new /api/salon/owner/performance endpoint; does not touch and is not
// used by getDashboardStats()/getLiveSchedule() (salon.me.controller.js),
// which keep their own existing, unmodified date logic.
//////////////////////////////////////////////////////

const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+5:30, fixed (no DST in India)
const MAX_CUSTOM_RANGE_DAYS = 366; // approved cap — allows a full leap year

export const PERFORMANCE_RANGE = Object.freeze({
  TODAY: "TODAY",
  YESTERDAY: "YESTERDAY",
  LAST_7_DAYS: "LAST_7_DAYS",
  LAST_30_DAYS: "LAST_30_DAYS",
  THIS_MONTH: "THIS_MONTH",
  LAST_MONTH: "LAST_MONTH",
  CUSTOM: "CUSTOM",
});

const VALID_RANGES = new Set(Object.values(PERFORMANCE_RANGE));
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the IST calendar-date fields { year, month(0-11), day } of
 * `instantUtc` (default: now). Computed by shifting the UTC instant
 * forward by the fixed IST offset and reading ITS UTC getters — this
 * is what extracts "IST calendar fields" without ever touching the
 * host process's locale/TZ.
 */
function toISTCalendarFields(instantUtc = new Date()) {
  const shifted = new Date(instantUtc.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/** Midnight (00:00:00.000) IST of the given IST calendar date, as the equivalent UTC instant. */
function istStartOfDayUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/** 23:59:59.999 IST of the given IST calendar date, as the equivalent UTC instant. */
function istEndOfDayUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
}

function formatISTDateOnly(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses a "YYYY-MM-DD" string as an IST calendar date. Rejects
 * malformed strings AND impossible calendar dates (e.g. "2026-02-30")
 * — never silently rounds/wraps to a nearby valid date. Returns null
 * for any invalid input.
 */
function parseISTDateOnly(dateStr) {
  if (typeof dateStr !== "string" || !DATE_ONLY_PATTERN.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const year = y, month = m - 1, day = d;
  // Round-trip check: Date.UTC() silently normalizes out-of-range
  // components (e.g. day 30 in February rolls into March) — comparing
  // the reconstructed fields catches that instead of accepting it.
  const probe = new Date(Date.UTC(year, month, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * Adds `deltaDays` whole calendar days to the given IST calendar date.
 * Date.UTC() correctly rolls month/year boundaries — safe here because
 * this only ever feeds it whole calendar-day deltas and immediately
 * re-extracts the resulting UTC-getter fields, never mixed with the
 * IST offset math above.
 */
function addDaysToCalendar(year, month, day, deltaDays) {
  const shifted = new Date(Date.UTC(year, month, day + deltaDays));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function resolveCustomRange({ startDate, endDate, today }) {
  const start = parseISTDateOnly(startDate);
  const end = parseISTDateOnly(endDate);

  if (!start || !end) {
    return { error: "startDate and endDate are required and must be valid dates in YYYY-MM-DD format for a custom range." };
  }

  const startMs = Date.UTC(start.year, start.month, start.day);
  const endMs = Date.UTC(end.year, end.month, end.day);
  const todayMs = Date.UTC(today.year, today.month, today.day);

  if (startMs > todayMs) {
    return { error: "Start date cannot be in the future." };
  }
  if (endMs < startMs) {
    return { error: "End date cannot be before start date." };
  }

  // Forgiving clamp — an end date in the future is capped to today
  // rather than rejected (approved plan §2), not silently ignored.
  const effectiveEnd = endMs > todayMs ? today : end;
  const effectiveEndMs = Date.UTC(effectiveEnd.year, effectiveEnd.month, effectiveEnd.day);

  const spanDays = Math.round((effectiveEndMs - startMs) / 86400000) + 1;
  if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
    return { error: `Custom range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.` };
  }

  return {
    startUtc: istStartOfDayUtc(start.year, start.month, start.day),
    endUtc: istEndOfDayUtc(effectiveEnd.year, effectiveEnd.month, effectiveEnd.day),
    resolvedStartDate: formatISTDateOnly(start.year, start.month, start.day),
    resolvedEndDate: formatISTDateOnly(effectiveEnd.year, effectiveEnd.month, effectiveEnd.day),
  };
}

/**
 * The single entry point every caller uses. Resolves one of the 7
 * PERFORMANCE_RANGE values (plus, for CUSTOM, the caller-supplied
 * startDate/endDate query strings) into concrete UTC Date instants
 * ready for a Mongo $gte/$lte match, and the exact IST calendar dates
 * actually applied (echoed back in the API response so the client
 * never has to guess what was applied).
 *
 * Never throws for an expected validation failure — returns
 * { error: "<message>" } instead (this module's own established
 * "return a reason, don't throw for expected outcomes" convention).
 * A thrown exception here would only ever indicate a genuine bug.
 *
 * @returns {{error:string}|{startUtc:Date,endUtc:Date,resolvedStartDate:string,resolvedEndDate:string}}
 */
export function resolvePerformanceDateRange({ range, startDate, endDate }) {
  if (!range || !VALID_RANGES.has(range)) {
    return { error: `range is required and must be one of: ${[...VALID_RANGES].join(", ")}` };
  }

  const today = toISTCalendarFields();

  if (range === PERFORMANCE_RANGE.CUSTOM) {
    return resolveCustomRange({ startDate, endDate, today });
  }

  let startFields = today;
  let endFields = today;

  if (range === PERFORMANCE_RANGE.YESTERDAY) {
    startFields = endFields = addDaysToCalendar(today.year, today.month, today.day, -1);
  } else if (range === PERFORMANCE_RANGE.LAST_7_DAYS) {
    startFields = addDaysToCalendar(today.year, today.month, today.day, -6);
    endFields = today;
  } else if (range === PERFORMANCE_RANGE.LAST_30_DAYS) {
    startFields = addDaysToCalendar(today.year, today.month, today.day, -29);
    endFields = today;
  } else if (range === PERFORMANCE_RANGE.THIS_MONTH) {
    startFields = { year: today.year, month: today.month, day: 1 };
    endFields = today;
  } else if (range === PERFORMANCE_RANGE.LAST_MONTH) {
    // Day 0 of the current month === the last day of the previous
    // month (a standard, well-defined JS Date normalization), used
    // only to find that day and month — not mixed with offset math.
    const prevMonthLastDay = addDaysToCalendar(today.year, today.month, 1, -1);
    startFields = { year: prevMonthLastDay.year, month: prevMonthLastDay.month, day: 1 };
    endFields = prevMonthLastDay;
  }
  // TODAY falls through with the today/today default already set above.

  return {
    startUtc: istStartOfDayUtc(startFields.year, startFields.month, startFields.day),
    endUtc: istEndOfDayUtc(endFields.year, endFields.month, endFields.day),
    resolvedStartDate: formatISTDateOnly(startFields.year, startFields.month, startFields.day),
    resolvedEndDate: formatISTDateOnly(endFields.year, endFields.month, endFields.day),
  };
}

/**
 * Schedule's own, deliberately separate need — a SINGLE selected IST
 * calendar day (defaulting to today when `dateStr` is omitted), not a
 * multi-day preset. Reuses the exact same low-level IST primitives
 * this file already defines (toISTCalendarFields/istStartOfDayUtc/
 * istEndOfDayUtc/parseISTDateOnly/formatISTDateOnly) — the same
 * correct fixed-IST math resolvePerformanceDateRange() already uses —
 * but is intentionally NOT built on resolvePerformanceDateRange()
 * itself and does not touch PERFORMANCE_RANGE at all: Schedule
 * (single-day, operational) and Business Performance (7-preset,
 * reporting) are separate, deliberately uncoupled features per the
 * approved product decision. Adding this function changes nothing
 * about any existing export or caller in this file.
 *
 * Never throws for an expected validation failure — returns
 * { error: "<message>" } instead, matching this file's own
 * established convention.
 *
 * @returns {{error:string}|{startUtc:Date,endUtc:Date,resolvedDate:string}}
 */
export function resolveScheduleDate(dateStr) {
  if (!dateStr) {
    const today = toISTCalendarFields();
    return {
      startUtc: istStartOfDayUtc(today.year, today.month, today.day),
      endUtc: istEndOfDayUtc(today.year, today.month, today.day),
      resolvedDate: formatISTDateOnly(today.year, today.month, today.day),
    };
  }

  const parsed = parseISTDateOnly(dateStr);
  if (!parsed) {
    return { error: "date must be a valid calendar date in YYYY-MM-DD format." };
  }

  return {
    startUtc: istStartOfDayUtc(parsed.year, parsed.month, parsed.day),
    endUtc: istEndOfDayUtc(parsed.year, parsed.month, parsed.day),
    resolvedDate: formatISTDateOnly(parsed.year, parsed.month, parsed.day),
  };
}
