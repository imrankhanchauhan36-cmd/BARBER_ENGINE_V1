/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentPerformance.routes.js
 *
 * FA-11.3 — admin READ-ONLY surface for FieldAgentPerformanceSnapshot,
 * mounted under /api/admin/field-agents/performance with `protect`
 * applied at the app.js mount level — exact same convention as
 * adminAcquisitionClaim.routes.js.
 *
 * INDIA/STATE only (no DISTRICT — no new performance permission in V1,
 * per the FA-11.3 lock). No write route exists here at all: this
 * milestone is read-only by design, not merely by omission.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  adminListFieldAgentPerformanceHandler,
  adminGetFieldAgentPerformanceDetailHandler,
} from "../controllers/adminFieldAgentPerformance.controller.js";
import { adminFieldAgentPerformanceSchemas } from "../validators/adminFieldAgentPerformance.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentPerformanceSchemas.listQuery, "query"),
  adminListFieldAgentPerformanceHandler
);

router.get(
  "/:fieldAgentId",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentPerformanceSchemas.fieldAgentIdParam, "params"),
  adminGetFieldAgentPerformanceDetailHandler
);

export default router;
