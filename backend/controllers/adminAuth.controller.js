import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";

import {
  createSession,
  revokeSession,
  rotateSession,
} from "../services/session.service.js";
import { generateAccessToken } from "../services/token.service.js";
import logger from "../utils/logger.js";
import {
  AppError,
  Errors,
  successResponse,
} from "../utils/response.js";

//////////////////////////////////////////////////////////////
// COOKIE OPTIONS
//////////////////////////////////////////////////////////////

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
};

//////////////////////////////////////////////////////////////
// SECURITY CONSTANTS
//////////////////////////////////////////////////////////////

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

//////////////////////////////////////////////////////////////
// ADMIN LOGIN (ENTERPRISE v3)
//////////////////////////////////////////////////////////////

export const adminLogin = async (req, res, next) => {
  try {
    //////////////////////////////////////////////////////
    // INPUT VALIDATION
    //////////////////////////////////////////////////////

    let { email, password, adminKey } = req.body;

    if (!email || !password) {
      return next(Errors.badRequest("Email and password are required"));
    }

    //////////////////////////////////////////////////////
    // FETCH ADMIN
    //////////////////////////////////////////////////////

    const admin = await User.findOne({
      email,
      role: "ADMIN",
      isActive: true,
      isDeleted: { $ne: true },
    }).select(
      "+password +tokenVersion +loginAttempts +lockUntil +adminLevel +countryRef +stateRef +districtRef +cityRef"
    );

    if (!admin) {
      return next(Errors.unauthorized("Invalid credentials"));
    }

    //////////////////////////////////////////////////////
    // ACCOUNT LOCK CHECK
    //////////////////////////////////////////////////////

    if (admin.lockUntil && admin.lockUntil > Date.now()) {
      return next(
        new AppError("Account locked. Try again later.", 423, "ACCOUNT_LOCKED")
      );
    }

    //////////////////////////////////////////////////////
    // PASSWORD CHECK
    //////////////////////////////////////////////////////

    const isMatch = await bcrypt.compare(password, admin.password);

    logger.debug("Admin login attempt", {
      adminId: admin._id.toString(),
      matched: isMatch,
    });

    if (!isMatch) {
      admin.loginAttempts += 1;

      if (admin.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        admin.lockUntil = Date.now() + LOCK_TIME;
        admin.loginAttempts = 0;
      }

      await admin.save();

      return next(Errors.unauthorized("Invalid credentials"));
    }

    //////////////////////////////////////////////////////
    // RESET LOGIN ATTEMPTS
    //////////////////////////////////////////////////////

    admin.loginAttempts = 0;
    admin.lockUntil = undefined;
    await admin.save();

    //////////////////////////////////////////////////////
    // ADMIN KEY CHECK (TIMING SAFE)
    //////////////////////////////////////////////////////

    if (admin.adminLevel === "INDIA") {
      if (!adminKey || !process.env.ADMIN_PANEL_KEY) {
        return next(Errors.unauthorized("Invalid admin key"));
      }

      const keyBuffer = Buffer.from(adminKey);
      const envBuffer = Buffer.from(process.env.ADMIN_PANEL_KEY);

      if (
        keyBuffer.length !== envBuffer.length ||
        !crypto.timingSafeEqual(keyBuffer, envBuffer)
      ) {
        return next(Errors.unauthorized("Invalid admin key"));
      }
    }

    //////////////////////////////////////////////////////
    // SAFETY CHECK
    //////////////////////////////////////////////////////

    if (!admin.countryRef) {
      logger.error("CRITICAL: countryRef missing for admin", {
        adminId: admin._id.toString(),
      });
      return next(Errors.internal("Admin configuration error"));
    }

    //////////////////////////////////////////////////////
    // 🔥 TOKEN VERSION INCREMENT (INVALIDATE OLD TOKENS)
    //////////////////////////////////////////////////////

    await User.updateOne(
      { _id: admin._id },
      { $inc: { tokenVersion: 1 } }
    );

    // Update local copy so new token has correct version
    admin.tokenVersion += 1;

    //////////////////////////////////////////////////////
    // CREATE SESSION (REFRESH TOKEN)
    //////////////////////////////////////////////////////

    const refreshToken = await createSession(admin, req);

    //////////////////////////////////////////////////////
    // CREATE ACCESS TOKEN
    //////////////////////////////////////////////////////

    const accessToken = generateAccessToken(admin);

    //////////////////////////////////////////////////////
    // SET SECURE COOKIE
    //////////////////////////////////////////////////////

    res.cookie("refreshToken", refreshToken, getCookieOptions());

    //////////////////////////////////////////////////////
    // AUDIT LOG
    //////////////////////////////////////////////////////

    logger.info("Admin login success", {
      adminId: admin._id.toString(),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    //////////////////////////////////////////////////////
    // RESPONSE (NO REFRESH TOKEN IN BODY)
    //////////////////////////////////////////////////////

    return successResponse(res, {
      message: "Login successful",
      data: {
        accessToken,
        admin: {
          id: admin._id,
          role: admin.role,
          adminLevel: admin.adminLevel,
          countryRef: admin.countryRef,
          stateRef: admin.stateRef || null,
          districtRef: admin.districtRef || null,
          cityRef: admin.cityRef || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────

export const adminLogout = async (req, res, next) => {
  try {
    const refreshToken =
      req.cookies?.refreshToken || req.headers["x-refresh-token"];

    if (refreshToken) await revokeSession(refreshToken);

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    res.set({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    });

    return successResponse(res, {
      message: "Logged out successfully",
      data: null,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET CURRENT ADMIN (ME) ───────────────────────────────────────
//
// Requires an auth middleware to have already verified the access
// token and attached the decoded payload to req.user (or req.admin).
// This endpoint re-fetches fresh data from the DB rather than trusting
// the JWT payload alone, since role/scope/permissions can change
// after a token was issued (e.g. admin demoted, district reassigned).
//////////////////////////////////////////////////////////////

export const adminMe = async (req, res, next) => {
  try {
    const adminId = req.user?.id || req.admin?.id;

    if (!adminId) {
      return next(Errors.unauthorized("Not authenticated"));
    }

    const admin = await User.findOne({
      _id: adminId,
      role: "ADMIN",
      isActive: true,
      isDeleted: { $ne: true },
    }).select(
      "name email role permissions countryRef stateRef districtRef cityRef +tokenVersion +adminLevel"
    );

    if (!admin) {
      return next(Errors.unauthorized("Admin account not found or inactive"));
    }

    //////////////////////////////////////////////////////
    // TOKEN VERSION CHECK (in case it was issued before
    // a forced logout / password reset / role change)
    //////////////////////////////////////////////////////

    if (
      req.user?.tokenVersion !== undefined &&
      req.user.tokenVersion !== admin.tokenVersion
    ) {
      return next(Errors.unauthorized("Session expired. Please log in again."));
    }

    logger.debug("Admin identity fetched", {
      adminId: admin._id.toString(),
    });

    return successResponse(res, {
      message: "Admin profile fetched successfully",
      data: {
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          adminLevel: admin.adminLevel,
          countryRef: admin.countryRef,
          stateRef: admin.stateRef || null,
          districtRef: admin.districtRef || null,
          cityRef: admin.cityRef || null,
          permissions: admin.permissions || [],
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── REFRESH ACCESS TOKEN ──────────────────────────────────────────
//
// Flow:
//   1. Read refresh token from httpOnly cookie (fallback: header, for
//      non-browser clients like mobile apps that can't rely on cookies).
//   2. rotateSession() does all the heavy lifting: verifies, detects
//      reuse, revokes the old token, issues a new one.
//   3. If rotation fails (expired / reused / compromised / revoked),
//      treat it as a hard logout — clear the cookie and return 401.
//   4. On success, set the new refresh token cookie and return the
//      new access token in the body (never the refresh token).
//////////////////////////////////////////////////////////////

export const adminRefresh = async (req, res, next) => {
  try {
    const rawToken =
      req.cookies?.refreshToken || req.headers["x-refresh-token"];

    if (!rawToken) {
      return next(Errors.unauthorized("Refresh token missing"));
    }

    const result = await rotateSession(rawToken, req);

    if (!result) {
      // Could be expired, reused, compromised, or already revoked.
      // Clear whatever cookie the client is holding — it's dead either way.
      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
      });

      logger.warn("Refresh token rotation failed", {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return next(Errors.unauthorized("Session expired. Please log in again."));
    }

    const { accessToken, refreshToken, user } = result;

    //////////////////////////////////////////////////////
    // SET NEW SECURE COOKIE
    //////////////////////////////////////////////////////

    res.cookie("refreshToken", refreshToken, getCookieOptions());

    logger.info("Admin token refreshed", {
      adminId: user._id.toString(),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    //////////////////////////////////////////////////////
    // RESPONSE (NO REFRESH TOKEN IN BODY)
    //////////////////////////////////////////////////////

    return successResponse(res, {
      message: "Token refreshed successfully",
      data: {
        accessToken,
        admin: {
          id: user._id,
          role: user.role,
          adminLevel: user.adminLevel,
          countryRef: user.countryRef || null,
          stateRef: user.stateRef || null,
          districtRef: user.districtRef || null,
          cityRef: user.cityRef || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};