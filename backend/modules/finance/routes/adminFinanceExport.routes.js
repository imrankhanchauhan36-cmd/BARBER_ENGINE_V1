/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminFinanceExport.routes.js
 *
 * STEP 7.4 — Finance Export Engine. Mounted under
 * /api/admin/finance/export with `protect` applied at the app.js mount
 * level (same convention as every other admin finance route in this
 * module). Read-only, INDIA-only — same rationale as
 * adminFinanceDashboard.routes.js (STEP 7.1) and
 * adminFinanceAnalytics.routes.js (STEP 7.2).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  exportRevenueReportHandler,
  exportGstReportHandler,
  exportSalonPayoutReportHandler,
  exportAgentPayoutReportHandler,
  exportFinanceSummaryHandler,
} from "../controllers/adminFinanceExport.controller.js";
import { adminFinanceExportSchemas } from "../validators/adminFinanceExport.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];
const gate = [requireAdminLevel(...INDIA_ONLY), validate(adminFinanceExportSchemas.exportQuery, "query")];

router.get("/revenue", ...gate, exportRevenueReportHandler);
router.get("/gst", ...gate, exportGstReportHandler);
router.get("/salon-payouts", ...gate, exportSalonPayoutReportHandler);
router.get("/agent-payouts", ...gate, exportAgentPayoutReportHandler);
router.get("/summary", ...gate, exportFinanceSummaryHandler);

export default router;
