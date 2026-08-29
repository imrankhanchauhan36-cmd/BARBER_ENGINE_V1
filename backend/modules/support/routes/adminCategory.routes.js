/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminCategory.routes.js
 *
 * Phase G Step 9 — a single, minimal, additive route: read-only
 * SupportCategory listing for SUPPORT_ADMIN, needed to populate the
 * category selector in the Admin Panel's new SLA Policy management
 * UI. Confirmed by direct inspection (repo-wide search) that no
 * SUPPORT_ADMIN/AGENT-accessible category-list endpoint existed
 * anywhere before this — the only prior one
 * (supportCustomer.routes.js's GET /categories) is gated to
 * requireRole("USER","OWNER") and would 403 a SUPPORT_ADMIN session.
 *
 * Deliberately reuses listCategoriesHandler (supportTicket.
 * controller.js) unchanged rather than duplicating it — that handler
 * has no role logic of its own; role gating lives entirely in this
 * router's own requireRole("SUPPORT_ADMIN"), the same convention
 * slaPolicy.routes.js already uses. No new controller/service
 * function was written; this file is the entire Step 9 backend
 * change.
 *
 * Mounted at /api/support/admin/categories, BEFORE the broader
 * /api/support/admin prefix in app.js — the same defensive route-
 * order convention slaPolicy.routes.js already established (Express
 * matches routers in registration order, so a narrower, more specific
 * prefix must be registered first to avoid ever silently falling
 * through into the broader router's own 404).
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { listCategoriesHandler } from "../controllers/supportTicket.controller.js";
import {
  createCategoryHandler,
  listCategoriesForAdminHandler,
  updateCategoryHandler,
  updateCategoryStatusHandler,
} from "../controllers/adminCategoryConfig.controller.js";
import { supportCategoryConfigSchemas } from "../validators/supportCategoryConfig.validator.js";

const router = express.Router();

// requireSupportAccess("SUPPORT_ADMIN") preserves the exact prior
// behavior for SUPPORT_ADMIN, plus additionally allows the single
// India-level main-console Admin (role:"ADMIN", adminLevel:"INDIA") —
// see supportAccess.middleware.js.
router.use(requireSupportAccess("SUPPORT_ADMIN"));

// Existing — UNCHANGED — reused by the customer ticket-creation picker
// (via listActiveCategories()) AND the existing admin dropdowns in
// SlaPolicyPage/SupportAgentsPage. Active-only, minimal fields.
router.get("/", listCategoriesHandler);

// New — Phase H Step 8 (Step 2) — Support Configuration Management.
router.get("/manage", listCategoriesForAdminHandler);
router.post("/", validate(supportCategoryConfigSchemas.create), createCategoryHandler);
router.patch("/:id", validate(supportCategoryConfigSchemas.update), updateCategoryHandler);
router.patch("/:id/status", validate(supportCategoryConfigSchemas.updateStatus), updateCategoryStatusHandler);

export default router;
