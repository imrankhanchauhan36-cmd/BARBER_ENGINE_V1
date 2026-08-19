import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { requireRole } from "../middlewares/role.middleware.js";
import {
  getAdminRevenueReport,
  getSalonEarningsReport,
  getBookingsReport,
} from "../controllers/reports.controller.js";

const router = express.Router();

// ADMIN – platform revenue
// requireRole gates to ADMIN only; requireAdminLevel then constrains WHICH
// admins may call it at all — geographic scope (STATE→own state,
// DISTRICT→own district) is enforced inside the controller itself, same
// pattern as admin.controller.js / adminBooking.controller.js.
router.get(
  "/admin/revenue",
  requireRole("ADMIN"),
  requireAdminLevel("INDIA", "STATE", "DISTRICT"),
  getAdminRevenueReport
);

// SALON – wallet / earnings
// Both OWNER and ADMIN may call this; the controller itself verifies
// OWNER owns the salon, or ADMIN's territory covers it — a role/level
// middleware alone can't express that per-caller branch.
router.get(
  "/salon/:salonId/earnings",
  requireRole("OWNER", "ADMIN"),
  getSalonEarningsReport
);

// BOOKINGS – date range report
router.get(
  "/bookings",
  requireRole("ADMIN"),
  requireAdminLevel("INDIA", "STATE", "DISTRICT"),
  getBookingsReport
);

export default router;
