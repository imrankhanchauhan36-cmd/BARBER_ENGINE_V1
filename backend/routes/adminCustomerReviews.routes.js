/**
 * BARBER ENGINE V1
 * backend/routes/adminCustomerReviews.routes.js
 *
 * STEP 5.5A — Admin Customer Reviews API. Mounted as its OWN
 * full-literal-path, /api/admin/users/:id/reviews, in app.js. Same
 * defensive full-prefix-mount reasoning as adminCustomerSummary.
 * routes.js (STEP 5.2A) / adminCustomerBookings.routes.js (STEP
 * 5.2B) — this 5-segment mount is a strict superset of
 * routes/admin.routes.js's own "/users/:id" (4 segments) and
 * "/users/summary" (4 segments, no :id) routes, so it can never
 * collide with them regardless of app.js mount order.
 *
 * mergeParams: true — required because :id lives in the MOUNT path,
 * not this router's own internal path (same lesson as STEP 4.2A/
 * 5.2A/5.2B — applied here from the start).
 *
 * `protect` is applied at the app.js mount level. requireAdminLevel
 * mirrors the sibling /admin/users/:id, /admin/users/:id/summary and
 * /admin/users/:id/bookings endpoints' own INDIA/STATE/DISTRICT read
 * levels.
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { validate } from "../middlewares/validate.middleware.js";
import { getAdminCustomerReviewsHandler } from "../controllers/adminCustomerReviews.controller.js";
import { adminCustomerReviewsSchemas } from "../validators/adminCustomerReviews.validator.js";

const router = express.Router({ mergeParams: true });

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminCustomerReviewsSchemas.customerIdParam, "params"),
  getAdminCustomerReviewsHandler
);

export default router;
