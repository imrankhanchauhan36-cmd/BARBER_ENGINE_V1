/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminTeam.routes.js
 *
 * Phase H Step 7 — a single, minimal, additive route: read-only
 * SupportTeam listing for SUPPORT_ADMIN, needed to populate the
 * Team-assignment dropdown in the new Agent Management UI. Confirmed
 * by direct inspection that no SUPPORT_ADMIN-accessible team-list
 * endpoint existed anywhere before this — the only prior SupportTeam
 * query in a controller (adminSupport.controller.js's resolveAdminScope
 * helper) is scoped to teamLeadRef: req.user._id ("teams I lead"), not
 * a general listing.
 *
 * Mirrors adminCategory.routes.js exactly: reuses listTeamsHandler
 * (adminAgent.controller.js) rather than duplicating it, no new model
 * logic, role gating lives entirely in this router's own
 * requireRole("SUPPORT_ADMIN").
 *
 * Phase H Step 8 (Step 1) — Support Configuration Management adds full
 * admin CRUD (create/list-manage/update/status) alongside the existing
 * GET / route above, which is left byte-for-byte unchanged: it is
 * still the exact same active-only, {_id,teamCode,name}-projected
 * dropdown the Agent Management UI already depends on. The new
 * GET /manage route is a deliberately separate endpoint (all
 * non-deleted teams, full fields) rather than a change to GET /'s
 * existing response shape or filter — per the approved Step 1 plan.
 *
 * Mounted at /api/support/admin/teams, BEFORE the broader
 * /api/support/admin prefix — same convention as sla-policies/
 * categories/agents.
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { listTeamsHandler } from "../controllers/adminAgent.controller.js";
import {
  createTeamHandler,
  listTeamsForAdminHandler,
  updateTeamHandler,
  updateTeamStatusHandler,
} from "../controllers/adminTeamConfig.controller.js";
import { supportTeamConfigSchemas } from "../validators/supportTeamConfig.validator.js";

const router = express.Router();

// requireSupportAccess("SUPPORT_ADMIN") preserves the exact prior
// behavior for SUPPORT_ADMIN, plus additionally allows the single
// India-level main-console Admin (role:"ADMIN", adminLevel:"INDIA") —
// see supportAccess.middleware.js.
router.use(requireSupportAccess("SUPPORT_ADMIN"));

// Existing — UNCHANGED — Agent Management's team-assignment dropdown.
router.get("/", listTeamsHandler);

// New — Phase H Step 8 (Step 1) — Support Configuration Management.
router.get("/manage", listTeamsForAdminHandler);
router.post("/", validate(supportTeamConfigSchemas.create), createTeamHandler);
router.patch("/:id", validate(supportTeamConfigSchemas.update), updateTeamHandler);
router.patch("/:id/status", validate(supportTeamConfigSchemas.updateStatus), updateTeamStatusHandler);

export default router;
