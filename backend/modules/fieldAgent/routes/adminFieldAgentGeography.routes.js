/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentGeography.routes.js
 *
 * Field Agent Geography Phase B — mounted under
 * /api/admin/field-agents (protect applied at the app.js mount
 * level), exact same convention as adminAcquisitionClaim.routes.js:
 * reads are INDIA/STATE/DISTRICT, assign/end are INDIA-only (starting
 * or ending an agent's administrative geography is at least as
 * sensitive as AcquisitionClaim's own admin actions).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getGeographyHandler,
  getGeographyHistoryHandler,
  assignGeographyHandler,
  endGeographyHandler,
} from "../controllers/adminFieldAgentGeography.controller.js";
import { adminFieldAgentGeographySchemas } from "../validators/adminFieldAgentGeography.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];
const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/:id/geography",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentGeographySchemas.fieldAgentIdParam, "params"),
  getGeographyHandler
);

router.get(
  "/:id/geography/history",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentGeographySchemas.fieldAgentIdParam, "params"),
  getGeographyHistoryHandler
);

router.post(
  "/:id/geography/assign",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminFieldAgentGeographySchemas.fieldAgentIdParam, "params"),
  validate(adminFieldAgentGeographySchemas.assignBody, "body"),
  assignGeographyHandler
);

router.post(
  "/:id/geography/end",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminFieldAgentGeographySchemas.fieldAgentIdParam, "params"),
  validate(adminFieldAgentGeographySchemas.endBody, "body"),
  endGeographyHandler
);

export default router;
