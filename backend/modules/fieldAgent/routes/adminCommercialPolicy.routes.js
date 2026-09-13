/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminCommercialPolicy.routes.js
 *
 * FA-5.1 — CommercialPolicyVersion authoring surface, mounted under
 * /api/admin/commercial-policies with `protect` applied at the app.js
 * mount level (same convention as adminTest.routes.js). A national
 * ZEMISH commercial-policy asset — read AND write are INDIA-only per
 * the FA-5 Architecture Decision Lock's own explicit instruction
 * (deliberately stricter than adminTest.routes.js's
 * INDIA/STATE/DISTRICT read split — a commercial number is more
 * sensitive than exam content, and no STATE/DISTRICT admin has any
 * approved use for reading it yet).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftPolicyVersionHandler,
  listPolicyVersionsHandler,
  getPolicyVersionDetailHandler,
  updateDraftPolicyVersionHandler,
  publishPolicyVersionHandler,
  retirePolicyVersionHandler,
} from "../controllers/adminCommercialPolicy.controller.js";
import { adminCommercialPolicySchemas } from "../validators/adminCommercialPolicy.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicySchemas.createVersion),
  createDraftPolicyVersionHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicySchemas.listQuery, "query"),
  listPolicyVersionsHandler
);
router.get(
  "/:versionId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicySchemas.versionIdParam, "params"),
  getPolicyVersionDetailHandler
);
router.patch(
  "/:versionId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicySchemas.versionIdParam, "params"),
  validate(adminCommercialPolicySchemas.updateVersion),
  updateDraftPolicyVersionHandler
);
router.post(
  "/:versionId/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicySchemas.versionIdParam, "params"),
  publishPolicyVersionHandler
);
router.post(
  "/:versionId/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicySchemas.versionIdParam, "params"),
  validate(adminCommercialPolicySchemas.retireVersion),
  retirePolicyVersionHandler
);

export default router;
