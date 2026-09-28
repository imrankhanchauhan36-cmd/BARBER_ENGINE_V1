/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentAnalytics.routes.js
 *
 * STEP 3.5A — Admin Field Agent Analytics API. Mounted as its OWN
 * full-prefix path, /api/admin/field-agents/analytics, exactly
 * mirroring adminFieldAgentPerformance.routes.js's own /performance
 * precedent (and adminFieldAgentRoster.routes.js's own /roster
 * precedent, STEP 3.1) — a full-prefix mount registered before the
 * general "/api/admin/field-agents" mount(s) never risks colliding
 * with adminFieldAgentApprovalRoutes' own "/:applicationId" param
 * route (a literal "/analytics" single-segment path WOULD collide if
 * this were merged into the general router instead).
 *
 * No query params — GET / takes nothing, returns the full analytics
 * payload every time (see the service's own header for why: fixed
 * 12-month trend window, fixed top-10 limit).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { getAdminFieldAgentAnalyticsHandler } from "../controllers/adminFieldAgentAnalytics.controller.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get("/", requireAdminLevel(...READ_LEVELS), getAdminFieldAgentAnalyticsHandler);

export default router;
