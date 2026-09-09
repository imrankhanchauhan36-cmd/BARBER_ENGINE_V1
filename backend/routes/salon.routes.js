import express from "express";

import {
  onboardSalon,
  checkSalonStatus,
  toggleShopOpen,
  getSalonsForAdmin,
  approveSalon,
  rejectSalon,
} from "../controllers/salon.controller.js";

import { getMySalon, getDashboardStats, getLiveSchedule, getWallet, updateChairPhoto, updateBasicInfo } from "../controllers/salon.me.controller.js";
import { getBusinessPerformance } from "../controllers/salon.performance.controller.js";
import { setHolidayOverride, getHolidayOverride } from "../controllers/salon.holiday.controller.js";
import { getBookingReadinessHandler } from "../controllers/salon.readiness.controller.js";
import { getBookingWindow, updateBookingWindow } from "../controllers/salon.bookingWindow.controller.js";
import chairAvailabilityRoutes from "./chairAvailability.routes.js";
import professionalRoutes from "./professional.routes.js";
import professionalChairAssignmentRoutes from "./professionalChairAssignment.routes.js";
import weeklyScheduleTemplateRoutes from "./weeklyScheduleTemplate.routes.js";
import scheduleRoutes from "./schedule.routes.js";

import { protect } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { bookingWindowSchemas } from "../validators/salon.bookingWindow.validator.js";

const router = express.Router();

//////////////////////////////////////////////////////
// 🔐 GLOBAL PROTECTION
//////////////////////////////////////////////////////

router.use(protect);

//////////////////////////////////////////////////////
// 📱 OWNER ROUTES
//////////////////////////////////////////////////////

const ownerRouter = express.Router();

ownerRouter.use(requireRole("OWNER"));

// Get my salon
ownerRouter.get("/me", getMySalon);

ownerRouter.get("/dashboard", getDashboardStats);

// Business Performance — Date Range Selector (Phase 2). New, additive,
// isolated endpoint — does not modify or share a code path with
// getDashboardStats() above. Inherits protect + requireRole("OWNER")
// from this router, same as every other ownerRouter route.
ownerRouter.get("/performance", getBusinessPerformance);


// ✅ FIXED → use POST (not GET)
ownerRouter.post("/status", checkSalonStatus);

// ✅ FIXED → renamed (avoid conflict with onboarding steps)
ownerRouter.post("/submit-onboarding", onboardSalon);

// Shop toggle
ownerRouter.patch("/shop/status", toggleShopOpen);

// Live Schedule 

ownerRouter.get("/live-schedule", getLiveSchedule);
ownerRouter.get("/wallet", getWallet); // ← ADD KARO

// Holiday Override Engine — Phase 1 (backend only, not yet enforced by Slot Engine)
ownerRouter.get("/holidays/:date", getHolidayOverride);
ownerRouter.patch("/holidays/:date", setHolidayOverride);

// Booking Readiness Engine — R2 (backend only, read-only). Composes
// the existing, frozen Slot/Chair/Professional-Availability engines
// via services/bookingReadiness.service.js — never a new availability
// calculation. Mounted at /api/salon/owner/booking-readiness —
// inherits protect + requireRole("OWNER") from this router; salonId
// is always resolved server-side from the authenticated owner, never
// accepted from the client.
ownerRouter.get("/booking-readiness", getBookingReadinessHandler);

// Chair Availability Engine — Phase 1 (backend only)
// Mounted at /api/salon/owner/chairs/availability — inherits
// protect + requireRole("OWNER") from this router.
ownerRouter.use("/chairs/availability", chairAvailabilityRoutes);

// Professional Engine — Phase 1 (backend foundation only). Safe,
// incremental, owner-scoped CRUD on the existing Staff collection —
// deliberately separate from salon.onboarding.controller.js's
// saveStaff() (that endpoint destructively replaces the whole staff
// array; this one never does). Mounted at
// /api/salon/owner/professionals — inherits protect +
// requireRole("OWNER") from this router.
ownerRouter.use("/professionals", professionalRoutes);

// Professional ↔ Chair Assignment Engine — Phase 3 (backend only).
// Date/time-windowed assignment of a Professional to a Chair — a new,
// dedicated collection, does not touch Chair.js, Staff.chairId, or
// Booking.js. Mounted at
// /api/salon/owner/professional-chair-assignments — inherits
// protect + requireRole("OWNER") from this router.
ownerRouter.use("/professional-chair-assignments", professionalChairAssignmentRoutes);

// Weekly Schedule Template — C4 Phase 1 (backend, config storage
// only). Versioned (effectiveFrom-dated) day-of-week staff→chair→time
// PATTERN storage — pure configuration, never creates or reads
// ProfessionalChairAssignment/Booking rows, no materializer/cron yet
// (C4 Phase 2, not built). Mounted at
// /api/salon/owner/weekly-schedule-templates — inherits protect +
// requireRole("OWNER") from this router.
ownerRouter.use("/weekly-schedule-templates", weeklyScheduleTemplateRoutes);

// Unified Schedule — owner-facing composition layer over the existing
// WeeklyScheduleTemplate + ProfessionalChairAssignment engines (see
// services/schedule.service.js header). Adds no new model and no new
// index; every write still flows through the existing, unmodified PCA
// create/update/cancel functions and their Rules A/B/C/D. Mounted at
// /api/salon/owner/schedule — inherits protect + requireRole("OWNER")
// from this router; salonId is always resolved server-side from the
// authenticated owner, never accepted from the client.
ownerRouter.use("/schedule", scheduleRoutes);

// Booking Window — C4 Phase 3 (backend, single-field owner setting).
// Salon.business.bookingWindowDays already existed since C4 Phase 2
// (consumed by services/weeklyScheduleMaterializer.service.js) — this
// only exposes it for the owner to read/change. Mounted at
// /api/salon/owner/booking-window — inherits protect +
// requireRole("OWNER") from this router; salonId is always resolved
// server-side from the authenticated owner, never accepted from the
// client.
ownerRouter.get("/booking-window", getBookingWindow);
ownerRouter.patch("/booking-window", validate(bookingWindowSchemas.update, "body"), updateBookingWindow);

// Chair Photo — additive, sets the existing (previously write-less) Chair.photo field
ownerRouter.patch("/chairs/:chairId/photo", updateChairPhoto);

// Edit Profile — post-approval-safe basicInfo editor (NOT the onboarding endpoint;
// never touches approval.status/onboarding.step/location.geo, no upsert)
ownerRouter.patch("/basic-info", updateBasicInfo);


//////////////////////////////////////////////////////
// 🛠 ADMIN ROUTES
//////////////////////////////////////////////////////

const adminRouter = express.Router();

adminRouter.use(requireRole("ADMIN", "SUPER_ADMIN", "DISTRICT_ADMIN"));

// Get all salons
adminRouter.get("/", getSalonsForAdmin);

// Approve
adminRouter.patch("/:id/approve", approveSalon);

// Reject
adminRouter.patch("/:id/reject", rejectSalon);

//////////////////////////////////////////////////////
// 🔗 ROUTE MOUNTING
//////////////////////////////////////////////////////

router.use("/owner", ownerRouter);
router.use("/admin", adminRouter);

//////////////////////////////////////////////////////

export default router;