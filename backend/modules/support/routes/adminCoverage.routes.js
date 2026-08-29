/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminCoverage.routes.js
 *
 * Phase H Step 8 (Step 5) — Support Configuration Management:
 * Coverage. Fully new — routingResolution.service.js only ever READS
 * active SupportCoverage rows via its AREA->CITY->DISTRICT->STATE->
 * COUNTRY walk-up; no admin write route existed before this.
 *
 * SUPPORT_ADMIN/India-Admin-only, same requireSupportAccess
 * ("SUPPORT_ADMIN") gate as every sibling Support config router.
 *
 * Mounted at /api/support/admin/coverage, BEFORE the broader
 * /api/support/admin prefix in app.js.
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createCoverageHandler,
  listCoverageForAdminHandler,
  updateCoverageHandler,
  updateCoverageStatusHandler,
} from "../controllers/adminCoverageConfig.controller.js";
import { supportCoverageConfigSchemas } from "../validators/supportCoverageConfig.validator.js";

const router = express.Router();

router.use(requireSupportAccess("SUPPORT_ADMIN"));

router.get("/", listCoverageForAdminHandler);
router.post("/", validate(supportCoverageConfigSchemas.create), createCoverageHandler);
router.patch("/:id", validate(supportCoverageConfigSchemas.update), updateCoverageHandler);
router.patch("/:id/status", validate(supportCoverageConfigSchemas.updateStatus), updateCoverageStatusHandler);

export default router;
