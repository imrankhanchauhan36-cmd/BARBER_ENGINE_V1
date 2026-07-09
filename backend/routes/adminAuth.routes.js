/**
 * BARBER ENGINE V1
 * backend/routes/adminAuth.routes.js — FINAL
 */

import express from "express";
import rateLimit from "express-rate-limit";

import {
  adminLogin,
  adminLogout,
  adminMe,
  adminRefresh,
} from "../controllers/adminAuth.controller.js";

import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// POST /api/admin-auth/login
router.post("/login",   adminLoginLimiter, adminLogin);

// POST /api/admin-auth/refresh  (no protect — expired token ke baad bhi kaam kare)
router.post("/refresh", adminRefresh);

// POST /api/admin-auth/logout
router.post("/logout",  protect, adminLogout);

// GET /api/admin-auth/me
router.get("/me",       protect, adminMe);

export default router;