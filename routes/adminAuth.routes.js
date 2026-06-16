import express from "express";
import rateLimit from "express-rate-limit";
import { adminLogin } from "../controllers/adminAuth.controller.js";

const router = express.Router();

/**
 * 🛡️ Elite protection for admin login
 * Prevents brute-force attacks
 */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per IP

  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },

  standardHeaders: true, // modern RateLimit headers
  legacyHeaders: false,  // disables old X-RateLimit headers
});

/**
 * 🔐 ADMIN LOGIN
 * INDIA → phone + password + adminKey
 * STATE/CITY → phone + password
 */
router.post("/login", adminLoginLimiter, adminLogin);

export default router;
