/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/slaPolicy.routes.js
 *
 * Phase G Step 1 — SLA Policy CRUD, SUPPORT_ADMIN-only. Deliberately
 * NOT merged into the existing adminSupport.routes.js file — policy
 * management has no team-lead partial-access case at all (unlike
 * ticket actions, which use resolveAdminScope()'s
 * SUPPORT_ADMIN-vs-team-lead split), so a single plain
 * requireRole("SUPPORT_ADMIN") at the router level is correct and
 * simpler than reusing that scoping machinery here. Keeping this in
 * its own file/router also means the existing, already-tested
 * adminSupport.routes.js (9 routes) is not touched at all.
 *
 * Mounted at its own sub-path under the existing Support admin API
 * namespace (see app.js: /api/support/admin/sla-policies), with the
 * same protect/onboardingBypass wrapping every other Support route
 * group already uses.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createSlaPolicyHandler,
  listSlaPoliciesHandler,
  getSlaPolicyHandler,
  updateSlaPolicyHandler,
  updateSlaPolicyStatusHandler,
  deleteSlaPolicyHandler,
} from "../controllers/slaPolicy.controller.js";
import { slaPolicySchemas } from "../validators/slaPolicy.validator.js";

const router = express.Router();

router.use(requireRole("SUPPORT_ADMIN"));

router.post("/", validate(slaPolicySchemas.create), createSlaPolicyHandler);
router.get("/", listSlaPoliciesHandler);
router.get("/:id", getSlaPolicyHandler);
router.patch("/:id", validate(slaPolicySchemas.update), updateSlaPolicyHandler);
router.patch("/:id/status", validate(slaPolicySchemas.updateStatus), updateSlaPolicyStatusHandler);
router.delete("/:id", deleteSlaPolicyHandler);

export default router;
