/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentSummary.routes.js
 *
 * STEP 2.1 — Admin Field Agent Summary API. Mounted at the SAME base
 * path as adminFieldAgentApprovalRoutes (/api/admin/field-agents),
 * as a SEPARATE app.js mount registered after it — GET /:id/summary
 * (two path segments, literal "summary" second segment) never
 * collides with that router's own routes ("/", "/:applicationId",
 * "/:applicationId/approve", "/:applicationId/reject",
 * "/:fieldAgentId/commercial-model" — none of which match a literal
 * "summary" second segment), so Express correctly falls through to
 * this router untouched. `protect` is applied at the app.js mount
 * level, matching every other admin field-agent route file.
 *
 * READ_LEVELS mirrors adminFieldAgentApproval.routes.js's own
 * identical split (INDIA/STATE/DISTRICT) — this is a single-record,
 * by-id read, so (per the STEP 1.3 audit) no additional per-admin-
 * level scoping is applied here, same precedent as every other
 * by-id admin field-agent read endpoint in this codebase.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { getAdminFieldAgentSummaryHandler } from "../controllers/adminFieldAgentSummary.controller.js";
import { adminFieldAgentSummarySchemas } from "../validators/adminFieldAgentSummary.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/:id/summary",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentSummarySchemas.fieldAgentIdParam, "params"),
  getAdminFieldAgentSummaryHandler
);

export default router;
