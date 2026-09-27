/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminRevenueConfig.routes.js
 *
 * FA-P3-A — Revenue Configuration Engine, Phase 1. Mounted under
 * /api/admin/revenue with `protect` applied at the app.js mount level
 * (same convention as adminCommercialPolicy.routes.js). INDIA-only for
 * read AND write — same rationale as the underlying commercial policy
 * engine this wraps: a national commission number is more sensitive
 * than exam content, and no STATE/DISTRICT admin has an approved use
 * for reading or changing it.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getRevenueSettingsHandler,
  updateRevenueSettingsHandler,
  listRevenueTerritoriesHandler,
  updateRevenueTerritoryHandler,
} from "../controllers/adminRevenueConfig.controller.js";
import { adminRevenueConfigSchemas } from "../validators/adminRevenueConfig.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.get("/settings", requireAdminLevel(...INDIA_ONLY), getRevenueSettingsHandler);
router.patch(
  "/settings",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueConfigSchemas.updateSettings),
  updateRevenueSettingsHandler
);

router.get(
  "/territories",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueConfigSchemas.listTerritoriesQuery, "query"),
  listRevenueTerritoriesHandler
);
router.patch(
  "/territory/:id",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueConfigSchemas.territoryIdParam, "params"),
  validate(adminRevenueConfigSchemas.updateTerritory),
  updateRevenueTerritoryHandler
);

export default router;
