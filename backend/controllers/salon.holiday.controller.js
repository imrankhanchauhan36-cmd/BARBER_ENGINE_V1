///////////////////////////////////////////////////////////
// HOLIDAY OVERRIDE ENGINE — PHASE 1 (BACKEND ONLY)
//
// Records + validates a per-DATE holiday exception on top of
// Salon.timings' recurring weekly schedule. Does NOT touch the Slot
// Engine — getSmartSlots keeps generating slots exactly as it does
// today. Enforcement is Phase 2.
///////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Booking from "../models/Booking.js";
import HolidayOverride from "../models/HolidayOverride.js";
import { invalidateAllNextSlotCache } from "../services/slotEngine.service.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Statuses that represent a real, non-terminal commitment for the
// customer — the only ones that can block turning a date into a
// holiday. COMPLETED/CANCELLED/NO_SHOW/EXPIRED are terminal and
// deliberately excluded.
const ACTIVE_BOOKING_STATUSES = ["HOLD", "CONFIRMED", "CHECKED_IN", "ONGOING"];

// Same IST-midnight parsing technique slotEngine.service.js uses,
// duplicated locally (not imported) so that file stays untouched.
const IST_OFFSET_SUFFIX = "T00:00:00+05:30";
const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/holidays/:date
// Body: { isHoliday: boolean, reason?: string }
///////////////////////////////////////////////////////////

export const setHolidayOverride = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { date } = req.params;
    const { isHoliday, reason } = req.body;

    if (!DATE_RE.test(date || "")) {
      return res.status(400).json({ success: false, message: "date must be in YYYY-MM-DD format" });
    }

    if (typeof isHoliday !== "boolean") {
      return res.status(400).json({ success: false, message: "isHoliday (boolean) is required" });
    }

    const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id");
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    //////////////////////////////////////////////////////
    // RULE 3 — past dates cannot be modified
    //////////////////////////////////////////////////////
    if (date < todayIST()) {
      return res.status(400).json({ success: false, message: "Past dates cannot be modified" });
    }

    const existing = await HolidayOverride.findOne({ salonId: salon._id, date });
    const currentlyHoliday = existing?.isHoliday === true;

    //////////////////////////////////////////////////////
    // RULE 2 — Holiday ON → OFF is always allowed
    //////////////////////////////////////////////////////
    if (isHoliday === false) {
      if (existing) await HolidayOverride.deleteOne({ _id: existing._id });
      await invalidateAllNextSlotCache(salon._id.toString());
      return res.json({
        success: true,
        message: `${date} is no longer marked as a holiday`,
        data: { date, isHoliday: false },
      });
    }

    //////////////////////////////////////////////////////
    // RULE 1 — Holiday OFF → ON only if zero active bookings
    //////////////////////////////////////////////////////
    if (currentlyHoliday) {
      // Already a holiday — idempotent no-op success.
      return res.json({
        success: true,
        message: `${date} is already marked as a holiday`,
        data: { date, isHoliday: true, reason: existing.reason || null },
      });
    }

    const activeBookingCount = await Booking.countDocuments({
      salonRef: salon._id,
      bookingDate: date,
      status: { $in: ACTIVE_BOOKING_STATUSES },
    });

    if (activeBookingCount > 0) {
      return res.status(400).json({
        success: false,
        activeBookingCount,
        message: `Cannot mark this date as Holiday because ${activeBookingCount} active booking${activeBookingCount === 1 ? "" : "s"} exist${activeBookingCount === 1 ? "s" : ""}.`,
      });
    }

    await HolidayOverride.findOneAndUpdate(
      { salonId: salon._id, date },
      {
        salonId:   salon._id,
        date,
        isHoliday: true,
        reason:    typeof reason === "string" ? reason.trim().slice(0, 200) || null : null,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await invalidateAllNextSlotCache(salon._id.toString());

    return res.json({
      success: true,
      message: `${date} marked as a holiday`,
      data: { date, isHoliday: true, reason: typeof reason === "string" ? reason.trim() || null : null },
    });

  } catch (error) {
    console.error("SET_HOLIDAY_OVERRIDE_ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/holidays/:date
///////////////////////////////////////////////////////////

export const getHolidayOverride = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { date } = req.params;
    if (!DATE_RE.test(date || "")) {
      return res.status(400).json({ success: false, message: "date must be in YYYY-MM-DD format" });
    }

    const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id");
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const existing = await HolidayOverride.findOne({ salonId: salon._id, date }).lean();

    return res.json({
      success: true,
      data: {
        date,
        isHoliday: existing?.isHoliday === true,
        reason: existing?.reason || null,
        isPast: date < todayIST(),
      },
    });

  } catch (error) {
    console.error("GET_HOLIDAY_OVERRIDE_ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
