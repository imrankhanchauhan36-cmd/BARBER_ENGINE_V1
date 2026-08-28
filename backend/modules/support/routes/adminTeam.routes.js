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
 * Mounted at /api/support/admin/teams, BEFORE the broader
 * /api/support/admin prefix — same convention as sla-policies/
 * categories/agents.
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { listTeamsHandler } from "../controllers/adminAgent.controller.js";

const router = express.Router();

// requireSupportAccess("SUPPORT_ADMIN") preserves the exact prior
// behavior for SUPPORT_ADMIN, plus additionally allows the single
// India-level main-console Admin (role:"ADMIN", adminLevel:"INDIA") —
// see supportAccess.middleware.js.
router.use(requireSupportAccess("SUPPORT_ADMIN"));

router.get("/", listTeamsHandler);

export default router;
