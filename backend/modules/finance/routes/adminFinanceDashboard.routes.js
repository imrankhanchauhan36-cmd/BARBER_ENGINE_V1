/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminFinanceDashboard.routes.js
 *
 * STEP 7.1 — Finance Dashboard KPI Engine. Mounted under
 * /api/admin/finance/dashboard with `protect` applied at the app.js
 * mount level (same convention as every other admin finance route in
 * this module). Read-only, INDIA-only — same rationale as every other
 * finance policy/reporting route in this codebase (a financial figure
 * is sensitive regardless of geography, and requireAdminLevel cannot
 * scope a STATE/DISTRICT admin to only their own territory).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { getFinanceDashboardKPIsHandler } from "../controllers/adminFinanceDashboard.controller.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.get("/kpis", requireAdminLevel(...INDIA_ONLY), getFinanceDashboardKPIsHandler);

export default router;
