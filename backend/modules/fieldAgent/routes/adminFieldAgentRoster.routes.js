/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentRoster.routes.js
 *
 * STEP 3.1 (backend addendum, user-approved exception — see the
 * validator's own header). Mounted as its OWN full-prefix path,
 * /api/admin/field-agents/roster, exactly mirroring adminFieldAgent
 * Performance.routes.js's own proven /performance precedent — a
 * full-prefix mount registered before the general
 * "/api/admin/field-agents" mount(s) never risks colliding with
 * adminFieldAgentApprovalRoutes' own "/:applicationId" param route
 * (a literal "/roster" single-segment path WOULD collide with that
 * param route if this were merged into the general router instead —
 * the exact same class of hazard the /performance precedent already
 * documents and defends against).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { listAdminFieldAgentRosterHandler } from "../controllers/adminFieldAgentRoster.controller.js";
import { adminFieldAgentRosterSchemas } from "../validators/adminFieldAgentRoster.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentRosterSchemas.listQuery, "query"),
  listAdminFieldAgentRosterHandler
);

export default router;
