/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminGSTReport.routes.js
 *
 * P0 Revenue Calculation Engine — Step 4.3. Mounted under
 * /api/admin/finance/gst-report with `protect` applied at the app.js
 * mount level (same convention as every other admin finance route file
 * in this module). Read-only, INDIA-only on every verb — same rationale
 * as adminGstPolicy.routes.js / adminRevenueSettings.routes.js: a GST
 * liability report is sensitive regardless of geography, and
 * requireAdminLevel has no mechanism to scope a STATE/DISTRICT admin to
 * only their own territory.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getGSTReportSummaryHandler,
  getGSTReportMonthlyHandler,
  getGSTReportExportHandler,
} from "../controllers/adminGSTReport.controller.js";
import { adminGSTReportSchemas } from "../validators/adminGSTReport.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.get("/summary", requireAdminLevel(...INDIA_ONLY), getGSTReportSummaryHandler);
router.get("/monthly", requireAdminLevel(...INDIA_ONLY), validate(adminGSTReportSchemas.monthlyQuery, "query"), getGSTReportMonthlyHandler);
router.get("/export", requireAdminLevel(...INDIA_ONLY), validate(adminGSTReportSchemas.exportQuery, "query"), getGSTReportExportHandler);

export default router;
