/**
 * BARBER ENGINE V1
 * backend/routes/adminSalonRevenue.routes.js
 *
 * STEP 4.2A — Admin Salon Revenue API. Mounted as its OWN full-prefix
 * path, /api/admin/salons/:id/revenue, in app.js. This full-literal
 * mount (4 path segments after /api) is a strict superset of
 * routes/admin.routes.js's own "/salons/:id" route (2 segments after
 * its own /api/admin mount) — Express requires the ENTIRE remaining
 * path to match a router.get() pattern, so a request for
 * ".../salons/<id>/revenue" never matches admin.routes.js's bare
 * "/salons/:id" route (one segment too many) and correctly falls
 * through to this router instead, regardless of app.js mount order.
 * Same defensive full-prefix-mount idiom already proven throughout
 * this codebase (e.g. adminFieldAgentRoster.routes.js's own /roster
 * mount).
 *
 * `protect` is applied at the app.js mount level, matching every
 * other admin route file. requireAdminLevel mirrors the sibling
 * /finance/wallets/:salonId and /finance/ledger/:salonId endpoints'
 * own INDIA/STATE/DISTRICT read levels exactly.
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { getAdminSalonRevenueHandler } from "../controllers/adminSalonRevenue.controller.js";

// mergeParams: true — required because this router is mounted at
// "/api/admin/salons/:id/revenue" (the :id lives in the MOUNT path,
// not in this router's own internal path). Without it, req.params.id
// is undefined inside this router's handlers — a plain nested
// express.Router() does not inherit the parent mount's params by
// default (confirmed live during this ticket's own verification: the
// endpoint returned 400 "Invalid salon ID" until this was added).
const router = express.Router({ mergeParams: true });

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get("/", requireAdminLevel(...READ_LEVELS), getAdminSalonRevenueHandler);

export default router;
