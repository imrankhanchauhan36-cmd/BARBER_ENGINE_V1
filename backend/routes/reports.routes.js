import express from "express";
import {
  getAdminRevenueReport,
  getSalonEarningsReport,
  getBookingsReport,
} from "../controllers/reports.controller.js";

const router = express.Router();

// ADMIN – platform revenue
router.get("/admin/revenue", getAdminRevenueReport);

// SALON – wallet / earnings
router.get("/salon/:salonId/earnings", getSalonEarningsReport);

// BOOKINGS – date range report
router.get("/bookings", getBookingsReport);

export default router;
