/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentEarnings.routes.js
 *
 * STEP 2.3 — Admin Field Agent Earnings Ledger API. Mounted at the
 * SAME base path as adminFieldAgentApprovalRoutes/adminFieldAgent
 * SummaryRoutes/adminFieldAgentSalonsRoutes (/api/admin/field-agents),
 * as a SEPARATE app.js mount registered alongside them — GET /:id/
 * earnings (two path segments, literal "earnings" second segment)
 * never collides with the approval router's own routes ("/",
 * "/:applicationId", "/:applicationId/approve", "/:applicationId/
 * reject", "/:fieldAgentId/commercial-model" — none match a literal
 * "earnings" second segment) nor with the summary/salons routers' own
 * "/:id/summary" and "/:id/salons" routes, so Express correctly falls
 * through to this router untouched. `protect` is applied at the
 * app.js mount level, matching every other admin field-agent route
 * file.
 *
 * READ_LEVELS mirrors adminFieldAgentSummary.routes.js /
 * adminFieldAgentSalons.routes.js's own identical split (INDIA/STATE/
 * DISTRICT) — this is a single-agent, by-id read, so (per the STEP 1.3
 * audit) no additional per-admin-level scoping is applied here, same
 * precedent as every other by-id admin field-agent read endpoint in
 * this codebase.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { getAdminFieldAgentEarningsHandler } from "../controllers/adminFieldAgentEarnings.controller.js";
import { adminFieldAgentEarningsSchemas } from "../validators/adminFieldAgentEarnings.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/:id/earnings",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentEarningsSchemas.fieldAgentIdParam, "params"),
  getAdminFieldAgentEarningsHandler
);

export default router;
