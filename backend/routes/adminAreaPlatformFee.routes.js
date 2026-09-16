/**
 * BARBER ENGINE V1
 * backend/routes/adminAreaPlatformFee.routes.js
 *
 * PAN-India area-wise Platform Fee configuration — mounted under
 * /api/admin/finance/platform-fee. INDIA-only for every verb, same
 * rationale as adminGstPolicy.routes.js — geographic scoping does not
 * by itself make this safe for STATE/DISTRICT admins, since
 * requireAdminLevel cannot verify a target area actually belongs to
 * the calling admin's own territory (confirmed gap, matches
 * CommercialPolicyOverride's own real precedent, which is INDIA-only
 * despite being district/city/area scoped).
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createDraftAreaPlatformFeeHandler,
  listAreaPlatformFeesHandler,
  getAreaPlatformFeeDetailHandler,
  updateDraftAreaPlatformFeeHandler,
  publishAreaPlatformFeeHandler,
  retireAreaPlatformFeeHandler,
} from "../controllers/adminAreaPlatformFee.controller.js";
import { areaPlatformFeeSchemas } from "../validators/adminFinancePolicy.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(areaPlatformFeeSchemas.createDraft),
  createDraftAreaPlatformFeeHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(areaPlatformFeeSchemas.listQuery, "query"),
  listAreaPlatformFeesHandler
);
router.get(
  "/:policyId",
  requireAdminLevel(...INDIA_ONLY),
  validate(areaPlatformFeeSchemas.policyIdParam, "params"),
  getAreaPlatformFeeDetailHandler
);
router.patch(
  "/:policyId",
  requireAdminLevel(...INDIA_ONLY),
  validate(areaPlatformFeeSchemas.policyIdParam, "params"),
  validate(areaPlatformFeeSchemas.updateDraft),
  updateDraftAreaPlatformFeeHandler
);
router.post(
  "/:policyId/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(areaPlatformFeeSchemas.policyIdParam, "params"),
  publishAreaPlatformFeeHandler
);
router.post(
  "/:policyId/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(areaPlatformFeeSchemas.policyIdParam, "params"),
  retireAreaPlatformFeeHandler
);

export default router;
