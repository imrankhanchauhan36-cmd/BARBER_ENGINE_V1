import express from "express";

import {
  onboardSalon,
  checkSalonStatus,
  toggleShopOpen,
  getSalonsForAdmin,
  approveSalon,
  rejectSalon,
} from "../controllers/salon.controller.js";

import { getMySalon, getDashboardStats, getLiveSchedule, getWallet } from "../controllers/salon.me.controller.js";
import { setHolidayOverride, getHolidayOverride } from "../controllers/salon.holiday.controller.js";
import chairAvailabilityRoutes from "./chairAvailability.routes.js";

import { protect } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

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

// Chair Availability Engine — Phase 1 (backend only)
// Mounted at /api/salon/owner/chairs/availability — inherits
// protect + requireRole("OWNER") from this router.
ownerRouter.use("/chairs/availability", chairAvailabilityRoutes);


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