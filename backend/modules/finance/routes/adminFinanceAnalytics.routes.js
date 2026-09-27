/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminFinanceAnalytics.routes.js
 *
 * STEP 7.2 — Finance Analytics Engine. Mounted under
 * /api/admin/finance/analytics with `protect` applied at the app.js
 * mount level (same convention as every other admin finance route in
 * this module). Read-only, INDIA-only — same rationale as
 * adminFinanceDashboard.routes.js (STEP 7.1) and every other finance
 * reporting route in this codebase.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getDailyRevenueHandler,
  getMonthlyRevenueHandler,
  getGstTrendHandler,
  getPayoutTrendsHandler,
} from "../controllers/adminFinanceAnalytics.controller.js";
import { adminFinanceAnalyticsSchemas } from "../validators/adminFinanceAnalytics.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.get("/daily", requireAdminLevel(...INDIA_ONLY), validate(adminFinanceAnalyticsSchemas.dailyQuery, "query"), getDailyRevenueHandler);
router.get("/monthly", requireAdminLevel(...INDIA_ONLY), validate(adminFinanceAnalyticsSchemas.monthlyQuery, "query"), getMonthlyRevenueHandler);
router.get("/gst", requireAdminLevel(...INDIA_ONLY), validate(adminFinanceAnalyticsSchemas.trendQuery, "query"), getGstTrendHandler);
router.get("/payouts", requireAdminLevel(...INDIA_ONLY), validate(adminFinanceAnalyticsSchemas.trendQuery, "query"), getPayoutTrendsHandler);

export default router;
