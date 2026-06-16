import express from "express";
import asyncHandler from "express-async-handler";

//------------------------------------------------
// 🎮 CONTROLLER IMPORTS
//------------------------------------------------
import {
  updateSalonStatus,
  setSalonCommission,
  forceCloseSalon,
  listSalonsForAdmin,
  createDistrictAdmin, // legacy (optional)
} from "../controllers/admin.controller.js";

// ✅ STATE CONTROLLERS
import {
  createStateWithAdmin,
  getStates,
} from "../controllers/state.controller.js";

// ✅ DISTRICT CONTROLLERS (NEW)
import {
  createDistrictWithAdmin,
  getDistrict,
} from "../controllers/district.controller.js";

//------------------------------------------------
// 🛡️ MIDDLEWARE IMPORTS
//------------------------------------------------
import { protect } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";

const router = express.Router();

/**
 * ============================================
 * 🔐 GLOBAL ADMIN LOCK
 * All routes below require valid ADMIN role
 * ============================================
 */
router.use(protect, requireRole("ADMIN"));

/**
 * ============================================
 * 📊 DASHBOARD STATS
 * ============================================
 */
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        totalSalons: 0,
        activeSalons: 0,
        pendingApprovals: 0,
        todaysBookings: 0,
        totalRevenue: 0,
      },
    });
  })
);

/**
 * ============================================
 * 🗺️ LOCATION MANAGEMENT: STATES
 * ============================================
 */

// Create State → INDIA admin only
router.post(
  "/states",
  requireAdminLevel("INDIA"),
  asyncHandler(createStateWithAdmin)
);

// Get States → INDIA, STATE, DISTRICT admin
router.get(
  "/states",
  requireAdminLevel("INDIA", "STATE", "DISTRICT"),
  asyncHandler(getStates)
);

/**
 * ============================================
 * 🏙️ LOCATION MANAGEMENT: DISTRICT (NEW)
 * ============================================
 */

// District City → INDIA and STATE admin allowed
router.post(
  "/districts",
  requireAdminLevel("INDIA", "STATE"),
  asyncHandler(createDistrictWithAdmin)
);

// Get District → INDIA, STATE, District admin
router.get(
  "/districts",
  requireAdminLevel("INDIA", "STATE", "DISTRICT"),
  asyncHandler(getDistrict)
);

/**
 * ============================================
 * 👤 ADMINISTRATIVE PRIVILEGES
 * ============================================
 */

// Legacy support (optional)
router.post(
  "/create-district-admin",
  requireAdminLevel("INDIA", "STATE"),
  asyncHandler(createDistrictAdmin)
);

/**
 * ============================================
 * 💇 SALON OPERATIONS
 * ============================================
 */

// List salons based on admin scope

router.get(
  "/salons",
  requireAdminLevel("INDIA", "STATE", "DISTRICT"),
  asyncHandler(listSalonsForAdmin)
);

// Update salon status
router.patch(
  "/salons/:id/status",
  requireAdminLevel("STATE", "DISTRICT"), // ✅ ONLY DISTRICT ADMIN
  asyncHandler(updateSalonStatus)
);

// Update commission
router.patch(
  "/salons/:id/commission",
  asyncHandler(setSalonCommission)
);

// Force close salon
router.patch(
  "/salons/:id/force-close",
  asyncHandler(forceCloseSalon)
);

/**
 * ============================================
 * 🛑 FINAL FALLBACK
 * ============================================
 */
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Admin route not found",
  });
});

export default router;
