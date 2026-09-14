/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminCommercialPolicyOverride.routes.js
 *
 * FA-9 — CommercialPolicyOverride authoring surface, mounted under
 * /api/admin/commercial-policy-overrides with `protect` applied at the
 * app.js mount level (same convention as adminCommercialPolicy.routes.js).
 * INDIA-only read AND write — same rationale as the national policy's
 * own routes file: a commercial number is sensitive regardless of which
 * geography it applies to.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftPolicyOverrideHandler,
  listPolicyOverridesHandler,
  getPolicyOverrideDetailHandler,
  updateDraftPolicyOverrideHandler,
  publishPolicyOverrideHandler,
  retirePolicyOverrideHandler,
} from "../controllers/adminCommercialPolicyOverride.controller.js";
import { adminCommercialPolicyOverrideSchemas } from "../validators/adminCommercialPolicyOverride.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicyOverrideSchemas.createOverride),
  createDraftPolicyOverrideHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicyOverrideSchemas.listQuery, "query"),
  listPolicyOverridesHandler
);
router.get(
  "/:overrideId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicyOverrideSchemas.overrideIdParam, "params"),
  getPolicyOverrideDetailHandler
);
router.patch(
  "/:overrideId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicyOverrideSchemas.overrideIdParam, "params"),
  validate(adminCommercialPolicyOverrideSchemas.updateOverride),
  updateDraftPolicyOverrideHandler
);
router.post(
  "/:overrideId/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicyOverrideSchemas.overrideIdParam, "params"),
  publishPolicyOverrideHandler
);
router.post(
  "/:overrideId/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialPolicyOverrideSchemas.overrideIdParam, "params"),
  validate(adminCommercialPolicyOverrideSchemas.retireOverride),
  retirePolicyOverrideHandler
);

export default router;
