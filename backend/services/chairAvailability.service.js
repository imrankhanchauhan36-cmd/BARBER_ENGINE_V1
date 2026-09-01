//////////////////////////////////////////////////////////////
// CHAIR AVAILABILITY ENGINE — SERVICE (PHASE 1, BACKEND ONLY)
//
// Owner-facing WRITE path: create / cancel / list a time-based
// chair block. This is deliberately separate from the READ path
// (chairTimeline.service.js), mirroring how Holiday Override
// splits "record + validate" (salon.holiday.controller.js) from
// "enforce" (slotEngine.service.js reading HolidayOverride).
//
// Does NOT touch Slot Engine, Booking Engine, or Auto Assignment.
// Shared logic pulled in from elsewhere, never reimplemented:
//   - computeOccupiedEnd   — same buffer calculation Chair Timeline
//                            uses (locked business rule #8)
//   - toISTDateTime        — same "YYYY-MM-DD"+"HH:mm" -> IST Date
//                            parsing Chair Timeline uses for breaks
//                            and Chair Availability blocks
//   - toAbsoluteInstant    — same Date-coercion Chair Timeline uses
//                            for already-absolute Booking fields
// All three are exported from chairTimeline.service.js so there is
// exactly one implementation of each, not a local duplicate here.
//////////////////////////////////////////////////////////////

import Chair from "../models/Chair.js";
import Salon from "../models/Salon.js";
import Booking from "../models/Booking.js";
import ChairAvailabilityOverride from "../models/ChairAvailabilityOverride.js";

import { computeOccupiedEnd, toISTDateTime, toAbsoluteInstant } from "./chairTimeline.service.js";
import { invalidateAllNextSlotCache }                          from "./slotEngine.service.js";

import {
  CHAIR_AVAILABILITY_STATUS,
  CHAIR_AVAILABILITY_TYPE,
  ACTIVE_BOOKING_STATUSES,
} from "../constants/chairAvailability.constants.js";

import { toChairAvailabilityDTO, toChairAvailabilityListDTO } from "../dto/chairAvailability.dto.js";
import { Errors } from "../utils/response.js";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////////////////

// Same IST-midnight/"today" technique salon.holiday.controller.js
// uses, duplicated locally (not imported) so neither file needs to
// depend on the other and chairTimeline.service.js/slotEngine
// stay untouched by this concern. Derives "today" fresh from the
// clock — distinct from toISTDateTime/toAbsoluteInstant below,
// which parse a value that's already been supplied, not "now".
const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Rejects syntactically valid but impossible calendar dates
// (e.g. "2026-02-31", "2026-13-01") — the "YYYY-MM-DD" regex in
// the validator only checks shape, not existence. JS Date silently
// rolls invalid components over into the next valid date instead
// of throwing (new Date(2026, 1, 31) becomes March 3, 2026), so
// validity is confirmed by round-tripping through Date.UTC and
// checking the parsed components still match what was requested.
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

const resolveOwnerSalon = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
  if (!salon) throw Errors.notFound("Salon not found");
  return salon;
};

//////////////////////////////////////////////////////////////
// 🚀 1. CREATE BLOCK
//////////////////////////////////////////////////////////////

export const createChairBlock = async ({ ownerId, chairId, date, startTime, endTime, reason, type }) => {
  const salon = await resolveOwnerSalon(ownerId);

  //////////////////////////////////////////////////////////
  // Calendar validity — the "YYYY-MM-DD" regex in the validator
  // only checks shape, not whether the date actually exists
  // (e.g. 2026-02-31, 2026-13-01 both pass that regex).
  //////////////////////////////////////////////////////////
  if (!isValidCalendarDate(date)) {
    throw Errors.badRequest("date is not a valid calendar date");
  }

  //////////////////////////////////////////////////////////
  // Past dates cannot be modified — same locked rule Holiday
  // Override already enforces.
  //////////////////////////////////////////////////////////
  if (date < todayIST()) {
    throw Errors.badRequest("Past dates cannot be modified");
  }

  //////////////////////////////////////////////////////////
  // Chair must exist, be active, and belong to this owner's salon.
  //////////////////////////////////////////////////////////
  const chair = await Chair.findOne({
    _id:       chairId,
    salonId:   salon._id,
    isDeleted: false,
  }).select("_id name position").lean();

  if (!chair) throw Errors.notFound("Chair not found");

  const blockStart = toISTDateTime(date, startTime);
  const blockEnd   = toISTDateTime(date, endTime);

  //////////////////////////////////////////////////////////
  // RULE 7 — reject if ANY active booking on this chair overlaps
  // the requested window, using Service End + Buffer (NOT raw
  // service end) via the shared computeOccupiedEnd() helper —
  // the exact same occupancy definition the Chair Timeline itself
  // uses, so a block can never be created "clean" here and then
  // immediately collide with a booking's cleanup window.
  //////////////////////////////////////////////////////////
  // Query by startTime range, not the unindexed `bookingDate` field —
  // Booking's indexes all lead with chairRef+startTime (same pattern
  // getBookingsForDay uses), so this stays bounded to one day's scan
  // regardless of how many bookings this chair has accumulated over
  // its lifetime. Upper bound is computed as +1 minute past 23:59 —
  // i.e. the exclusive start of the next calendar day — via pure
  // millisecond arithmetic on toISTDateTime's already-correct instant,
  // so no second, separately-templated day-boundary string is needed.
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
  const conflictingBooking = activeBookings.find((b) =>
    overlaps(toAbsoluteInstant(b.startTime), toAbsoluteInstant(b.endTime), blockStart, blockEnd)
  );

  if (conflictingBooking) {
    throw Errors.badRequest(
      "Cannot block this chair — an active booking overlaps this window.",
      { conflictingBookingId: conflictingBooking._id }
    );
  }

  //////////////////////////////////////////////////////////
  // Defensive: reject if it overlaps an existing ACTIVE block on
  // the same chair (prevents duplicate/conflicting block rows —
  // not explicitly required by the locked rules, but keeps the
  // collection clean; see approved architecture §4).
  //////////////////////////////////////////////////////////
  const activeBlocks = await ChairAvailabilityOverride.find({
    chairId,
    date,
    status: CHAIR_AVAILABILITY_STATUS.ACTIVE,
  }).select("startTime endTime").lean();

  const conflictingBlock = activeBlocks.find((b) =>
    overlaps(toISTDateTime(date, b.startTime), toISTDateTime(date, b.endTime), blockStart, blockEnd)
  );

  if (conflictingBlock) {
    throw Errors.conflict("This chair already has an overlapping block for this window.");
  }

  const created = await ChairAvailabilityOverride.create({
    salonId:   salon._id,
    chairId,
    date,
    startTime,
    endTime,
    type:      type   || CHAIR_AVAILABILITY_TYPE.MANUAL,
    reason:    (typeof reason === "string" ? reason.trim() : "") || null,
    status:    CHAIR_AVAILABILITY_STATUS.ACTIVE,
    createdBy: ownerId,
    updatedBy: ownerId,
  });

  // Same cache-invalidation call Holiday Override and chair-count
  // changes already trigger — chair availability is the same class
  // of "salon config changed" event.
  await invalidateAllNextSlotCache(salon._id.toString());

  return toChairAvailabilityDTO({ ...created.toObject(), chairId: { _id: chair._id, name: chair.name, position: chair.position } });
};

//////////////////////////////////////////////////////////////
// 🚀 2. CANCEL BLOCK (soft — status: CANCELLED, never deleted)
//////////////////////////////////////////////////////////////

export const cancelChairBlock = async ({ ownerId, blockId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const block = await ChairAvailabilityOverride.findOne({ _id: blockId, salonId: salon._id })
    .populate("chairId", "name position");

  if (!block) throw Errors.notFound("Chair availability block not found");

  // Idempotent no-op — same pattern Holiday Override uses for
  // "already in the requested state".
  if (block.status === CHAIR_AVAILABILITY_STATUS.CANCELLED) {
    return toChairAvailabilityDTO(block.toObject());
  }

  block.status    = CHAIR_AVAILABILITY_STATUS.CANCELLED;
  block.updatedBy = ownerId;
  await block.save();

  await invalidateAllNextSlotCache(salon._id.toString());

  return toChairAvailabilityDTO(block.toObject());
};

//////////////////////////////////////////////////////////////
// 🚀 3. LIST BLOCKS
//////////////////////////////////////////////////////////////

export const listChairBlocks = async ({ ownerId, date, chairId, status }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const filter = { salonId: salon._id, date: date || todayIST() };

  if (chairId) filter.chairId = chairId;

  if (!status || status === "ACTIVE") {
    filter.status = CHAIR_AVAILABILITY_STATUS.ACTIVE;
  } else if (status !== "ALL") {
    filter.status = status; // "CANCELLED"
  }
  // status === "ALL" → no status filter applied

  const blocks = await ChairAvailabilityOverride.find(filter)
    .sort({ date: 1, startTime: 1 })
    .populate("chairId", "name position")
    .lean();

  return toChairAvailabilityListDTO(blocks);
};

//////////////////////////////////////////////////////////////
// 🚀 4. GET SINGLE BLOCK
//////////////////////////////////////////////////////////////

export const getChairBlockById = async ({ ownerId, blockId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const block = await ChairAvailabilityOverride.findOne({ _id: blockId, salonId: salon._id })
    .populate("chairId", "name position")
    .lean();

  if (!block) throw Errors.notFound("Chair availability block not found");

  return toChairAvailabilityDTO(block);
};
