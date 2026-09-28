/**
 * BARBER ENGINE V1
 * backend/routes/adminCustomerSummary.routes.js
 *
 * STEP 5.2A — Admin Customer Summary API. Mounted as its OWN
 * full-literal-path, /api/admin/users/:id/summary, in app.js. This
 * mount (5 segments after /api) is a strict superset of
 * routes/admin.routes.js's own "/users/:id" route (4 segments) and
 * "/users/summary" route (4 segments, literal, no :id) — Express
 * requires the ENTIRE remaining path to match a router.get() pattern,
 * so neither of those routes can ever match a request for
 * ".../users/<id>/summary", and this router is reached instead,
 * regardless of app.js mount order. Same defensive full-prefix-mount
 * idiom already proven in this codebase (e.g.
 * adminSalonRevenue.routes.js's own /salons/:id/revenue mount, STEP
 * 4.2A).
 *
 * mergeParams: true is required here — the :id lives in the MOUNT
 * path (app.js), not in this router's own internal path, so without
 * it req.params.id would be undefined inside this router's handlers
 * (the exact bug found live during STEP 4.2A's own verification,
 * fixed here from the start rather than repeating it).
 *
 * `protect` is applied at the app.js mount level, matching every
 * other admin route file. requireAdminLevel mirrors the sibling
 * /admin/users/:id endpoint's own INDIA/STATE/DISTRICT read levels.
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { validate } from "../middlewares/validate.middleware.js";
import { getAdminCustomerSummaryHandler } from "../controllers/adminCustomerSummary.controller.js";
import { adminCustomerSummarySchemas } from "../validators/adminCustomerSummary.validator.js";

const router = express.Router({ mergeParams: true });

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminCustomerSummarySchemas.customerIdParam, "params"),
  getAdminCustomerSummaryHandler
);

export default router;
