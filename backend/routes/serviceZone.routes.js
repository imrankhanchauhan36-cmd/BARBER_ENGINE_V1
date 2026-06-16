import express from "express";
import rateLimit from "express-rate-limit";

import {
  createServiceZone,
  getNearbySalons,
  validateBooking,
} from "../controllers/serviceZone.controller.js";

// 🔐 AUTH MIDDLEWARE
import auth from "../middlewares/auth.js";

const router = express.Router();

//////////////////////////////////////////////////////////////
// ⚡ RATE LIMIT CONFIG (PROTECTION)
//////////////////////////////////////////////////////////////

const nearbyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // max 100 requests/minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

//////////////////////////////////////////////////////////////
// 🔥 ROUTES (FINAL - ZOMATO GRADE)
//////////////////////////////////////////////////////////////

// ✅ CREATE SERVICE ZONE (PROTECTED)
router.post("/", auth, createServiceZone);

// ✅ GET NEARBY SALONS (PUBLIC + RATE LIMITED)
router.get("/nearby", nearbyLimiter, getNearbySalons);

// ✅ VALIDATE BOOKING (PROTECTED + RATE LIMITED)
router.post("/validate-booking", nearbyLimiter, auth, validateBooking);

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default router;