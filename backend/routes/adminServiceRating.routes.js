///////////////////////////////////////////////////////////
// RATING & REVIEW ENGINE — ADMIN ROUTES (Phase 2)
//
// protect() is already applied at the app.js mount level
// (app.use("/api/admin/ratings", protect, adminServiceRatingRoutes)).
// requireRole("ADMIN") matches the exact pattern the retired
// routes/adminRating.routes.js already used.
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import { requireRole } from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { serviceRatingSchemas } from "../validators/serviceRating.validator.js";
import {
  hideRatingHandler,
  unhideRatingHandler,
} from "../controllers/adminServiceRating.controller.js";

const router = express.Router();

router.post(
  "/hide",
  requireRole("ADMIN"),
  validate(serviceRatingSchemas.hide, "body"),
  asyncHandler(hideRatingHandler)
);

router.post(
  "/unhide",
  requireRole("ADMIN"),
  validate(serviceRatingSchemas.unhide, "body"),
  asyncHandler(unhideRatingHandler)
);

export default router;
