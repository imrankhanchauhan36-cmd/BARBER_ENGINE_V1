/**
 * BARBER ENGINE V1
 * backend/routes/district.routes.js
 * District Routes — Location Module
 *
 * Added: restore, summary, analytics, admin-assign routes to match
 * the new controller exports. RBAC pattern mirrors state.routes.js —
 * reads open to INDIA/STATE/DISTRICT (scope-filtered inside the
 * controller), writes restricted to INDIA/STATE (create/update/admin-
 * assign) or INDIA only (archive/restore — matches deleteState's
 * INDIA-only restriction).
 */
import express from "express";
import asyncHandler from "express-async-handler";
import {
    assignDistrictAdmin,
    createDistrictWithAdmin,
    deleteDistrict,
    getDistrictAnalytics,
    getDistrictById,
    getDistricts,
    getDistrictSummary,
    restoreDistrict,
    updateDistrict,
} from "../controllers/district.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { requireRole } from "../middlewares/role.middleware.js";

const router = express.Router();

router.use(protect, requireRole("ADMIN"));

// ── Read ──────────────────────────────────────────────────
router.get("/",              requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistricts));
router.get("/:id",           requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistrictById));
router.get("/:id/summary",   requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistrictSummary));
router.get("/:id/analytics", requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistrictAnalytics));

// ── Write — India + State Admin ───────────────────────────
router.post("/",             requireAdminLevel("INDIA","STATE"), asyncHandler(createDistrictWithAdmin));
router.patch("/:id",         requireAdminLevel("INDIA","STATE"), asyncHandler(updateDistrict));
router.post("/:id/admin",    requireAdminLevel("INDIA","STATE"), asyncHandler(assignDistrictAdmin));

// ── Archive / Restore — India Admin Only ──────────────────
router.delete("/:id",         requireAdminLevel("INDIA"), asyncHandler(deleteDistrict));
router.patch("/:id/restore",  requireAdminLevel("INDIA"), asyncHandler(restoreDistrict));

export default router;