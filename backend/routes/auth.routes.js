import bcrypt from "bcryptjs";
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import {
  sendOtp,
  sendUserOtp,
  verifyOtp,
  verifyUserOtp,
} from "../controllers/auth.controller.js";

import User from "../models/User.js";

import { generateAccessToken } from "../services/token.service.js";

import {
  createSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  verifySession,
} from "../services/session.service.js";

const router = express.Router();

const REFRESH_COOKIE_NAME = "refreshToken";

/* =====================================================
COOKIE OPTIONS
===================================================== */

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/auth/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/auth/refresh",
  maxAge: 0,
};

/* =====================================================
RATE LIMITERS
Fully isolated per role — partner test won't affect
user quota and vice versa. ipKeyGenerator handles
IPv4 + IPv6 correctly.
===================================================== */

const partnerOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `partner_otp_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const partnerVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `partner_verify_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const userOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `user_otp_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const userVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `user_verify_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `admin_login_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

/* =====================================================
PARTNER AUTH
===================================================== */

router.post("/partner/send-otp", partnerOtpLimiter, sendOtp);

router.post("/partner/verify-otp", partnerVerifyLimiter, verifyOtp);

/* =====================================================
USER AUTH
===================================================== */

router.post("/user/send-otp", userOtpLimiter, sendUserOtp);

router.post("/user/verify-otp", userVerifyLimiter, verifyUserOtp);

/* =====================================================
ADMIN LOGIN
===================================================== */

router.post("/admin/login", adminLoginLimiter, async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password)
      return res.status(400).json({
        success: false,
        message: "Credentials required",
      });

    const admin = await User.findOne({
      phone,
      role: "ADMIN",
    }).select("+password tokenVersion");

    if (!admin)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    const refreshToken = await createSession(admin, req);

    const accessToken = generateAccessToken(admin);

    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshToken,
      getCookieOptions()
    );

    return res.json({
      success: true,
      accessToken,
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });

  }
});

/* =====================================================
REFRESH TOKEN
===================================================== */

router.post("/refresh", async (req, res) => {

  try {

    const rawRefreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.headers["x-refresh-token"];

    if (!rawRefreshToken)
      return res.status(401).json({
        success: false,
      });

    const result =
      await rotateSession(rawRefreshToken, req);

    if (!result)
      return res.status(401).json({
        success: false,
      });

    res.cookie(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      getCookieOptions()
    );

    return res.json({
      success: true,
      accessToken:  result.accessToken,
      refreshToken: result.refreshToken,
    });

  }
  catch {

    return res.status(401).json({
      success: false,
    });

  }

});

/* =====================================================
LOGOUT
===================================================== */

router.post("/logout", async (req, res) => {

  try {

    const rawRefreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.headers["x-refresh-token"];

    if (rawRefreshToken)
      await revokeSession(rawRefreshToken);

    res.cookie(
      REFRESH_COOKIE_NAME,
      "",
      CLEAR_COOKIE_OPTIONS
    );

    return res.json({
      success: true,
    });

  }
  catch {

    return res.json({
      success: true,
    });

  }

});

/* =====================================================
LOGOUT ALL
===================================================== */

router.post("/logout-all", async (req, res) => {

  try {

    const rawRefreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.headers["x-refresh-token"];

    if (!rawRefreshToken)
      return res.json({ success: true });

    const session =
      await verifySession(rawRefreshToken);

    if (!session)
      return res.json({ success: true });

    await revokeAllSessions(session.user._id);

    res.cookie(
      REFRESH_COOKIE_NAME,
      "",
      CLEAR_COOKIE_OPTIONS
    );

    return res.json({
      success: true,
    });

  }
  catch {

    return res.status(500).json({
      success: false,
    });

  }

});

/* =====================================================
EXPORT — after ALL routes are registered
===================================================== */

export default router;