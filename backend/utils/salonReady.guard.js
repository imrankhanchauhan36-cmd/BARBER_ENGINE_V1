// backend/utils/salonReady.guard.js

import mongoose from "mongoose";
import Salon from "../models/Salon.js";
import Service from "../models/Service.js";
import Chair from "../models/Chair.js";

//////////////////////////////////////////////////////
// READINESS REASONS — centralized constants
//////////////////////////////////////////////////////

export const SALON_NOT_READY_REASONS = {
  INVALID_ID:       "INVALID_SALON_ID",
  NOT_FOUND:        "SALON_NOT_FOUND",
  NOT_APPROVED:     "SALON_NOT_APPROVED",
  DELETED:          "SALON_DELETED",
  NO_SERVICES:      "NO_ACTIVE_SERVICES",
  NO_CHAIRS:        "NO_ACTIVE_CHAIRS",
  NO_WORKING_HOURS: "NO_WORKING_HOURS",
  FORCE_CLOSED:     "SALON_FORCE_CLOSED",
  SYSTEM_ERROR:     "SYSTEM_ERROR",
};

//////////////////////////////////////////////////////
// HELPER — time string → minutes (numeric compare)
// FIX 1: "09:30" → 570 — avoids string comparison bugs
//////////////////////////////////////////////////////

const timeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string") return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

const hasValidWorkingHours = (timings) => {
  if (!timings) return false;

  const DAYS = [
    "sunday", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday",
  ];

  return DAYS.some((day) => {
    const schedule = timings[day];
    if (!schedule || schedule.isClosed) return false;

    const openMins  = timeToMinutes(schedule.open);
    const closeMins = timeToMinutes(schedule.close);

    // ✅ Numeric comparison — no string bug
    return (
      openMins !== null &&
      closeMins !== null &&
      openMins < closeMins
    );
  });
};

//////////////////////////////////////////////////////
// MAIN GUARD
// Returns: { ready: true } or { ready: false, reason }
//////////////////////////////////////////////////////

export const isSalonReadyForBooking = async (salonId) => {
  try {

    ////////////////////////////////////////////////////
    // 1️⃣ ObjectId VALIDATION
    ////////////////////////////////////////////////////

    if (!mongoose.Types.ObjectId.isValid(salonId)) {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.INVALID_ID,
      };
    }

    ////////////////////////////////////////////////////
    // 2️⃣ PARALLEL DB CALLS — performance optimized
    ////////////////////////////////////////////////////

    const [salon, serviceCount, chairCount] = await Promise.all([

      Salon.findOne({
        _id: salonId,
        isDeleted: { $ne: true },
      })
        .select("approval business timings")
        .lean(),

      Service.countDocuments({
        salonId,
        isActive: true,
        isDeleted: { $ne: true },
      }),

      Chair.countDocuments({
        salonId,
        isActive: true,
        isDeleted: { $ne: true },
      }),

    ]);

    ////////////////////////////////////////////////////
    // 3️⃣ SALON EXISTS
    ////////////////////////////////////////////////////

    if (!salon) {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.NOT_FOUND,
      };
    }

    ////////////////////////////////////////////////////
    // 4️⃣ APPROVAL CHECK
    ////////////////////////////////////////////////////

    if (salon.approval?.status !== "APPROVED") {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.NOT_APPROVED,
      };
    }

    ////////////////////////////////////////////////////
    // 5️⃣ FORCE CLOSED CHECK
    ////////////////////////////////////////////////////

    if (salon.business?.isForceClosed === true) {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.FORCE_CLOSED,
      };
    }

    ////////////////////////////////////////////////////
    // 6️⃣ SERVICES CHECK
    ////////////////////////////////////////////////////

    if (serviceCount < 1) {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.NO_SERVICES,
      };
    }

    ////////////////////////////////////////////////////
    // 7️⃣ CHAIRS CHECK
    ////////////////////////////////////////////////////

    if (chairCount < 1) {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.NO_CHAIRS,
      };
    }

    ////////////////////////////////////////////////////
    // 8️⃣ WORKING HOURS — numeric time comparison
    ////////////////////////////////////////////////////

    if (!hasValidWorkingHours(salon.timings)) {
      return {
        ready: false,
        reason: SALON_NOT_READY_REASONS.NO_WORKING_HOURS,
      };
    }

    ////////////////////////////////////////////////////
    // ✅ ALL CHECKS PASSED
    ////////////////////////////////////////////////////

    return { ready: true };

  } catch (error) {

    // FIX 2: DB failures gracefully handled
    console.error("isSalonReadyForBooking error:", error);

    return {
      ready: false,
      reason: SALON_NOT_READY_REASONS.SYSTEM_ERROR,
    };

  }
};