import Booking from "../models/Booking.js";
import Chair from "../models/Chair.js";
import ChairAvailabilityOverride from "../models/ChairAvailabilityOverride.js";
import { CHAIR_AVAILABILITY_STATUS } from "../constants/chairAvailability.constants.js";

//////////////////////////////////////////////////////////////
// 🔥 CHAIR TIMELINE ENGINE — FINAL (ZOMATO GRADE)
//////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////
// 🧠 GET ACTIVE CHAIRS
//////////////////////////////////////////////////////////////

export const getActiveChairs = async (salonId) => {
  return await Chair.find({
    salonId: salonId,
    isActive: true,
    $or: [
      { disabledUntil: null },
      { disabledUntil: { $lte: new Date() } },
    ],
  })
    .select("_id name priority totalBookingsToday")
    .lean();
};

//////////////////////////////////////////////////////////////
// 📅 GET BOOKINGS FOR DAY (TIMEZONE SAFE)
//////////////////////////////////////////////////////////////

export const getBookingsForDay = async (salonId, date) => {
  const start = new Date(`${date}T00:00:00+05:30`);
  const end   = new Date(`${date}T23:59:59+05:30`);

  return await Booking.find({
    salonRef: salonId,
    startTime: { $gte: start, $lte: end },
    status: { $in: ["HOLD", "CONFIRMED", "ONGOING"] },
  })
    // FIX-2: added bufferTime so FIX-1 can use it below
    .select("chairRef startTime endTime bufferTime")
    .lean();
};

//////////////////////////////////////////////////////////////
// 🧠 OCCUPIED-END HELPER (BUFFER-AWARE)
//
// Extracted out of buildChairTimeline (pure refactor — identical
// math, identical output) so other write-paths that need the same
// "is this chair actually free" definition can import it instead
// of re-deriving their own buffer formula. Chair Availability
// Engine's overlap validation (chairAvailability.service.js) is
// the first consumer — locked rule: reuse the existing buffer
// calculation, do not create another implementation.
//////////////////////////////////////////////////////////////

export const computeOccupiedEnd = (endTime, bufferTime = 0) => {
  const serviceEnd = new Date(endTime).getTime();
  const bufferMs    = (bufferTime || 0) * 60 * 1000;
  return new Date(serviceEnd + bufferMs);
};

//////////////////////////////////////////////////////////////
// 🧠 IST DATE/TIME PARSING — SINGLE SOURCE OF TRUTH
//
// Every date/time conversion in this engine (and any write-path
// that needs to compare against it, e.g. Chair Availability's
// overlap validation) funnels through these two functions instead
// of an ad hoc inline `new Date(...)`. Extracted from the inline
// template `breaksToIntervals` already used (pure refactor —
// identical output) so there is exactly one implementation of the
// IST-offset convention, not one per file.
//////////////////////////////////////////////////////////////

// "YYYY-MM-DD" + "HH:mm" (wall-clock, no seconds) → IST-anchored
// Date. For values that carry their own seconds precision (the
// day-boundary/working-hours strings built below) this is
// deliberately NOT used, since those need a different suffix
// (":59" vs this function's fixed ":00") and reusing it there
// would silently change their boundary by up to 59 seconds.
export const toISTDateTime = (date, time) => new Date(`${date}T${time}:00+05:30`);

// Coerces an already-absolute stored value (a Mongoose Date field,
// an ISO string) into a Date instance. NOT an IST-parsing
// operation — Booking.startTime/endTime are absolute instants
// already, so there is no wall-clock offset to apply here. Named
// and exported so every consumer shares this one line instead of
// an unlabeled inline `new Date(x)` that looks identical to (but
// isn't actually shared with) the IST-parsing convention above.
export const toAbsoluteInstant = (value) => new Date(value);

//////////////////////////////////////////////////////////////
// 🧠 BUILD TIMELINE PER CHAIR
//////////////////////////////////////////////////////////////

export const buildChairTimeline = (chairs, bookings) => {
  const timelineMap = {};

  // init
  for (const chair of chairs) {
    const key = chair._id.toString();
    timelineMap[key] = [];
  }

  // assign bookings
  for (const booking of bookings) {
    const chairId = booking.chairRef?.toString();

    if (!timelineMap[chairId]) continue;

    // FIX-1: timeline block end = endTime + bufferTime
    //
    // OLD: end: new Date(booking.endTime)
    // Problem: timeline showed service end only — gap engine saw
    // cleanup window as free, allowing back-to-back bookings with
    // zero cleanup time between them. Operational inconsistency.
    //
    // NEW: end = endTime + bufferTime
    // Now the blocked window = service + cleanup, matching
    // slot engine, overlap engine, and confirmation engine.
    // All engines now share the same occupancy truth.
    // (Math extracted into computeOccupiedEnd() above — same
    // formula, same output, now reusable by other write-paths.)
    const occupiedEnd = computeOccupiedEnd(booking.endTime, booking.bufferTime);

    timelineMap[chairId].push({
      start:          toAbsoluteInstant(booking.startTime),
      end:            occupiedEnd,          // includes cleanup buffer
      serviceEnd:     new Date(booking.endTime), // raw service end (for display)
      bufferTime:     booking.bufferTime || 0,
    });
  }

  // sort timelines
  for (const chairId in timelineMap) {
    timelineMap[chairId].sort((a, b) => a.start - b.start);
  }

  return timelineMap;
};

//////////////////////////////////////////////////////////////
// ☕ BREAK WINDOWS → BLOCKED INTERVALS
//
// A break is structurally identical to a booking from findGaps'
// point of view — just another blocked window. Converting them
// to the same {start, end} Date shape lets findGaps split gaps
// around breaks with zero changes to its own logic.
//////////////////////////////////////////////////////////////

const breaksToIntervals = (date, breaks = []) =>
  breaks.map((b) => ({
    start: toISTDateTime(date, b.start),
    end:   toISTDateTime(date, b.end),
  }));

//////////////////////////////////////////////////////////////
// 🚧 CHAIR AVAILABILITY BLOCKS → PER-CHAIR BLOCKED INTERVALS
//
// Chair Availability Engine (Phase 1). Unlike breaks (salon-wide,
// apply to every chair equally), a block is scoped to ONE chair —
// so blocks are grouped by chairId here before being merged into
// that chair's own blockedIntervals below. Same {start, end} Date
// shape as bookings/breaks, so findGaps needs zero changes to
// consume it — this is the ONLY production integration point for
// the Chair Availability Engine.
//////////////////////////////////////////////////////////////

export const getActiveChairBlocks = async (salonId, date) => {
  return await ChairAvailabilityOverride.find({
    salonId,
    date,
    status: CHAIR_AVAILABILITY_STATUS.ACTIVE,
  })
    .select("chairId startTime endTime")
    .lean();
};

const blocksToChairIntervalMap = (date, blocks = []) => {
  const map = {};

  for (const block of blocks) {
    const key = block.chairId.toString();
    if (!map[key]) map[key] = [];

    map[key].push({
      start: toISTDateTime(date, block.startTime),
      end:   toISTDateTime(date, block.endTime),
    });
  }

  return map;
};

//////////////////////////////////////////////////////////////
// 🔍 FIND GAPS IN TIMELINE
//////////////////////////////////////////////////////////////

export const findGaps = (timeline, startOfDay, endOfDay) => {
  const gaps = [];

  let lastEnd = startOfDay;

  for (const slot of timeline) {
    if (slot.start > lastEnd) {
      gaps.push({
        start: new Date(lastEnd),
        end:   new Date(slot.start),
      });
    }

    lastEnd = new Date(Math.max(lastEnd, slot.end));
  }

  // final trailing gap
  if (lastEnd < endOfDay) {
    gaps.push({
      start: new Date(lastEnd),
      end:   new Date(endOfDay),
    });
  }

  return gaps;
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN FUNCTION
//////////////////////////////////////////////////////////////

export const getChairTimelines = async ({
  salonId,
  date,
  serviceDuration = 0,
  bufferTime      = 0,
  openHour        = 0,
  openMin         = 0,
  closeHour       = 23,
  closeMin        = 59,
  breaks          = [],
}) => {
  try {
    //////////////////////////////////////////////////////////
    // FETCH DATA
    //////////////////////////////////////////////////////////

    // Parallelized — none of these three depend on another's result
    // (each only needs salonId/date; the chair-grouping join happens
    // afterward in JS), and this function runs on every slot-availability
    // lookup platform-wide, so a 3rd sequential round-trip here is not
    // a one-off cost — it's paid on every call, forever.
    const [chairs, bookings, chairBlocks] = await Promise.all([
      getActiveChairs(salonId),
      getBookingsForDay(salonId, date),
      getActiveChairBlocks(salonId, date),
    ]);

    //////////////////////////////////////////////////////////
    // BUILD TIMELINES
    //////////////////////////////////////////////////////////

    const timelineMap = buildChairTimeline(chairs, bookings);

    // Salon-wide, applies to every chair equally — not chair-specific,
    // so it's merged in per-chair below rather than stored in timelineMap.
    const breakIntervals = breaksToIntervals(date, breaks);

    // Chair-specific (Chair Availability Engine) — grouped by chairId,
    // merged in per-chair below alongside breaks and bookings.
    const blockIntervalMap = blocksToChairIntervalMap(date, chairBlocks);

    //////////////////////////////////////////////////////////
    // WORKING HOURS (CONFIGURABLE)
    //////////////////////////////////////////////////////////

    const startOfDay = new Date(`${date}T${String(openHour).padStart(2,'0')}:${String(openMin).padStart(2,'0')}:00+05:30`);
    const endOfDay = new Date(`${date}T${String(closeHour).padStart(2,'0')}:${String(closeMin).padStart(2,'0')}:00+05:30`);


    //////////////////////////////////////////////////////////
    // MIN REQUIRED SLOT (GAP FILTER)
    // Must fit: service + cleanup buffer
    //////////////////////////////////////////////////////////

    const minDurationMs = (serviceDuration + bufferTime) * 60 * 1000;

    //////////////////////////////////////////////////////////
    // FINAL RESULT
    //////////////////////////////////////////////////////////

    const result = [];

    for (const chair of chairs) {
      const key      = chair._id.toString();
      const timeline = timelineMap[key] || [];
      const chairAvailabilityBlocks = blockIntervalMap[key] || [];

      // Bookings + breaks + Chair Availability blocks, merged and
      // re-sorted — findGaps only cares that it receives blocked
      // intervals in start-time order, regardless of source. A block
      // outside this chair's key simply never reaches this chair, so
      // it participates normally outside its own blocked window.
      const blockedIntervals = [...timeline, ...breakIntervals, ...chairAvailabilityBlocks]
        .sort((a, b) => a.start - b.start);

      const gaps = findGaps(blockedIntervals, startOfDay, endOfDay);

      // Only return gaps large enough to fit service + buffer
      const validGaps = gaps.filter(
        (g) => g.end - g.start >= minDurationMs
      );

      result.push({
        chairId:  chair._id,
        name:     chair.name,
        priority: chair.priority,
        load:     chair.totalBookingsToday,
        timeline,
        gaps:     validGaps,
      });
    }

    return result;

  } catch (error) {
    console.error("Timeline engine error:", error);
    return [];
  }
};