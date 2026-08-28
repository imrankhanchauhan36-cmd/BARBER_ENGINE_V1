/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/supportAuth.controller.js
 *
 * Phase F.3.9 — the missing login surface for AGENT / SUPPORT_ADMIN
 * users (audited gap: neither /api/auth/admin/login nor
 * /api/admin-auth/login can ever match these roles — both hardcode
 * role:"ADMIN" in their User.findOne() query). Approved direction: a
 * new, separate endpoint, leaving the ADMIN login (adminKey secret,
 * lockout, adminLevel/geography) completely untouched.
 *
 * Mirrors adminAuth.controller.js's login/refresh/logout/me shape and
 * reuses every existing primitive unmodified — session.service.js's
 * createSession/rotateSession/revokeSession, token.service.js's
 * generateAccessToken (already role-agnostic, confirmed during the
 * F.3.9 audit), and utils/refreshCookie.js's shared cookie options. No
 * adminKey step — that is an ADMIN-specific secret, not part of this
 * approved scope. No adminLevel/countryRef/stateRef in the response —
 * those are the ADMIN geographic-hierarchy fields; AGENT/SUPPORT_ADMIN
 * have no equivalent (team-lead scope is resolved per-request from
 * SupportTeam.teamLeadRef, never cached client-side, matching F.3.7).
 */

import bcrypt from "bcryptjs";
import User from "../../../models/User.js";
import {
  createSession,
  revokeSession,
  rotateSession,
} from "../../../services/session.service.js";
import { generateAccessToken } from "../../../services/token.service.js";
import logger from "../../../utils/logger.js";
import { Errors, successResponse } from "../../../utils/response.js";
import {
  getRefreshCookieOptions as getCookieOptions,
  getClearRefreshCookieOptions,
} from "../../../utils/refreshCookie.js";

const SUPPORT_ROLES = ["AGENT", "SUPPORT_ADMIN"];

// Same policy values as adminAuth.controller.js's ADMIN login — not a
// new security posture, just applied to this second staff-login
// surface.
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export const supportLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(Errors.badRequest("Email and password are required"));
    }

    const user = await User.findOne({
      email,
      role: { $in: SUPPORT_ROLES },
      isActive: true,
      isDeleted: { $ne: true },
    }).select("+password +tokenVersion +loginAttempts +lockUntil");

    if (!user) {
      return next(Errors.unauthorized("Invalid credentials"));
    }

    if (user.lockUntil && user.lockUntil > Date.now()) {
      return next(Errors.forbidden("Account locked. Try again later."));
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = Date.now() + LOCK_TIME;
        user.loginAttempts = 0;
      }
      await user.save();
      return next(Errors.unauthorized("Invalid credentials"));
    }

    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    // Same "invalidate prior sessions on fresh login" convention as
    // adminLogin — applied identically here, not a new policy.
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    user.tokenVersion += 1;

    const refreshToken = await createSession(user, req);
    const accessToken = generateAccessToken(user);

    res.cookie("refreshToken", refreshToken, getCookieOptions());

    logger.info("Support login success", {
      userId: user._id.toString(),
      role: user.role,
      ip: req.ip,
    });

    return successResponse(res, {
      message: "Login successful",
      data: { accessToken, user: toPublicUser(user) },
    });
  } catch (err) {
    next(err);
  }
};

export const supportLogout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.headers["x-refresh-token"];
    if (refreshToken) await revokeSession(refreshToken);

    res.clearCookie("refreshToken", getClearRefreshCookieOptions());
    return successResponse(res, { message: "Logged out successfully", data: null });
  } catch (err) {
    next(err);
  }
};

export const supportMe = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return next(Errors.unauthorized("Not authenticated"));

    const user = await User.findOne({
      _id: userId,
      role: { $in: SUPPORT_ROLES },
      isActive: true,
      isDeleted: { $ne: true },
    }).select("name email role +tokenVersion");

    if (!user) {
      return next(Errors.unauthorized("Account not found or inactive"));
    }

    if (
      req.user?.tokenVersion !== undefined &&
      req.user.tokenVersion !== user.tokenVersion
    ) {
      return next(Errors.unauthorized("Session expired. Please log in again."));
    }

    return successResponse(res, {
      message: "Profile fetched successfully",
      data: { user: toPublicUser(user) },
    });
  } catch (err) {
    next(err);
  }
};

export const supportRefresh = async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refreshToken || req.headers["x-refresh-token"];
    if (!rawToken) return next(Errors.unauthorized("Refresh token missing"));

    const result = await rotateSession(rawToken, req);

    // SUPPORT_ROLES covers the existing AGENT/SUPPORT_ADMIN case,
    // unchanged. The India-level main-console Admin (role:"ADMIN",
    // adminLevel:"INDIA" — the single, DB-uniquely-constrained top
    // tier, see User.js's partial unique index on {role,adminLevel})
    // is additionally allowed to bridge into a Support session here,
    // reusing the SAME shared refreshToken cookie their existing
    // /api/admin-auth/login session already set — no second login, no
    // new token/cookie system. supportLogin (email+password) is
    // deliberately NOT changed — an India Admin still cannot
    // authenticate directly at /support-login.
    const isSupportRole = !!result && SUPPORT_ROLES.includes(result.user?.role);
    const isIndiaAdmin = !!result && result.user?.role === "ADMIN" && result.user?.adminLevel === "INDIA";

    if (!isSupportRole && !isIndiaAdmin) {
      res.clearCookie("refreshToken", getClearRefreshCookieOptions());
      return next(Errors.unauthorized("Session expired. Please log in again."));
    }

    const { accessToken, refreshToken, user } = result;
    res.cookie("refreshToken", refreshToken, getCookieOptions());

    return successResponse(res, {
      message: "Token refreshed successfully",
      data: { accessToken, user: toPublicUser(user) },
    });
  } catch (err) {
    next(err);
  }
};
