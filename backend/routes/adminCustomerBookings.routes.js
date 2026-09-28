/**
 * BARBER ENGINE V1
 * backend/routes/adminCustomerBookings.routes.js
 *
 * STEP 5.2B — Admin Customer Booking History API. Mounted as its OWN
 * full-literal-path, /api/admin/users/:id/bookings, in app.js. Same
 * defensive full-prefix-mount reasoning as adminCustomerSummary.
 * routes.js (STEP 5.2A) — this 5-segment mount is a strict superset
 * of routes/admin.routes.js's own "/users/:id" (4 segments) and
 * "/users/summary" (4 segments, no :id) routes, so it can never
 * collide with them regardless of app.js mount order.
 *
 * mergeParams: true — required because :id lives in the MOUNT path,
 * not this router's own internal path (same lesson as STEP 4.2A/5.2A
 * — applied here from the start).
 *
 * `protect` is applied at the app.js mount level. requireAdminLevel
 * mirrors the sibling /admin/users/:id and /admin/users/:id/summary
 * endpoints' own INDIA/STATE/DISTRICT read levels.
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { validate } from "../middlewares/validate.middleware.js";
import { getAdminCustomerBookingsHandler } from "../controllers/adminCustomerBookings.controller.js";
import { adminCustomerBookingsSchemas } from "../validators/adminCustomerBookings.validator.js";

const router = express.Router({ mergeParams: true });

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminCustomerBookingsSchemas.customerIdParam, "params"),
  getAdminCustomerBookingsHandler
);

export default router;
