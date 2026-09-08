//////////////////////////////////////////////////////////////
// BOOKING READINESS ENGINE — SERVICE (R1, additive, read-only)
//
// Answers a question none of the existing production engines answer
// directly: "is this salon actually capable of accepting a booking
// for this date?" — as opposed to "is this salon turned on?".
//
// This file is a pure COMPOSITION layer over already-frozen,
// unmodified production engines:
//   - services/slotEngine.service.js            (getSmartSlots)
//   - services/chairTimeline.service.js         (getActiveChairs,
//                                                 toISTDateTime,
//                                                 toAbsoluteInstant)
//   - services/professionalAvailability.service.js
//       (getEligibleSlotsForProfessional, getEligibleProfessionalsForService,
//        selectAnyProfessional)
//
// It does NOT reimplement slot/availability mathematics, does NOT
// write to the database, and does NOT modify any of the files above.
// Every readiness signal is either a direct read of an existing
// model field, or the literal return value of one of the imported
// functions above, called exactly as any real controller would call
// it.
//
// R1 SCOPE ONLY: this file exposes one function. There is no route,
// no controller, and no owner-facing API yet (R2), and no Salon App
// UI (R3). See the audit report ("BOOKING READINESS ENGINE —
// ARCHITECTURE & BUSINESS RULES AUDIT") for the full rationale.
//////////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Service from "../models/Service.js";
import Staff from "../models/Staff.js";
import HolidayOverride from "../models/HolidayOverride.js";
import ProfessionalChairAssignment from "../models/ProfessionalChairAssignment.js";
import { ASSIGNMENT_STATUS } from "../constants/professionalChairAssignment.constants.js";

import { getActiveChairs, toISTDateTime, toAbsoluteInstant } from "./chairTimeline.service.js";
import { getSmartSlots } from "./slotEngine.service.js";
import {
  getEligibleSlotsForProfessional,
  selectAnyProfessional,
} from "./professionalAvailability.service.js";

//////////////////////////////////////////////////////////////
// 🔥 STATUS ENUM
//////////////////////////////////////////////////////////////

export const READINESS_STATUS = {
  READY:            "READY",
  NEEDS_ATTENTION:  "NEEDS_ATTENTION",
  NOT_READY:        "NOT_READY",
};

//////////////////////////////////////////////////////////////
// 🧠 IST DATE HELPERS
//
// Deliberately duplicated, not imported — matching this codebase's
// own established per-file-duplication convention for exactly this
// class of small, stable primitive (see the identical
// parseISTDate/getISTDayName pair already duplicated independently
// in services/slotEngine.service.js AND services/
// professionalAvailability.service.js, and todayIST() already
// duplicated independently in services/professionalChairAssignment.
// service.js and services/professional.service.js). toISTDateTime/
// toAbsoluteInstant ARE imported above from chairTimeline.service.js,
// since those are already exported for exactly this kind of reuse.
//////////////////////////////////////////////////////////////

const IST_OFFSET_SUFFIX = "T00:00:00+05:30";
const parseISTDate = (dateStr) => new Date(`${dateStr}${IST_OFFSET_SUFFIX}`);
const getISTDayName = (date) =>
  date.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" }).toLowerCase();

const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

//////////////////////////////////////////////////////////////
// 🧠 SALON HOURS + HOLIDAY RESOLUTION FOR ONE DATE
//
// This is the SAME data lookup (not slot-generation logic) that
// slotEngine.service.js::getSmartSlots' STEP 1 and
// professionalAvailability.service.js::resolveSalonHoursForDate both
// already perform independently — neither is exported, so this is a
// third, read-only copy of the identical pattern, matching the
// established convention rather than modifying either frozen file to
// share it. Returns enough to explain WHY a day is/isn't open, not
// just a boolean, since readiness needs the exact reason.
//////////////////////////////////////////////////////////////

const resolveDayReadiness = async (salonId, date) => {
  const dateIST = parseISTDate(date);
  const dayName = getISTDayName(dateIST);

  const [salon, holidayOverride] = await Promise.all([
    Salon.findById(salonId)
      .select("approval business timings")
      .lean(),
    HolidayOverride.findOne({ salonId, date }).select("isHoliday").lean()
      .catch(() => null),
  ]);

  if (!salon) {
    return { salon: null, blocked: true, code: "SALON_NOT_FOUND", humanMessage: "This salon could not be found." };
  }

  if (salon.approval?.status !== "APPROVED") {
    return { salon, blocked: true, code: "SALON_NOT_APPROVED", humanMessage: "Your salon is not yet approved." };
  }

  if (salon.business?.isForceClosed) {
    return { salon, blocked: true, code: "SALON_FORCE_CLOSED", humanMessage: "Your salon has been force-closed." };
  }

  if (salon.business?.isShopOpen === false) {
    return {
      salon, blocked: true, code: "SALON_MARKED_CLOSED",
      humanMessage: "Your salon is marked closed.",
      primaryAction: { code: "TOGGLE_SHOP_OPEN", available: true, description: "Turn your salon back on." },
    };
  }

  if (holidayOverride?.isHoliday) {
    return {
      salon, blocked: true, code: "HOLIDAY_OVERRIDE",
      humanMessage: `You've marked ${date} as a holiday.`,
      primaryAction: { code: "EDIT_HOLIDAY", available: true, description: "Remove or edit this holiday." },
    };
  }

  const dayTiming = salon.timings?.[dayName];

  if (dayTiming?.isClosed) {
    return {
      salon, blocked: true, code: "WORKING_DAY_CLOSED",
      humanMessage: `${dayName[0].toUpperCase()}${dayName.slice(1)} is marked closed in your working hours.`,
      primaryAction: { code: "EDIT_WORKING_HOURS", available: true, description: "Edit your working hours for this day." },
    };
  }

  return { salon, blocked: false, dayName, dayTiming };
};

//////////////////////////////////////////////////////////////
// 🧠 PROBE SERVICE SELECTION
//
// Readiness needs ONE concrete serviceDuration+bufferTime to call the
// existing slot-generating functions with (they require it — there is
// no "duration-agnostic" mode). Per-service exhaustive checking would
// mean running the full Slot/Professional-Availability engines once
// per service (and, for the professional-aware path, once per service
// PER professional) — an O(services × professionals) blow-up this
// phase deliberately does not introduce (see byService's own doc
// comment below for the explicit limitation this implies).
//
// Instead, this reuses the exact "smallest duration+buffer" fallback
// slotEngine.service.js::getNextSlotLabel already uses for its own
// Day-1/no-bookings-yet case — a precedented choice, not a new one —
// as a single representative PROBE service for the salon-level and
// professional-level checks.
//////////////////////////////////////////////////////////////

const pickProbeService = (activeServices) => {
  if (!activeServices.length) return null;
  return activeServices.reduce((min, s) =>
    (s.duration + (s.buffer || 0)) < (min.duration + (min.buffer || 0)) ? s : min
  );
};

//////////////////////////////////////////////////////////////
// 🧠 BUILD ONE byProfessional ENTRY
//
// Calls the REAL, unmodified getEligibleSlotsForProfessional() for
// this exact professional — never a re-derivation of eligibility from
// getEligibleProfessionalsForService(), which the audit proved can be
// stale (it does not check whether an ACTIVE assignment's time window
// has already elapsed for "now"). ownerOnlyApplicable/hasAssignment*
// below are read-only, informational mirrors of the SAME condition
// getEligibleSlotsForProfessional already enforces internally — they
// are never used to gate `ready`, only to produce a more specific
// human-readable reason than "zero slots" alone would give.
//////////////////////////////////////////////////////////////

const buildProfessionalReadiness = async ({
  salonId, professional, probeService, date, activeProfessionalCount,
}) => {
  const professionalId = professional._id;

  const ownerOnlyApplicable = activeProfessionalCount === 1 && professional.isOwner === true;

  const assignmentsForDate = await ProfessionalChairAssignment.find({
    salonId, professionalId, date,
  }).select("startTime endTime status").lean();

  const activeAssignments = assignmentsForDate.filter((a) => a.status === ASSIGNMENT_STATUS.ACTIVE);
  const now = new Date();
  const hasAnyActiveAssignmentToday = activeAssignments.length > 0;
  const hasFutureWindowToday = activeAssignments.some(
    (a) => toISTDateTime(date, a.endTime) > now
  );

  // The ONE production call this entry is actually gated by.
  const slots = await getEligibleSlotsForProfessional({
    salonId,
    professionalId,
    serviceId: [String(probeService._id)],
    date,
    serviceDuration: probeService.duration,
    bufferTime: probeService.buffer || 0,
  });

  const ready = slots.length > 0;

  let reason = null;
  if (!ready) {
    if (!professional.isActive) {
      reason = { code: "PROFESSIONAL_INACTIVE", humanMessage: `${professional.name} is marked inactive.`, primaryAction: { code: "REACTIVATE_PROFESSIONAL", available: true, description: "Reactivate this professional." } };
    } else if (!hasAnyActiveAssignmentToday && !ownerOnlyApplicable) {
      reason = { code: "NO_ASSIGNMENT_FOR_DATE", humanMessage: `${professional.name} has no chair assignment for ${date}.`, primaryAction: { code: "CREATE_ASSIGNMENT", available: true, description: "Assign this professional to a chair for this date." } };
    } else if (hasAnyActiveAssignmentToday && !hasFutureWindowToday && !ownerOnlyApplicable) {
      reason = { code: "ASSIGNMENT_WINDOW_EXPIRED", humanMessage: `${professional.name}'s chair assignment for ${date} has already ended for today.`, primaryAction: { code: "EXTEND_ASSIGNMENT", available: true, description: "Extend or add a later chair assignment for today." } };
    } else if (ownerOnlyApplicable) {
      reason = { code: "OWNER_ONLY_NO_CAPACITY", humanMessage: `${professional.name} (sole active professional) has no free chair time left for ${date}.`, primaryAction: null };
    } else {
      reason = { code: "NO_ELIGIBLE_SLOTS", humanMessage: `${professional.name} currently has no bookable time for ${date}.`, primaryAction: null };
    }
  }

  return {
    professionalId: String(professionalId),
    name: professional.name,
    active: professional.isActive,
    ownerOnlyApplicable,
    hasActiveAssignmentForDate: hasAnyActiveAssignmentToday,
    ready,
    readyFrom: ready ? slots[0].start : null,
    reason,
  };
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN EXPORT
//
// @param {string|ObjectId} salonId  REQUIRED. This service NEVER
//   resolves a salon from a phone/owner lookup itself — the caller
//   (a future R2 controller) is solely responsible for establishing
//   that `salonId` genuinely belongs to the authenticated owner
//   (e.g. via the same getOwnerSalonIds/resolveOwnerSalon pattern
//   already used throughout this codebase). This function only ever
//   reads the ONE salon it is given.
// @param {string} [date]  "YYYY-MM-DD" IST calendar date. Defaults to
//   today (IST).
// @param {Date}   [now]   Injectable "current instant", for
//   deterministic testing. Defaults to `new Date()`. Never persisted,
//   never used to mutate anything.
//////////////////////////////////////////////////////////////

export const getBookingReadiness = async ({ salonId, date, now = new Date() } = {}) => {
  if (!salonId) throw new Error("getBookingReadiness: salonId is required");

  const evaluatedForDate = date || todayIST();
  const evaluatedAt = now.toISOString();

  const blockingReasons = [];
  const warnings = [];

  //////////////////////////////////////////////////////////
  // STEP 1 — SALON-LEVEL HARD BLOCKERS (short-circuit — no further
  // queries are worth running if the salon itself can't take ANY
  // booking on this date).
  //////////////////////////////////////////////////////////

  const dayReadiness = await resolveDayReadiness(salonId, evaluatedForDate);

  if (dayReadiness.blocked) {
    const reason = {
      code: dayReadiness.code,
      scope: "SALON",
      humanMessage: dayReadiness.humanMessage,
      primaryAction: dayReadiness.primaryAction || null,
    };
    return {
      status: READINESS_STATUS.NOT_READY,
      scope: "SALON",
      perDimension: {
        anyBooking:     { ready: false, reason },
        byService:      [],
        anyProfessional:{ ready: false, reason },
        byProfessional: [],
      },
      blockingReasons: [reason],
      warnings: [],
      evaluatedAt,
      evaluatedForDate,
    };
  }

  //////////////////////////////////////////////////////////
  // STEP 2 — SERVICE INVENTORY
  //
  // "byService" in R1 reports STRUCTURAL activity only (is this
  // service selectable at all) — NOT a per-service confirmed slot
  // path. Determining "does THIS exact service currently have a real
  // bookable moment" would require re-running the full Slot Engine
  // (and, for professional-aware booking, the Professional
  // Availability Engine once per professional) separately for EVERY
  // service — an O(services × professionals) cost this phase
  // deliberately does not introduce, per the audit's own explicit
  // instruction to document rather than invent a cheaper duplicate.
  // A future phase could add this as an opt-in, per-service
  // diagnostic if the product genuinely needs it.
  //////////////////////////////////////////////////////////

  const activeServices = await Service.find({ salonId, isActive: true, isDeleted: false })
    .select("name duration buffer")
    .lean();

  const byService = activeServices.map((s) => ({
    serviceId: String(s._id),
    name: s.name,
    ready: true, // active + non-deleted, per this phase's documented scope — see comment above
  }));

  if (!activeServices.length) {
    const reason = {
      code: "NO_ACTIVE_SERVICES",
      scope: "SALON",
      humanMessage: "You have no active services.",
      primaryAction: { code: "ACTIVATE_SERVICE", available: true, description: "Activate or add a service." },
    };
    return {
      status: READINESS_STATUS.NOT_READY,
      scope: "SALON",
      perDimension: {
        anyBooking:      { ready: false, reason },
        byService:       [],
        anyProfessional: { ready: false, reason },
        byProfessional:  [],
      },
      blockingReasons: [reason],
      warnings: [],
      evaluatedAt,
      evaluatedForDate,
    };
  }

  //////////////////////////////////////////////////////////
  // STEP 3 — ACTIVE CHAIR CAPACITY (reuses the exact same function
  // getChairTimelines/getSmartSlots already call — never a
  // reimplementation).
  //////////////////////////////////////////////////////////

  const activeChairs = await getActiveChairs(salonId);

  if (!activeChairs.length) {
    const reason = {
      code: "NO_ACTIVE_CHAIRS",
      scope: "SALON",
      humanMessage: "You have no active chairs.",
      // Known, confirmed gap (see audit §10/§14/§15): there is
      // currently no owner Chair CRUD API/UI anywhere in the Salon
      // App to activate/deactivate/add a chair. This must NEVER be
      // reported as an available action.
      primaryAction: { code: "ACTIVATE_CHAIR", available: false, description: "No owner Chair management UI/API exists yet — separate future capability required." },
    };
    return {
      status: READINESS_STATUS.NOT_READY,
      scope: "SALON",
      perDimension: {
        anyBooking:      { ready: false, reason },
        byService,
        anyProfessional: { ready: false, reason },
        byProfessional:  [],
      },
      blockingReasons: [reason],
      warnings: [],
      evaluatedAt,
      evaluatedForDate,
    };
  }

  //////////////////////////////////////////////////////////
  // STEP 4 — PROBE SERVICE + "ANY BOOKING" (professional-agnostic)
  // SIGNAL, via the REAL, unmodified getSmartSlots().
  //////////////////////////////////////////////////////////

  const probeService = pickProbeService(activeServices);

  const genericSlots = await getSmartSlots({
    salonId,
    date: evaluatedForDate,
    serviceDuration: probeService.duration,
    bufferTime: probeService.buffer || 0,
  });

  const anyBookingReady = genericSlots.length > 0;

  //////////////////////////////////////////////////////////
  // STEP 5 — PROFESSIONAL LAYER
  //////////////////////////////////////////////////////////

  const activeProfessionals = await Staff.find({ salonId, isActive: true, isDeleted: false })
    .select("name isActive isOwner")
    .lean();

  let byProfessional = [];
  let anyProfessional = { ready: false, reason: null };

  if (activeProfessionals.length > 0) {
    // Bounded by this salon's OWN professional count — never
    // platform-wide, matching the same approved bounded-Promise.all
    // pattern already used elsewhere in this codebase (User App
    // ProfessionalSelectionScreen.js / Salon App StaffStallScreen.js
    // for the Rating Engine's per-professional summaries).
    byProfessional = await Promise.all(
      activeProfessionals.map((p) =>
        buildProfessionalReadiness({
          salonId,
          professional: p,
          probeService,
          date: evaluatedForDate,
          activeProfessionalCount: activeProfessionals.length,
        })
      )
    );

    // "ANY Professional" — reuses the REAL production selection
    // algorithm verbatim (selectAnyProfessional), then verifies the
    // result the same way the real /slots?professionalId=ANY route
    // would: by actually calling getEligibleSlotsForProfessional for
    // whichever id it resolves to. Never a re-derivation of the tie-
    // break logic itself (frozen decision #6).
    const resolvedAnyId = await selectAnyProfessional({
      salonId,
      serviceId: [String(probeService._id)],
      date: evaluatedForDate,
    });

    if (!resolvedAnyId) {
      anyProfessional = {
        ready: false,
        reason: { code: "NO_ELIGIBLE_PROFESSIONAL", humanMessage: "No professional is currently eligible for this date.", primaryAction: null },
      };
    } else {
      const matched = byProfessional.find((p) => p.professionalId === String(resolvedAnyId));
      anyProfessional = matched
        ? { ready: matched.ready, reason: matched.ready ? null : matched.reason }
        : { ready: false, reason: { code: "ANY_SELECTION_UNRESOLVED", humanMessage: "Could not verify the automatically-selected professional.", primaryAction: null } };
    }
  } else {
    // Zero active professionals at all. Per the frozen architecture,
    // professional-aware booking simply does not apply to this salon
    // configuration — this is informational, not itself a blocker,
    // since generic (professional-agnostic) booking may still work.
    warnings.push({
      code: "NO_ACTIVE_PROFESSIONALS",
      scope: "PROFESSIONAL",
      humanMessage: "This salon has no active professionals — professional-specific booking is not applicable.",
    });
  }

  //////////////////////////////////////////////////////////
  // STEP 6 — OVERALL STATUS
  //
  // NOT_READY  — genuinely zero booking path exists at all (neither
  //              generic nor professional-aware).
  // NEEDS_ATTENTION — the salon itself is operational and SOME
  //              generic capacity exists, but the professional-aware
  //              path a real customer actually uses (see
  //              booking.routes.js — the customer app always sends a
  //              professionalId) has no working option right now.
  // READY      — at least one genuine professional-aware booking path
  //              exists right now for the evaluated date.
  //////////////////////////////////////////////////////////

  const anyProfessionalPathWorks = anyProfessional.ready || byProfessional.some((p) => p.ready);
  const professionalLayerApplicable = activeProfessionals.length > 0;

  let status;
  if (!anyBookingReady && (!professionalLayerApplicable || !anyProfessionalPathWorks)) {
    status = READINESS_STATUS.NOT_READY;
    blockingReasons.push({
      code: "NO_VIABLE_BOOKING_PATH",
      scope: "TIME",
      humanMessage: `No bookable time exists for ${evaluatedForDate} — every chair/professional path is unavailable.`,
      primaryAction: null,
    });
  } else if (professionalLayerApplicable && !anyProfessionalPathWorks) {
    status = READINESS_STATUS.NEEDS_ATTENTION;
    blockingReasons.push({
      code: "NO_PROFESSIONAL_AWARE_PATH",
      scope: "PROFESSIONAL",
      humanMessage: `Customers can't currently complete a professional-based booking for ${evaluatedForDate}, even though your salon is otherwise open.`,
      primaryAction: { code: "CREATE_OR_EXTEND_ASSIGNMENT", available: true, description: "Create or extend a chair assignment covering the remaining time today (or the whole of a future date)." },
    });
  } else {
    status = READINESS_STATUS.READY;
  }

  // Surface any individual professional that isn't ready as a warning
  // even when overall status is READY (someone else covers it) —
  // matches audit §5's warning-condition recommendation.
  if (status === READINESS_STATUS.READY) {
    for (const p of byProfessional) {
      if (!p.ready) {
        warnings.push({
          code: "PROFESSIONAL_NOT_CURRENTLY_BOOKABLE",
          scope: "PROFESSIONAL",
          humanMessage: p.reason?.humanMessage || `${p.name} is not currently bookable.`,
        });
      }
    }
  }

  return {
    status,
    scope: status === READINESS_STATUS.READY ? "SALON" : (blockingReasons[0]?.scope || "SALON"),
    perDimension: {
      anyBooking:      { ready: anyBookingReady, reason: anyBookingReady ? null : { code: "NO_GENERIC_SLOTS", humanMessage: `No generic slots remain for ${evaluatedForDate}.` } },
      byService,
      anyProfessional,
      byProfessional,
    },
    blockingReasons,
    warnings,
    evaluatedAt,
    evaluatedForDate,
  };
};
