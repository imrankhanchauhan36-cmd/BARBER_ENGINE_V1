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
import { requireRole } from "../../../middlewares/role.middleware.js";
import { listCategoriesHandler } from "../controllers/supportTicket.controller.js";

const router = express.Router();

router.use(requireRole("SUPPORT_ADMIN"));

router.get("/", listCategoriesHandler);

export default router;
