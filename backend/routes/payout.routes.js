/**
 * BARBER ENGINE V1
 * backend/routes/payout.routes.js
 * Phase 7 — Finance Routes
 * + Phase 8: added /admin/detail/:id route
 */

import express from "express";
import asyncHandler from "express-async-handler";
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { requireRole } from "../middlewares/role.middleware.js";

import {
  cancelWithdrawal,
  getPayoutHistory,
  getWallet,
  requestWithdrawal,
} from "../controllers/payout.controller.js";

import {
  approvePayout,
  getPayoutDetail,
  getPayoutSummary,
  listPayouts,
  rejectPayout,
} from "../controllers/adminPayout.controller.js";

const router = express.Router();

// ── Owner Routes ──────────────────────────────────────────
router.get ("/wallet",       protect, requireRole("OWNER"), asyncHandler(getWallet));
router.post("/withdraw",     protect, requireRole("OWNER"), asyncHandler(requestWithdrawal));
router.post("/cancel/:id",   protect, requireRole("OWNER"), asyncHandler(cancelWithdrawal));
router.get ("/history",      protect, requireRole("OWNER"), asyncHandler(getPayoutHistory));

// ── Admin Routes ──────────────────────────────────────────
router.get  ("/admin/summary",      protect, requireRole("ADMIN"), requireAdminLevel("INDIA","STATE"), asyncHandler(getPayoutSummary));
router.get  ("/admin/list",         protect, requireRole("ADMIN"), requireAdminLevel("INDIA","STATE"), asyncHandler(listPayouts));
router.get  ("/admin/detail/:id",   protect, requireRole("ADMIN"), requireAdminLevel("INDIA","STATE"), asyncHandler(getPayoutDetail));
router.patch("/admin/approve/:id",  protect, requireRole("ADMIN"), requireAdminLevel("INDIA","STATE"), asyncHandler(approvePayout));
router.patch("/admin/reject/:id",   protect, requireRole("ADMIN"), requireAdminLevel("INDIA","STATE"), asyncHandler(rejectPayout));

export default router;