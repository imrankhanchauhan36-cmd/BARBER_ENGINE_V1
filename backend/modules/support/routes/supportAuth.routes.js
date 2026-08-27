/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/supportAuth.routes.js
 *
 * Phase F.3.9 — login surface for AGENT / SUPPORT_ADMIN, mounted at
 * /api/support/auth (continues the module's existing /api/support/*
 * namespace convention). Deliberately separate from /api/admin-auth —
 * the ADMIN login's adminKey/lockout/geography semantics are untouched.
 */

import express from "express";
import rateLimit from "express-rate-limit";

import {
  supportLogin,
  supportLogout,
  supportMe,
  supportRefresh,
} from "../controllers/supportAuth.controller.js";

import { protect } from "../../../middlewares/auth.middleware.js";

const router = express.Router();

// Same policy values as adminAuth.routes.js's adminLoginLimiter.
const supportLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/support/auth/login
router.post("/login", supportLoginLimiter, supportLogin);

// POST /api/support/auth/refresh (no protect — expired token still needs this)
router.post("/refresh", supportRefresh);

// POST /api/support/auth/logout
router.post("/logout", protect, supportLogout);

// GET /api/support/auth/me
router.get("/me", protect, supportMe);

export default router;
