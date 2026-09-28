/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentSalons.routes.js
 *
 * STEP 2.2 — Admin Field Agent Acquired Salons API. Mounted at the
 * SAME base path as adminFieldAgentApprovalRoutes/adminFieldAgent
 * SummaryRoutes (/api/admin/field-agents), as a SEPARATE app.js mount
 * registered alongside them — GET /:id/salons (two path segments,
 * literal "salons" second segment) never collides with the approval
 * router's own routes ("/", "/:applicationId", "/:applicationId/
 * approve", "/:applicationId/reject", "/:fieldAgentId/commercial-
 * model" — none match a literal "salons" second segment) nor with the
 * summary router's own "/:id/summary" route, so Express correctly
 * falls through to this router untouched. `protect` is applied at the
 * app.js mount level, matching every other admin field-agent route
 * file.
 *
 * READ_LEVELS mirrors adminFieldAgentSummary.routes.js's own identical
 * split (INDIA/STATE/DISTRICT) — this is a single-agent, by-id read,
 * so (per the STEP 1.3 audit) no additional per-admin-level scoping is
 * applied here, same precedent as every other by-id admin field-agent
 * read endpoint in this codebase.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { getAdminFieldAgentSalonsHandler } from "../controllers/adminFieldAgentSalons.controller.js";
import { adminFieldAgentSalonsSchemas } from "../validators/adminFieldAgentSalons.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/:id/salons",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentSalonsSchemas.fieldAgentIdParam, "params"),
  getAdminFieldAgentSalonsHandler
);

export default router;
