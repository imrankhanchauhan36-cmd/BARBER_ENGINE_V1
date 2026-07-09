/**
 * BARBER ENGINE V1
 * backend/routes/state.routes.js
 * State Routes — Location Module
 */

import express from "express";
import asyncHandler from "express-async-handler";
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { requireRole } from "../middlewares/role.middleware.js";

import {
    createState,
    deleteState,
    getStateById,
    getStates,
    getStateSummary,
    updateState,
} from "../controllers/state.controller.js";

const router = express.Router();

// All routes require admin auth
router.use(protect, requireRole("ADMIN"));

// ── Public Read ───────────────────────────────────────────
router.get("/",           requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStates));
router.get("/:id",        requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStateById));
router.get("/:id/summary",requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStateSummary));

// ── India Admin Only — Write ──────────────────────────────
router.post("/",          requireAdminLevel("INDIA"), asyncHandler(createState));
router.patch("/:id",      requireAdminLevel("INDIA"), asyncHandler(updateState));
router.delete("/:id",     requireAdminLevel("INDIA"), asyncHandler(deleteState));

export default router;