/**
 * BARBER ENGINE V1
 * backend/modules/finance/routes/adminRevenueSettings.routes.js
 *
 * P0 Revenue Calculation Engine — Step 2. Mounted under
 * /api/admin/finance/revenue-settings with `protect` applied at the
 * app.js mount level (same convention as adminGstPolicy.routes.js).
 *
 * "Only SUPER_ADMIN can edit" (ticket's own wording): this codebase has
 * no separate SUPER_ADMIN role or adminLevel — User.role's enum has no
 * such value, and the real admin hierarchy is
 * adminLevel: INDIA > STATE > DISTRICT (requireAdminLevel). INDIA is
 * this codebase's actual top/super tier, and every other PAN-India
 * financial-policy module (GST, Area Platform Fee, the Field Agent
 * Revenue Configuration Engine) is already INDIA-only for exactly this
 * reason — see adminGstPolicy.routes.js's own header for the identical
 * rationale (a financial number is sensitive regardless of geography,
 * and requireAdminLevel cannot scope a STATE/DISTRICT admin to only
 * their own territory). INDIA-only is applied here for the same reason,
 * on every verb including reads.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftRevenueSettingsHandler,
  listRevenueSettingsHandler,
  getRevenueSettingsDetailHandler,
  getPublishedRevenueSettingsHandler,
  updateDraftRevenueSettingsHandler,
  publishRevenueSettingsHandler,
  retireRevenueSettingsHandler,
} from "../controllers/adminRevenueSettings.controller.js";
import { adminRevenueSettingsSchemas } from "../validators/adminRevenueSettings.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

// Declared before "/:versionId" so "published" is never parsed as an id.
router.get(
  "/published",
  requireAdminLevel(...INDIA_ONLY),
  getPublishedRevenueSettingsHandler
);

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueSettingsSchemas.createDraft),
  createDraftRevenueSettingsHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueSettingsSchemas.listQuery, "query"),
  listRevenueSettingsHandler
);
router.get(
  "/:versionId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueSettingsSchemas.versionIdParam, "params"),
  getRevenueSettingsDetailHandler
);
router.patch(
  "/:versionId",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueSettingsSchemas.versionIdParam, "params"),
  validate(adminRevenueSettingsSchemas.updateDraft),
  updateDraftRevenueSettingsHandler
);
router.post(
  "/:versionId/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueSettingsSchemas.versionIdParam, "params"),
  publishRevenueSettingsHandler
);
router.post(
  "/:versionId/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(adminRevenueSettingsSchemas.versionIdParam, "params"),
  retireRevenueSettingsHandler
);

export default router;
