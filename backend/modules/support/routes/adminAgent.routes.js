/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminAgent.routes.js
 *
 * Phase H Step 7 — Support Agent Management, SUPPORT_ADMIN-only.
 * Deliberately its own file/router (not merged into adminSupport.
 * routes.js), same reasoning slaPolicy.routes.js already documented:
 * agent management has no team-lead partial-access case, so a single
 * plain requireRole("SUPPORT_ADMIN") at the router level is correct
 * and keeps the existing, already-tested adminSupport.routes.js
 * (9 routes) completely untouched.
 *
 * Mounted at /api/support/admin/agents, BEFORE the broader
 * /api/support/admin prefix in app.js — the same defensive route-
 * order convention slaPolicy.routes.js and adminCategory.routes.js
 * already established.
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createAgentHandler,
  listAgentsHandler,
  getAgentHandler,
  updateAgentHandler,
  updateAgentStatusHandler,
} from "../controllers/adminAgent.controller.js";
import { supportAgentSchemas } from "../validators/supportAgent.validator.js";

const router = express.Router();

// requireSupportAccess("SUPPORT_ADMIN") preserves the exact prior
// behavior for SUPPORT_ADMIN, plus additionally allows the single
// India-level main-console Admin (role:"ADMIN", adminLevel:"INDIA") —
// see supportAccess.middleware.js.
router.use(requireSupportAccess("SUPPORT_ADMIN"));

router.post("/", validate(supportAgentSchemas.create), createAgentHandler);
router.get("/", listAgentsHandler);
router.get("/:id", getAgentHandler);
router.patch("/:id", validate(supportAgentSchemas.update), updateAgentHandler);
router.patch("/:id/status", validate(supportAgentSchemas.updateStatus), updateAgentStatusHandler);

export default router;
