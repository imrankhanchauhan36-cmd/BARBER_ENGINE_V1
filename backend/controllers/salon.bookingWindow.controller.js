///////////////////////////////////////////////////////////
// SALON BOOKING WINDOW — CONTROLLER (C4 Phase 3)
//
// Owner-facing read/write for Salon.business.bookingWindowDays — the
// ONLY genuinely new backend capability C4 Phase 3 requires (see the
// approved Phase 3 specification, §7/§9). The field itself, its
// default (7), and its bounds (1..30) already existed since C4
// Phase 2 (models/Salon.js) — this file only exposes it to the owner.
//
// Does NOT touch the materializer, WeeklyScheduleTemplate, or any
// conflict/availability logic — services/weeklyScheduleMaterializer.
// service.js already reads this field directly from Salon on every
// run and needs no changes to pick up whatever value is saved here.
//
// Mirrors controllers/salon.holiday.controller.js's exact shape:
// plain try/catch handlers, owner resolved server-side via
// Salon.findOne({ownerId}) — a client-supplied salonId is never
// accepted or trusted.
///////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";

///////////////////////////////////////////////////////////
// GET /api/salon/owner/booking-window
///////////////////////////////////////////////////////////

export const getBookingWindow = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("business.bookingWindowDays")
      .lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    return res.json({
      success: true,
      data: { bookingWindowDays: salon.business?.bookingWindowDays ?? 7 },
    });

  } catch (error) {
    console.error("GET_BOOKING_WINDOW_ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/booking-window
// Body: { bookingWindowDays: number }
///////////////////////////////////////////////////////////

export const updateBookingWindow = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { bookingWindowDays } = req.body;

    const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("_id business.bookingWindowDays");

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    salon.business.bookingWindowDays = bookingWindowDays;
    // Mongoose schema-level min(1)/max(30) re-validates on save as a
    // second line of defense behind the Joi check at the route layer
    // — the same defense-in-depth already used throughout this
    // codebase (e.g. WeeklyScheduleTemplate).
    await salon.save();

    return res.json({
      success: true,
      message: "Booking window updated",
      data: { bookingWindowDays: salon.business.bookingWindowDays },
    });

  } catch (error) {
    console.error("UPDATE_BOOKING_WINDOW_ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
