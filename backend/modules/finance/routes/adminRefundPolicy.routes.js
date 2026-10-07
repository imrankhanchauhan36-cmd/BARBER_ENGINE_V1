/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminRefundPolicy.routes.js
 *
 * Global Refund & Cancellation Policy. Mounted under
 * /api/admin/finance/refund-policy with `protect` applied at the
 * app.js mount level (same convention as every sibling finance policy
 * route file).
 *
 * INDIA-only on every verb, including reads — matches the uniform
 * precedent every other finance policy/config module in this codebase
 * already follows (adminGstPolicy, adminAreaPlatformFee,
 * adminTerritoryRevenue): this codebase has no separate SUPER_ADMIN
 * role/adminLevel, and INDIA is the real top tier.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftRefundPolicyHandler,
  listRefundPolicyHandler,
  getRefundPolicyDetailHandler,
  getPublishedRefundPolicyHandler,
  updateDraftRefundPolicyHandler,
  publishRefundPolicyHandler,
  retireRefundPolicyHandler,
} from "../controllers/adminRefundPolicy.controller.js";
import { adminRefundPolicySchemas } from "../validators/adminRefundPolicy.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

// Declared before "/:id" so "published" is never parsed as an id.
router.get(
  "/published",
  requireAdminLevel(...INDIA_ONLY),
  getPublishedRefundPolicyHandler
);

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRefundPolicySchemas.createDraft),
  createDraftRefundPolicyHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRefundPolicySchemas.listQuery, "query"),
  listRefundPolicyHandler
);
router.get(
  "/:id",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRefundPolicySchemas.idParam, "params"),
  getRefundPolicyDetailHandler
);
router.patch(
  "/:id",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRefundPolicySchemas.idParam, "params"),
  validate(adminRefundPolicySchemas.updateDraft),
  updateDraftRefundPolicyHandler
);
router.post(
  "/:id/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRefundPolicySchemas.idParam, "params"),
  publishRefundPolicyHandler
);
router.post(
  "/:id/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRefundPolicySchemas.idParam, "params"),
  retireRefundPolicyHandler
);

export default router;
