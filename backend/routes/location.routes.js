/**
 * BARBER ENGINE V1
 * backend/routes/location.routes.js
 * City + Area Routes — Location Module
 */

import express from "express";
import asyncHandler from "express-async-handler";
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { requireRole } from "../middlewares/role.middleware.js";

import {
    createArea,
    createCity,
    deleteArea,
    deleteCity,
    getAreaById,
    getAreas,
    getCities,
    getCityById,
    updateArea,
    updateCity,
} from "../controllers/location.controller.js";

const router = express.Router();

router.use(protect, requireRole("ADMIN"));

// ── Cities ────────────────────────────────────────────────
router.get ("/cities",      requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getCities));
router.get ("/cities/:id",  requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getCityById));
router.post("/cities",      requireAdminLevel("INDIA","STATE"),            asyncHandler(createCity));
router.patch("/cities/:id", requireAdminLevel("INDIA","STATE"),            asyncHandler(updateCity));
router.delete("/cities/:id",requireAdminLevel("INDIA"),                    asyncHandler(deleteCity));

// ── Areas ─────────────────────────────────────────────────
router.get ("/areas",       requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getAreas));
router.get ("/areas/:id",   requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getAreaById));
router.post("/areas",       requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(createArea));
router.patch("/areas/:id",  requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(updateArea));
router.delete("/areas/:id", requireAdminLevel("INDIA","STATE"),            asyncHandler(deleteArea));

export default router;