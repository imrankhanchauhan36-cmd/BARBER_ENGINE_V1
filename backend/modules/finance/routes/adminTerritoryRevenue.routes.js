/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminTerritoryRevenue.routes.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine. Mounted under
 * /api/admin/finance/territory-settings with `protect` applied at the
 * app.js mount level (same convention as adminRevenueSettings.routes.js).
 *
 * INDIA-only on every verb, including reads — matches the uniform
 * precedent every other finance policy/config module in this codebase
 * already follows (adminGstPolicy, adminAreaPlatformFee,
 * adminRevenueSettings, adminGSTReport): this codebase has no separate
 * SUPER_ADMIN role/adminLevel, and INDIA is the real top tier
 * (requireAdminLevel). A financial commission rate is sensitive
 * regardless of geography, and requireAdminLevel cannot scope a
 * STATE/DISTRICT admin to only their own territory.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftTerritoryRevenueHandler,
  listTerritoryRevenueHandler,
  getPublishedTerritoryRevenueHandler,
  updateDraftTerritoryRevenueHandler,
  publishTerritoryRevenueHandler,
  retireTerritoryRevenueHandler,
} from "../controllers/adminTerritoryRevenue.controller.js";
import { adminTerritoryRevenueSchemas } from "../validators/adminTerritoryRevenue.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

// Declared before "/:id" so "published" is never parsed as an id.
router.get(
  "/published",
  requireAdminLevel(...INDIA_ONLY),
  getPublishedTerritoryRevenueHandler
);

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminTerritoryRevenueSchemas.createDraft),
  createDraftTerritoryRevenueHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminTerritoryRevenueSchemas.listQuery, "query"),
  listTerritoryRevenueHandler
);
router.patch(
  "/:id",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminTerritoryRevenueSchemas.idParam, "params"),
  validate(adminTerritoryRevenueSchemas.updateDraft),
  updateDraftTerritoryRevenueHandler
);
router.post(
  "/:id/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminTerritoryRevenueSchemas.idParam, "params"),
  publishTerritoryRevenueHandler
);
router.post(
  "/:id/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminTerritoryRevenueSchemas.idParam, "params"),
  retireTerritoryRevenueHandler
);

export default router;
