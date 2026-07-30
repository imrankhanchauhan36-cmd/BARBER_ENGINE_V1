import redis, { isRedisReady } from "../config/redis.js";
import Salon from "../models/Salon.js";
import Service from "../models/Service.js";
import { getChairTimelines } from "./chairTimeline.service.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const SLOT_INTERVAL = 5;  // minutes between candidate slot starts

// IST offset in milliseconds — used for safe date parsing.
// new Date("YYYY-MM-DD") parses as UTC midnight. On a UTC server,
// that's the previous calendar day in IST (UTC+5:30 = 18:30 prev day).
// Appending the IST offset string forces the correct local midnight.
const IST_OFFSET_SUFFIX = "T00:00:00+05:30";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////////////////

/**
 * Parse a "YYYY-MM-DD" date string as IST midnight.
 *
 * Problem: new Date("2024-01-15") → 2024-01-15T00:00:00.000Z (UTC midnight)
 *   → In IST that's 2024-01-15T05:30:00+05:30, but toLocaleDateString
 *     with timeZone "Asia/Kolkata" on the UTC object returns Jan 15 ✅.
 *   HOWEVER: if the server is UTC, new Date("2024-01-14T18:30:00Z")
 *   (from a date string without a time zone) can cause getChairTimelines
 *   to receive a date that straddles two IST calendar days depending on
 *   how it constructs its query range internally.
 *
 * Fix: always parse as IST midnight explicitly.
 */
const parseISTDate = (dateStr) => new Date(`${dateStr}${IST_OFFSET_SUFFIX}`);

/**
 * Get the IST weekday name (lowercase) for a Date object.
 * Used to look up today's salon opening hours.
 */
const getISTDayName = (date) =>
  date.toLocaleDateString("en-US", {
    weekday:  "long",
    timeZone: "Asia/Kolkata",
  }).toLowerCase();

//////////////////////////////////////////////////////////////
// 🧠 GENERATE SLOTS FROM GAP
//
// Generates candidate slot start times within a free gap on a chair.
// Each slot occupies (serviceDuration + bufferTime) minutes total:
//   serviceDuration = active service time
//   bufferTime      = post-service cleanup / turnaround time
//
// Slots step forward by SLOT_INTERVAL minutes until the next slot
// would exceed the gap end.
//////////////////////////////////////////////////////////////

const generateSlotsFromGap = (gap, serviceDuration, bufferTime) => {
  const slots         = [];
  const totalDuration = (serviceDuration + bufferTime) * 60 * 1000;
  let   current       = new Date(gap.start);

  while (true) {
    const end = new Date(current.getTime() + totalDuration);

    if (end > gap.end) break;

    slots.push({ start: new Date(current), end });

    current = new Date(current.getTime() + SLOT_INTERVAL * 60 * 1000);
  }

  return slots;
};

//////////////////////////////////////////////////////////////
// 🧠 MERGE ALL CHAIRS → GLOBAL SLOT MAP
//
// Groups slots from all chairs by their start time.
// A given start time may be available on multiple chairs —
// all eligible chairs are collected so the best one can be
// chosen in the next step.
//////////////////////////////////////////////////////////////

const mergeSlots = (allChairSlots) => {
  const slotMap = {};

  for (const chair of allChairSlots) {
    for (const slot of chair.slots) {
      const key = slot.start.toISOString();

      if (!slotMap[key]) {
        slotMap[key] = {
          start:  slot.start,
          end:    slot.end,
          chairs: [],
        };
      }

      slotMap[key].chairs.push({
        chairId:  chair.chairId,
        priority: chair.priority,
        load:     chair.load,
      });
    }
  }

  return Object.values(slotMap);
};

//////////////////////////////////////////////////////////////
// 🧠 PICK BEST CHAIR (LOAD BALANCING)
//
// Selection criteria (in order):
//   1. Lowest current load (bookings already on this chair today)
//   2. Highest priority (salon-defined chair rank — e.g. senior barber)
//
// Spreading load evenly across chairs prevents a single chair from
// becoming a bottleneck while others sit idle.
//////////////////////////////////////////////////////////////

const pickBestChair = (chairs) =>
  [...chairs].sort((a, b) => {
    if (a.load !== b.load) return a.load - b.load;   // lowest load first
    return b.priority - a.priority;                   // highest priority first
  })[0];

//////////////////////////////////////////////////////////////
// 🚀 MAIN EXPORT
//////////////////////////////////////////////////////////////

/**
 * Generate smart, buffer-aware, load-balanced available slots
 * for a given salon + date + service configuration.
 *
 * @param {string|ObjectId} salonId
 * @param {string}          date           "YYYY-MM-DD" in IST
 * @param {number}          serviceDuration minutes of active service time
 * @param {number}          [bufferTime=0]  minutes of post-service cleanup
 *
 * @returns {Array<{
 *   start:    Date,
 *   end:      Date,       // start + serviceDuration + bufferTime
 *   chairId:  ObjectId,
 *   available: true,
 *   label:    string,     // "10:30 AM" in IST — for UI display
 * }>}
 */
export const getSmartSlots = async ({
  salonId,
  date,
  serviceDuration,
  bufferTime = 0,
}) => {
  try {
    //////////////////////////////////////////////////////////
    // STEP 1: RESOLVE SALON OPENING HOURS FOR THIS DATE
    //////////////////////////////////////////////////////////

    // Parse date as IST midnight — avoids UTC/IST calendar day mismatch
    // when the server runs in UTC (new Date("YYYY-MM-DD") = UTC midnight
    // = previous IST day at 18:30).
    const dateIST   = parseISTDate(date);
    const dayName   = getISTDayName(dateIST);

    const salon = await Salon.findById(salonId).select("timings").lean();

    const todayTiming = salon?.timings?.[dayName];

    // Explicitly marked closed → zero slots, full stop. Previously this
    // fell through to the "no timing configured" default below and
    // generated slots for the entire day even on a day the owner
    // marked closed.
    if (todayTiming?.isClosed) return [];

    let openHour  = 0;
    let openMin   = 0;
    let closeHour = 23;
    let closeMin  = 59;

    if (todayTiming) {
      openHour  = parseInt(todayTiming.open.split(":")[0],  10);
      openMin   = parseInt(todayTiming.open.split(":")[1],  10);

      // "00:00" as a close time means "closes at midnight" (end of day) —
      // treat it as 23:59 (last bookable minute of THIS calendar day),
      // matching how isOpen24Hours already normalizes. Taken literally,
      // "00:00" parses as the START of the day, producing an inverted
      // (endOfDay < startOfDay) window in chairTimeline.service.js and
      // silently zeroing out every slot.
      if (todayTiming.close === "00:00") {
        closeHour = 23;
        closeMin  = 59;
      } else {
        closeHour = parseInt(todayTiming.close.split(":")[0], 10);
        closeMin  = parseInt(todayTiming.close.split(":")[1], 10);
      }
    }

    // Applies identically whether the day is normal hours or 24-hour —
    // both just have a breaks array on the same todayTiming object.
    const breaks = todayTiming?.breaks || [];

    //////////////////////////////////////////////////////////
    // STEP 2: GET FREE GAPS PER CHAIR
    //////////////////////////////////////////////////////////

    const timelines = await getChairTimelines({
      salonId,
      date,
      serviceDuration,
      bufferTime,
      openHour,
      openMin,
      closeHour,
      closeMin,
      breaks,
    });

    if (!timelines.length) return [];

    //////////////////////////////////////////////////////////
    // STEP 3: GENERATE CANDIDATE SLOTS PER CHAIR
    //
    // Each gap on each chair produces a series of slot start
    // times spaced SLOT_INTERVAL minutes apart. Each slot's
    // end = start + serviceDuration + bufferTime, so the chair
    // is considered occupied for the full service + cleanup window.
    //////////////////////////////////////////////////////////

    const allChairSlots = timelines.map((chair) => {
      const slots = chair.gaps.flatMap((gap) =>
        generateSlotsFromGap(gap, serviceDuration, bufferTime)
      );

      return {
        chairId:  chair.chairId,
        priority: chair.priority,
        load:     chair.load,
        slots,
      };
    });

    //////////////////////////////////////////////////////////
    // STEP 4: MERGE SLOTS ACROSS CHAIRS
    //////////////////////////////////////////////////////////

    const mergedSlots = mergeSlots(allChairSlots);

    //////////////////////////////////////////////////////////
    // STEP 5: PICK BEST CHAIR PER SLOT (LOAD BALANCING)
    //////////////////////////////////////////////////////////

    const finalSlots = mergedSlots.map((slot) => {
      const bestChair = pickBestChair(slot.chairs);

      return {
        start:     slot.start,
        end:       slot.end,
        chairId:   bestChair.chairId,
        available: true,

        // IST-formatted label for UI display — never used for logic
        label: slot.start.toLocaleTimeString("en-IN", {
          hour:     "2-digit",
          minute:   "2-digit",
          timeZone: "Asia/Kolkata",
        }),
      };
    });

    //////////////////////////////////////////////////////////
    // STEP 6: SORT → FILTER PAST
    //
    // No count cap — a day's slot list is inherently bounded by
    // the calendar (startOfDay/endOfDay + SLOT_INTERVAL stepping),
    // never by an arbitrary limit. See architecture review: even
    // the most extreme case in this system (isOpen24Hours + a
    // 5-minute service) tops out around ~288 candidates, a small,
    // fixed payload regardless of total users/salons on the platform.
    //////////////////////////////////////////////////////////////

    const now = new Date();

    return finalSlots
      .sort((a, b) => a.start - b.start)
      .filter((slot) => slot.start > now);

  } catch (error) {
    console.error(`[SlotEngine] Error for salon=${salonId} date=${date}:`, error.message);
    return [];
  }
};

//////////////////////////////////////////////////////////////
// 🚀 NEXT SLOT LABEL — Home Screen "Next Slot" card
//
// Returns the earliest available slot label (e.g. "01:15 PM") for
// a salon, using its SMALLEST active service (duration+buffer) —
// not a fixed 30-min assumption. Cached in Redis (120s TTL) since
// this runs per-salon on every Home Screen load (max 6 salons via
// HomeAvailableNow — cost-control, NOT the full 20-salon list).
//
// Cache invalidation: event-based, NOT time-only.
//   - Booking confirm/complete/cancel  → invalidateNextSlotCache()
//     (deletes ONE exact-date key)
//   - Salon config change (timings,
//     holiday, service duration/buffer,
//     staff hours, chair count)        → invalidateAllNextSlotCache()
//     (SCAN + delete ALL date keys for that salon)
// TTL (120s) is a safety net for any missed invalidation, not the
// primary freshness mechanism.
//////////////////////////////////////////////////////////////

const NEXT_SLOT_CACHE_TTL = 120; // seconds

const nextSlotCacheKey = (salonId, date) => `nextSlot:${salonId}:${date}`;

export const getNextSlotLabel = async (salonId, date) => {
  const cacheKey = nextSlotCacheKey(salonId, date);

  // STEP A: Redis check
  if (isRedisReady()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        return cached === "" ? null : cached; // "" = cached "no slots"
      }
    } catch (err) {
      console.warn(`[NextSlotLabel] Redis read failed for ${cacheKey}:`, err.message);
    }
  }

  // STEP B: find salon's active services, pick the MOST-BOOKED one —
  // this is the business-meaningful default ("what customers actually
  // book here"), not just "whatever finishes fastest". Falls back to
  // smallest duration+buffer when no service has any bookings yet
  // (e.g. a brand-new salon), so Day-1 salons still get a sane label.
  const activeServices = await Service.find({
    salonId,
    isActive:  true,
    isDeleted: false,
    })
      .select("duration buffer bookingCount")
      .lean();
  
  if (!activeServices.length) {
    if (isRedisReady()) {
      try {
        await redis.set(cacheKey, "", { EX: NEXT_SLOT_CACHE_TTL });
        } catch (_) {}
      }
    return null;
  }

  const hasAnyBookings = activeServices.some((s) => (s.bookingCount || 0) > 0);

  const chosenService = hasAnyBookings
    ? activeServices.reduce((max, s) =>
        (s.bookingCount || 0) > (max.bookingCount || 0) ? s : max
      )
    : activeServices.reduce((min, s) =>
        (s.duration + s.buffer) < (min.duration + min.buffer) ? s : min
      );

  // STEP C: reuse existing getSmartSlots() — no new slot logic
  const slots = await getSmartSlots({
    salonId,
    date,
    serviceDuration: chosenService.duration,
    bufferTime:      chosenService.buffer,
  });

  const label = slots.length > 0 ? slots[0].label : null;

  // STEP D: cache result (even null, to avoid repeated DB hits)
  if (isRedisReady()) {
    try {
      await redis.set(cacheKey, label ?? "", { EX: NEXT_SLOT_CACHE_TTL });
    } catch (err) {
      console.warn(`[NextSlotLabel] Redis write failed for ${cacheKey}:`, err.message);
    }
  }

  // STEP E: return
  return label;
};

// BOOKING events (confirm/complete/cancel) — invalidate ONE exact date.
export const invalidateNextSlotCache = async (salonId, date) => {
  if (!isRedisReady()) return;
  try {
    await redis.del(nextSlotCacheKey(salonId, date));
  } catch (err) {
    console.warn(`[NextSlotLabel] Cache invalidation failed for salon=${salonId}:`, err.message);
  }
};

// CONFIG events (timings, holiday, service duration/buffer, staff
// hours, chair count) — invalidate ALL future date keys for the
// salon. Rare admin-side event, safe to SCAN at this frequency.
export const invalidateAllNextSlotCache = async (salonId) => {
  if (!isRedisReady()) return;

  const pattern = `nextSlot:${salonId}:*`;
  const keysToDelete = [];

  try {
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      keysToDelete.push(key);
    }
    if (keysToDelete.length > 0) {
      await redis.del(keysToDelete);
    }
  } catch (err) {
    console.warn(`[NextSlotLabel] Bulk cache invalidation failed for salon=${salonId}:`, err.message);
  }
};