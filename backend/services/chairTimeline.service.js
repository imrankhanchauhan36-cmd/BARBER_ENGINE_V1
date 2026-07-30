import Booking from "../models/Booking.js";
import Chair from "../models/Chair.js";

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
    const serviceEnd  = new Date(booking.endTime).getTime();
    const bufferMs    = (booking.bufferTime || 0) * 60 * 1000;
    const occupiedEnd = new Date(serviceEnd + bufferMs);

    timelineMap[chairId].push({
      start:          new Date(booking.startTime),
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
    start: new Date(`${date}T${b.start}:00+05:30`),
    end:   new Date(`${date}T${b.end}:00+05:30`),
  }));

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

    const chairs   = await getActiveChairs(salonId);
    const bookings = await getBookingsForDay(salonId, date);

    //////////////////////////////////////////////////////////
    // BUILD TIMELINES
    //////////////////////////////////////////////////////////

    const timelineMap = buildChairTimeline(chairs, bookings);

    // Salon-wide, applies to every chair equally — not chair-specific,
    // so it's merged in per-chair below rather than stored in timelineMap.
    const breakIntervals = breaksToIntervals(date, breaks);

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

      // Bookings + breaks, merged and re-sorted — findGaps only cares
      // that it receives blocked intervals in start-time order.
      const blockedIntervals = [...timeline, ...breakIntervals]
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