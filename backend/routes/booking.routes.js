import express from "express";

import {
  cancelBooking,
  checkInBooking,
  completeService,
  confirmBooking,
  forceComplete,
  getCompletedBookings, // ← YE ADD KARO
  getMyBookings, // FIX-2: was missing
  getPaymentHistory, // FIX-2: was missing
  getSalonBookings,
  getUpcomingBookings,
  lockSlot,
  markNoShow,
  startService,
} from "../controllers/booking.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { checkBookingState } from "../middlewares/bookingState.middleware.js";
import { idempotency } from "../middlewares/idempotency.middleware.js";
import {
  bookingRateLimiter,
  confirmRateLimiter,
  lockRateLimiter,
} from "../middlewares/rateLimit.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { getSmartSlots } from "../services/slotEngine.service.js";
import { bookingSchemas } from "../validators/booking.validators.js";

const router = express.Router();

//////////////////////////////////////////////////////////////
// 🔐 GLOBAL AUTH — all booking routes require a valid JWT
//////////////////////////////////////////////////////////////

router.use(protect);

//////////////////////////////////////////////////////////////
// 📱 USER ROUTER
// Accessible by: USER, OWNER
// Mounted at: /v1/bookings/user
//////////////////////////////////////////////////////////////

const userRouter = express.Router();
userRouter.use(requireRole("USER", "OWNER"));

// ── Available slots ─────────────────────────────────────────
userRouter.get("/slots", async (req, res) => {
  try {
    const {
      salonId,
      date,
      serviceDuration,
      bufferTime = 0,
    } = req.query;

    if (!salonId || !date || !serviceDuration) {
      return res.status(400).json({
        success: false,
        message: "salonId, date, and serviceDuration are required",
      });
    }

    const slots = await getSmartSlots({
      salonId,
      date,
      serviceDuration: Number(serviceDuration),
      bufferTime:      Number(bufferTime),
    });

    return res.status(200).json({
      success: true,
      count:   slots.length,
      slots,
    });

  } catch (err) {
    console.error("Slots error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch slots",
    });
  }
});

// ── Booking history (all statuses, paginated) ────────────────
userRouter.get("/", getMyBookings);

// ── Upcoming bookings (CONFIRMED / HOLD / CHECKED_IN) ────────
// FIX-2: route was missing — controller already implemented
userRouter.get("/upcoming", getUpcomingBookings);
userRouter.get("/payment-history", getPaymentHistory);

// ── Completed bookings (paginated) ───────────────────────────
// FIX-2: route was missing — controller already implemented
userRouter.get("/completed", getCompletedBookings);

// ── Lock slot (HOLD) ─────────────────────────────────────────
userRouter.post(
  "/lock",
  lockRateLimiter,
  idempotency,
  validate(bookingSchemas.lock),
  lockSlot
);

// ── Confirm booking (HOLD → CONFIRMED) ───────────────────────
userRouter.post(
  "/confirm",
  confirmRateLimiter,
  idempotency,
  validate(bookingSchemas.confirm),
  checkBookingState(["HOLD"]),
  confirmBooking
);

// ── Cancel booking (HOLD / CONFIRMED → CANCELLED) ────────────
userRouter.post(
  "/cancel",
  bookingRateLimiter,
  idempotency,
  validate(bookingSchemas.cancel),
  checkBookingState(["HOLD", "CONFIRMED"]),
  cancelBooking
);

// ── Check-in (CONFIRMED → CHECKED_IN) ────────────────────────
// lockRateLimiter (5/min) reused here rather than the general
// bookingRateLimiter — this endpoint accepts a 4-digit OTP, so it
// needs the strictest available throttle to meaningfully slow down
// a brute-force attempt against a known bookingId.
userRouter.post(
  "/check-in",
  lockRateLimiter,
  idempotency,
  validate(bookingSchemas.checkIn),
  checkBookingState(["CONFIRMED"]),
  checkInBooking
);

//////////////////////////////////////////////////////////////
// 🏪 ADMIN / OWNER ROUTER
// Accessible by: ADMIN, SUPER_ADMIN, DISTRICT_ADMIN, OWNER
// Mounted at: /v1/bookings/admin
//////////////////////////////////////////////////////////////

const adminRouter = express.Router();
adminRouter.use(requireRole("ADMIN", "SUPER_ADMIN", "DISTRICT_ADMIN", "OWNER"));

// ── Salon booking list (paginated, filterable by status) ─────
adminRouter.get("/bookings", getSalonBookings);

// ── Start service (CHECKED_IN → ONGOING) ─────────────────────
// FIX-1: was checkBookingState(["ONGOING"]) — wrong.
// startService() transitions CHECKED_IN → ONGOING,
// so the pre-flight check must assert CHECKED_IN.
adminRouter.post(
  "/start-service",
  bookingRateLimiter,
  validate(bookingSchemas.startService),
  checkBookingState(["CHECKED_IN"]),
  startService
);

// ── Complete service (ONGOING → COMPLETED) ───────────────────
adminRouter.post(
  "/complete",
  bookingRateLimiter,
  validate(bookingSchemas.complete),
  checkBookingState(["ONGOING"]),
  completeService
);

// ── Mark no-show (CONFIRMED → NO_SHOW) ───────────────────────
// CHECKED_IN is intentionally excluded — bookingState.machine.js's
// BOOKING_TRANSITIONS only allows CANCELLED/ONGOING from CHECKED_IN,
// so a CHECKED_IN no-show attempt always failed with a 500 anyway.
// Narrowed here so the failure is a clean 400 instead.
adminRouter.post(
  "/no-show",
  bookingRateLimiter,
  validate(bookingSchemas.noShow),
  checkBookingState(["CONFIRMED"]),
  markNoShow
);

// ── Force complete (CHECKED_IN → COMPLETED, already served) ──
// validate() added — bookingSchemas.forceComplete already declared
// actualDurationMinutes as required (5-300 min) but was never wired
// to this route, so it was previously unenforced at the HTTP layer.
adminRouter.post(
  "/force-complete",
  bookingRateLimiter,
  validate(bookingSchemas.forceComplete),
  checkBookingState(["CHECKED_IN"]),
  forceComplete
);

//////////////////////////////////////////////////////////////
// 🔗 MOUNT ROUTERS
//////////////////////////////////////////////////////////////

router.use("/v1/bookings/user",  userRouter);
router.use("/v1/bookings/admin", adminRouter);

export default router;