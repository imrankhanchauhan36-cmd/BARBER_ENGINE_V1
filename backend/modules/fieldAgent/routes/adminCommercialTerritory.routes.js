/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminCommercialTerritory.routes.js
 *
 * FA-5.2 — CommercialTerritory admin authoring/governance surface,
 * mounted under /api/admin/commercial-territories with `protect`
 * applied at the app.js mount level (same convention as
 * adminCommercialPolicy.routes.js). All writes are INDIA-only — a
 * Commercial Territory determines commission eligibility, at least as
 * sensitive as CommercialPolicyVersion's own INDIA-only precedent.
 * Reads are INDIA/STATE/DISTRICT, scoped to the admin's own geography
 * in the service layer — the same read-level split already proven in
 * adminBooking/adminFinance/adminProvider controllers.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftTerritoryHandler,
  listTerritoriesHandler,
  getTerritoryDetailHandler,
  updateDraftTerritoryHandler,
  activateTerritoryHandler,
  suspendTerritoryHandler,
  retireTerritoryHandler,
  assignPartnerHandler,
  vacatePartnerHandler,
} from "../controllers/adminCommercialTerritory.controller.js";
import { adminCommercialTerritorySchemas } from "../validators/adminCommercialTerritory.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];
const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.createTerritory),
  createDraftTerritoryHandler
);

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminCommercialTerritorySchemas.listQuery, "query"),
  listTerritoriesHandler
);

router.get(
  "/:territoryId",
  requireAdminLevel(...READ_LEVELS),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  getTerritoryDetailHandler
);

router.patch(
  "/:territoryId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  validate(adminCommercialTerritorySchemas.updateTerritory),
  updateDraftTerritoryHandler
);

router.post(
  "/:territoryId/activate",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  activateTerritoryHandler
);

router.post(
  "/:territoryId/suspend",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  suspendTerritoryHandler
);

router.post(
  "/:territoryId/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  retireTerritoryHandler
);

router.post(
  "/:territoryId/assign-partner",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  validate(adminCommercialTerritorySchemas.assignPartnerBody),
  assignPartnerHandler
);

router.post(
  "/:territoryId/vacate-partner",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminCommercialTerritorySchemas.territoryIdParam, "params"),
  validate(adminCommercialTerritorySchemas.vacatePartnerBody),
  vacatePartnerHandler
);

export default router;
