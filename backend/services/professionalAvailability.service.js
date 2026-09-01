//////////////////////////////////////////////////////////////
// PROFESSIONAL AVAILABILITY — SLOT/AVAILABILITY INTEGRATION (PHASE 4)
//
// Read-only building blocks that layer Professional/Chair-assignment
// eligibility on TOP of the existing, completely unmodified Slot
// Engine (services/chairTimeline.service.js::getChairTimelines,
// services/slotEngine.service.js::generateSlotsFromGap). Does NOT
// duplicate slot-generation math, does NOT touch the existing
// /slots endpoint or lockSlot(), does NOT modify Booking.js.
//
// Wiring this into the live customer-facing booking flow (the real
// /slots and /lock endpoints, and stamping professionalId onto
// Booking) is deliberately deferred to the later Booking Integration
// phase — this file only provides the reusable capability.
//////////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Staff from "../models/Staff.js";
import Service from "../models/Service.js";
import Chair from "../models/Chair.js";
import Booking from "../models/Booking.js";
import HolidayOverride from "../models/HolidayOverride.js";
import ProfessionalChairAssignment from "../models/ProfessionalChairAssignment.js";

import {
  getChairTimelines,
  toISTDateTime,
  toAbsoluteInstant,
  computeOccupiedEnd,
  findGaps,
} from "./chairTimeline.service.js";
import { generateSlotsFromGap } from "./slotEngine.service.js";
import { ASSIGNMENT_STATUS } from "../constants/professionalChairAssignment.constants.js";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////////////////

// Same IST-midnight parsing convention slotEngine.service.js uses —
// duplicated locally (not imported/exported) because it's a small,
// stable primitive, matching this codebase's own established
// per-file-duplication convention for exactly this class of helper
// (see resolveOwnerSalon/todayIST in services/professional.service.js
// and services/professionalChairAssignment.service.js).
const IST_OFFSET_SUFFIX = "T00:00:00+05:30";
const parseISTDate = (dateStr) => new Date(`${dateStr}${IST_OFFSET_SUFFIX}`);
const getISTDayName = (date) =>
  date.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" }).toLowerCase();

// Resolves salon opening hours + holiday override for one date —
// the EXACT same STEP 1 logic slotEngine.service.js::getSmartSlots
// already performs (openHour/openMin/closeHour/closeMin/breaks/
// isHoliday), replicated here (a data lookup, not slot-generation
// logic) because the approved Phase 4 plan calls getChairTimelines()
// directly rather than going through getSmartSlots — getChairTimelines
// itself does not resolve salon hours, its caller must.
const resolveSalonHoursForDate = async (salonId, date) => {
  const dateIST = parseISTDate(date);
  const dayName = getISTDayName(dateIST);

  const [salon, holidayOverride] = await Promise.all([
    Salon.findById(salonId).select("timings").lean(),
    HolidayOverride.findOne({ salonId, date }).select("isHoliday").lean()
      .catch(() => null),
  ]);

  if (holidayOverride?.isHoliday) return { isOpen: false };

  const todayTiming = salon?.timings?.[dayName];
  if (todayTiming?.isClosed) return { isOpen: false };

  let openHour = 0, openMin = 0, closeHour = 23, closeMin = 59;

  if (todayTiming) {
    openHour = parseInt(todayTiming.open.split(":")[0], 10);
    openMin  = parseInt(todayTiming.open.split(":")[1], 10);

    if (todayTiming.close === "00:00") {
      closeHour = 23; closeMin = 59;
    } else {
      closeHour = parseInt(todayTiming.close.split(":")[0], 10);
      closeMin  = parseInt(todayTiming.close.split(":")[1], 10);
    }
  }

  return { isOpen: true, openHour, openMin, closeHour, closeMin, breaks: todayTiming?.breaks || [] };
};

// Same "single or array" flexibility for validating that every
// requested service actually belongs to the salon (cross-salon
// service isolation) — returns true only if ALL requested ids
// resolve to a real, non-deleted Service of this salon.
const allServicesBelongToSalon = async (salonId, serviceIdOrIds) => {
  const requested = Array.isArray(serviceIdOrIds) ? serviceIdOrIds : [serviceIdOrIds];
  if (!requested.length) return false;
  const count = await Service.countDocuments({ _id: { $in: requested }, salonId, isDeleted: false });
  return count === new Set(requested.map(String)).size;
};

//////////////////////////////////////////////////////////////
// 🧑‍💼 OWNER-ONLY AUTOMATIC CAPACITY (PHASE C)
//
// "Owner-only mode" = exactly one active, non-deleted Staff document for
// this salon, and that one document has isOwner:true. This is NOT a new
// flag — Staff.isOwner already exists and is already populated by the
// pre-existing salon.onboarding.controller.js::saveStaff() isOwnerOnly
// branch. A salon with 2+ active professionals (owner included) is
// staff-present mode regardless of isOwner — manual
// ProfessionalChairAssignment remains the only path there (Phase A
// decision #4: manual assignment always takes precedence and is
// required the moment more than one professional exists).
//////////////////////////////////////////////////////////////

const breaksToIntervalsLocal = (date, breaks = []) =>
  breaks.map((b) => ({ start: toISTDateTime(date, b.start), end: toISTDateTime(date, b.end) }));

/**
 * Owner-only slot derivation — used ONLY when a professional has zero
 * ProfessionalChairAssignment rows AND is confirmed (by the caller) to be
 * the salon's sole active professional/owner. Availability is the
 * INTERSECTION of:
 *   (a) the owner's OWN existing bookings across EVERY chair of the
 *       salon (so being busy on Chair 1 correctly removes availability
 *       on Chair 2/3 too — physical chair count must never become
 *       professional capacity), and
 *   (b) the existing, UNMODIFIED per-chair free gaps from
 *       getChairTimelines() (so a chair blocked by e.g. a
 *       ChairAvailabilityOverride still cannot host a slot).
 * Reuses findGaps/toAbsoluteInstant/computeOccupiedEnd (already exported
 * by chairTimeline.service.js, zero modification there) and
 * generateSlotsFromGap (already exported by slotEngine.service.js since
 * Phase 4) — no parallel slot-generation algorithm. The final chair
 * placement tie-break (lowest load, highest priority) is duplicated
 * locally as a 2-line sort rather than importing slotEngine.service.js's
 * private pickBestChair — matching this file's own established
 * per-file-duplication convention (see parseISTDate/getISTDayName above).
 */
const computeOwnerOnlySlots = async ({ salonId, professionalId, date, serviceDuration, bufferTime, hours, timelines }) => {
  const dayStart = toISTDateTime(date, "00:00");
  const dayEnd   = new Date(toISTDateTime(date, "23:59").getTime() + 60 * 1000);

  const ownerBookings = await Booking.find({
    salonRef: salonId,
    professionalRef: professionalId,
    startTime: { $gte: dayStart, $lt: dayEnd },
    status: { $in: ["HOLD", "CONFIRMED", "ONGOING"] },
  }).select("startTime endTime bufferTime").lean();

  // Phase D fix — b.endTime is already buffer-inclusive (see
  // chairTimeline.service.js's Phase D note); computeOccupiedEnd() must
  // not be re-applied on top of stored booking data.
  const ownerBusyIntervals = ownerBookings.map((b) => ({
    start: toAbsoluteInstant(b.startTime),
    end:   toAbsoluteInstant(b.endTime),
  }));

  const startOfDay = toISTDateTime(date, `${String(hours.openHour).padStart(2, "0")}:${String(hours.openMin).padStart(2, "0")}`);
  const endOfDay   = toISTDateTime(date, `${String(hours.closeHour).padStart(2, "0")}:${String(hours.closeMin).padStart(2, "0")}`);

  const breakIntervals = breaksToIntervalsLocal(date, hours.breaks);
  const ownerBlocked = [...ownerBusyIntervals, ...breakIntervals].sort((a, b) => a.start - b.start);

  const ownerGaps = findGaps(ownerBlocked, startOfDay, endOfDay);

  const minDurationMs = (serviceDuration + bufferTime) * 60 * 1000;
  const allSlots = [];

  for (const gap of ownerGaps) {
    if (gap.end - gap.start < minDurationMs) continue;

    const generated = generateSlotsFromGap(gap, serviceDuration, bufferTime);

    for (const slot of generated) {
      // At least one physical chair must actually be free for this exact
      // window — never fabricate a slot the owner has no chair for.
      const candidates = timelines.filter((t) =>
        t.gaps.some((g) => g.start <= slot.start && g.end >= slot.end)
      );
      if (!candidates.length) continue;

      const chosenChair = [...candidates].sort((a, b) =>
        a.load !== b.load ? a.load - b.load : b.priority - a.priority
      )[0];

      allSlots.push({
        start:     slot.start,
        end:       slot.end,
        chairId:   chosenChair.chairId,
        available: true,
        label: slot.start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
        professionalId,
      });
    }
  }

  const now = new Date();
  return allSlots
    .sort((a, b) => a.start - b.start)
    .filter((slot) => slot.start > now);
};

//////////////////////////////////////////////////////////////
// 🚀 1. ELIGIBLE SLOTS FOR ONE SPECIFIC PROFESSIONAL
//////////////////////////////////////////////////////////////

/**
 * @returns {Array<{start:Date,end:Date,chairId:ObjectId,available:true,label:string,professionalId:string}>}
 *   Same slot shape getSmartSlots() already returns, plus professionalId.
 *   Returns [] (never throws) for any ineligible/not-found/closed case —
 *   matches getSmartSlots()'s own "fail to empty array" convention.
 */
export const getEligibleSlotsForProfessional = async ({
  salonId, professionalId, serviceId, date, serviceDuration, bufferTime = 0,
}) => {
  try {
    // Professional must be ACTIVE, not deleted, and belong to THIS salon.
    const professional = await Staff.findOne({ _id: professionalId, salonId, isDeleted: false })
      .select("_id isActive isOwner").lean();
    if (!professional || !professional.isActive) return [];

    // Service(s) must belong to THIS salon (cross-salon service
    // isolation). Phase B (locked product decision): Staff.skills is
    // no longer a booking-eligibility gate — the customer's own
    // professional selection already represents the service-level
    // choice, so a professional is never rejected here for an empty,
    // stale, or unrelated skills array.
    if (!(await allServicesBelongToSalon(salonId, serviceId))) return [];

    // Every ACTIVE assignment for this professional on this date —
    // Rule D (Phase 3 spec): evaluate ALL of them, not just the first.
    const assignments = await ProfessionalChairAssignment.find({
      professionalId, salonId, date, status: ASSIGNMENT_STATUS.ACTIVE,
    }).select("chairId startTime endTime").lean();

    const hours = await resolveSalonHoursForDate(salonId, date);
    if (!hours.isOpen) return [];

    // Existing, UNMODIFIED Chair Timeline — one call covers every chair
    // for this salon+date; we then pick out just the assigned chair(s).
    const timelines = await getChairTimelines({
      salonId, date, serviceDuration, bufferTime,
      openHour: hours.openHour, openMin: hours.openMin,
      closeHour: hours.closeHour, closeMin: hours.closeMin,
      breaks: hours.breaks,
    });

    if (!assignments.length) {
      // No manual assignment. Automatic owner-only capacity (Phase C)
      // applies ONLY when this professional is the salon's sole active
      // professional AND is its owner — otherwise (staff-present,
      // unassigned) correctly return [] rather than fabricate capacity
      // (Phase A decision #4).
      const activeCount = await Staff.countDocuments({ salonId, isActive: true, isDeleted: false });
      if (!(activeCount === 1 && professional.isOwner)) return [];

      return computeOwnerOnlySlots({ salonId, professionalId, date, serviceDuration, bufferTime, hours, timelines });
    }

    const minDurationMs = (serviceDuration + bufferTime) * 60 * 1000;
    const allSlots = [];

    for (const assignment of assignments) {
      const chairTimeline = timelines.find((t) => String(t.chairId) === String(assignment.chairId));
      if (!chairTimeline) continue; // chair inactive/deleted — getActiveChairs already excluded it

      const assignmentStart = toISTDateTime(date, assignment.startTime);
      const assignmentEnd   = toISTDateTime(date, assignment.endTime);

      for (const gap of chairTimeline.gaps) {
        // Intersect the chair's already-computed free gap with THIS
        // assignment's own time window — a slot must fall inside BOTH.
        const clippedStart = gap.start > assignmentStart ? gap.start : assignmentStart;
        const clippedEnd   = gap.end   < assignmentEnd   ? gap.end   : assignmentEnd;

        if (clippedEnd - clippedStart < minDurationMs) continue;

        const generated = generateSlotsFromGap({ start: clippedStart, end: clippedEnd }, serviceDuration, bufferTime);

        for (const slot of generated) {
          allSlots.push({
            start:     slot.start,
            end:       slot.end,
            chairId:   assignment.chairId,
            available: true,
            label: slot.start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
            professionalId,
          });
        }
      }
    }

    const now = new Date();
    return allSlots
      .sort((a, b) => a.start - b.start)
      .filter((slot) => slot.start > now);

  } catch (error) {
    console.error(`[ProfessionalAvailability] Error for professional=${professionalId} date=${date}:`, error.message);
    return [];
  }
};

//////////////////////////////////////////////////////////////
// 🚀 2. ELIGIBLE PROFESSIONALS FOR A SERVICE + DATE ("Any Professional"
// building block — deliberately NOT a slot merge/ranking algorithm;
// that belongs to a later phase per the approved Phase 4 scope).
//////////////////////////////////////////////////////////////

export const getEligibleProfessionalsForService = async ({ salonId, serviceId, date }) => {
  try {
    if (!(await allServicesBelongToSalon(salonId, serviceId))) return [];

    // Phase B (locked product decision): Staff.skills is no longer a
    // booking-eligibility gate. Every active, non-deleted professional
    // of this salon is a candidate — the customer's own professional
    // selection already represents the service-level choice, so an
    // empty, stale, or unrelated skills array must never zero out
    // availability. Phase 7 — added photo/experienceYears to the
    // projection so the customer-facing endpoint (routes/booking.routes.js)
    // has real display fields to return. No eligibility logic changed there.
    const candidates = await Staff.find({
      salonId, isActive: true, isDeleted: false,
    }).select("_id name profession photo experienceYears isOwner").lean();
    if (!candidates.length) return [];

    // Owner-only mode (Phase C): exactly one active professional for
    // this salon, and it's the owner — no ProfessionalChairAssignment
    // row is required for them to be listed as eligible. Any salon with
    // 2+ active professionals is staff-present mode regardless of
    // isOwner, and every candidate there still needs a real assignment.
    const ownerOnly = candidates.length === 1 && candidates[0].isOwner === true;

    const candidateIds = candidates.map((c) => c._id);
    const assignedIds = await ProfessionalChairAssignment.distinct("professionalId", {
      salonId, date, status: ASSIGNMENT_STATUS.ACTIVE, professionalId: { $in: candidateIds },
    });
    const assignedSet = new Set(assignedIds.map(String));

    return candidates
      .filter((c) => ownerOnly || assignedSet.has(String(c._id)))
      .map((c) => ({
        professionalId:  c._id,
        name:            c.name,
        profession:      c.profession ?? null,
        photo:           c.photo ?? null,
        experienceYears: c.experienceYears ?? null,
        isOwner:         c.isOwner,
      }));

  } catch (error) {
    console.error(`[ProfessionalAvailability] Error listing eligible professionals for service=${serviceId} date=${date}:`, error.message);
    return [];
  }
};

//////////////////////////////////////////////////////////////
// 🚀 3. "ANY PROFESSIONAL" DETERMINISTIC SELECTION (PHASE 5)
//
// LOCKED tie-break (per approved Phase 5 decision — deliberately NOT
// Staff.totalBookingsToday/Chair.totalBookingsToday: the Phase 5 audit
// found neither counter has any increment write-path anywhere in the
// codebase, so neither is a real load signal):
//   Primary:  ProfessionalChairAssignment.createdAt ASC
//   Fallback: Staff._id ASC (Mongo's own tie-break when createdAt is
//             identical — professionalId is the Staff _id)
//
// This picks ONE candidate row across ALL eligible professionals'
// ACTIVE assignments for the date — never random, always repeatable
// given the same underlying data. Returns null if nobody is eligible.
// This is a recommendation only — lockSlot() must still re-validate
// this exact pick inside its own transaction (revalidateProfessionalForBooking
// below) before it becomes authoritative.
//////////////////////////////////////////////////////////////

export const selectAnyProfessional = async ({ salonId, serviceId, date }) => {
  try {
    const eligible = await getEligibleProfessionalsForService({ salonId, serviceId, date });
    if (!eligible.length) return null;

    // Exactly one eligible candidate — nothing to tie-break (this is
    // also what makes owner-only mode deterministic: the owner has no
    // ProfessionalChairAssignment row to sort by, so the assignment-
    // based tie-break below would incorrectly return null for them).
    if (eligible.length === 1) return String(eligible[0].professionalId);

    const eligibleIds = eligible.map((e) => e.professionalId);

    const winner = await ProfessionalChairAssignment.findOne({
      salonId, date, status: ASSIGNMENT_STATUS.ACTIVE, professionalId: { $in: eligibleIds },
    })
      .sort({ createdAt: 1, professionalId: 1 })
      .select("professionalId")
      .lean();

    return winner ? String(winner.professionalId) : null;

  } catch (error) {
    console.error(`[ProfessionalAvailability] Error selecting Any Professional for service=${serviceId} date=${date}:`, error.message);
    return null;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 4. TRANSACTION-SCOPED FINAL RE-VALIDATION (PHASE 5)
//
// Called from INSIDE booking.controller.js::lockSlot()'s existing
// mongoose session, alongside its existing chair-overlap recheck —
// never before or after the transaction. Confirms the professional
// (specific or previously Any-selected) is STILL genuinely eligible
// and STILL has an ACTIVE assignment covering the exact chair+window
// at the moment of commit — closing the race where an owner changes
// or cancels the assignment between slot-listing and lock.
//////////////////////////////////////////////////////////////

// `serviceId` is accepted but no longer used for eligibility (Phase B
// — Staff.skills is not a booking gate) — kept in the signature so
// booking.controller.js's existing call site needs no change.
export const revalidateProfessionalForBooking = async ({
  salonId, professionalId, serviceId, chairId, date, slotStart, slotEnd, session,
}) => {
  const professional = await Staff.findOne({ _id: professionalId, salonId, isDeleted: false })
    .select("_id isActive isOwner").session(session).lean();
  if (!professional || !professional.isActive) return false;

  const assignments = await ProfessionalChairAssignment.find({
    professionalId, chairId, date, status: ASSIGNMENT_STATUS.ACTIVE,
  }).select("startTime endTime").session(session).lean();

  if (assignments.length) {
    return assignments.some((a) => {
      const aStart = toISTDateTime(date, a.startTime);
      const aEnd   = toISTDateTime(date, a.endTime);
      return aStart <= slotStart && aEnd >= slotEnd;
    });
  }

  // No assignment for this exact chair. Valid automatically ONLY if this
  // professional is the salon's sole active professional and its owner
  // (Phase C) — re-checked fresh, inside the same session, at commit
  // time. The chair itself just needs to still be a real active chair of
  // this salon; whether it's actually free at this window is
  // independently guarded by lockSlot()'s own existing, unchanged
  // chair-overlap check running alongside this in the same transaction.
  const activeCount = await Staff.countDocuments({ salonId, isActive: true, isDeleted: false }).session(session);
  if (!(activeCount === 1 && professional.isOwner)) return false;

  const chair = await Chair.findOne({ _id: chairId, salonId, isActive: true, isDeleted: false })
    .select("_id").session(session).lean();
  return !!chair;
};
