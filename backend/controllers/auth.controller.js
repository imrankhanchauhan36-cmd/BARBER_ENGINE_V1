import Salon from "../models/Salon.js";
import { createSession } from "../services/session.service.js";
import { sendOtpSms } from "../services/sms.service.js";
import { generateAccessToken } from "../services/token.service.js";
import logger from "../utils/logger.js";
import {
  createOrFindUser,
  generateOtp,
  isValidOtpFormat,
  storeOtpHash,
  verifyOtpAttempt,
} from "../utils/otp.helpers.js";

const REFRESH_COOKIE_NAME = "refreshToken";

//////////////////////////////////////////////////////
// COOKIE OPTIONS
//////////////////////////////////////////////////////

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
};

//////////////////////////////////////////////////////
// PHONE NORMALIZER
//////////////////////////////////////////////////////

const normalizePhone = (phone) => {
  if (!phone || typeof phone !== "string") return null;
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("91") && cleaned.length === 12)
    cleaned = cleaned.slice(2);
  if (!/^[6-9]\d{9}$/.test(cleaned)) return null;
  return cleaned;
};

//////////////////////////////////////////////////////
// STANDARD ERROR RESPONSE HELPER
// Success responses stay FLAT (accessToken/userId directly on
// the body) because LoginScreen.js / AuthContext.js already
// consume them that way — nesting under `data` now would break
// the already-working login flow without a coordinated frontend
// change. Error responses get a structured `error.code` for future
// use, while keeping a top-level `message` for backward-compat
// with existing `res?.message` reads in the frontend.
//////////////////////////////////////////////////////

const sendError = (res, status, code, message) =>
  res.status(status).json({
    success: false,
    message,
    error: { code, message },
  });

//////////////////////////////////////////////////////
// ANALYTICS EVENT HOOK
// Structured log events for now — swap for a real analytics SDK
// (Firebase/Mixpanel/etc) later without touching call sites.
//////////////////////////////////////////////////////

const trackEvent = (event, props = {}) => {
  logger.info(`[analytics] ${event}`, props);
};

//////////////////////////////////////////////////////
// PARTNER — SEND OTP
//////////////////////////////////////////////////////

export const sendOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    if (!normalizedPhone) {
      return sendError(res, 400, "INVALID_PHONE", "Invalid phone number format");
    }

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during sendOtp (OWNER)", { phone: normalizedPhone });
      return sendError(res, 503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable. Please try again.");
    }

    const otp = generateOtp();
    await storeOtpHash(redis, normalizedPhone, "OWNER", otp);
    const smsResult = await sendOtpSms(normalizedPhone, otp);

    if (!smsResult.success) {
      trackEvent("otp_send_failed", {
        role: "OWNER",
        phone: normalizedPhone,
        provider: smsResult.provider,
        error: smsResult.error,
      });
      return sendError(res, 502, "SMS_SEND_FAILED", "Could not send OTP. Please try again.");
    }

    trackEvent("otp_sent", {
      role: "OWNER",
      phone: normalizedPhone,
      provider: smsResult.provider,
      latencyMs: smsResult.latencyMs,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });

  } catch (error) {
    logger.error("sendOtp error", { message: error.message, stack: error.stack });
    return sendError(res, 500, "SERVER_ERROR", "Server error");
  }
};

//////////////////////////////////////////////////////
// PARTNER — VERIFY OTP
//////////////////////////////////////////////////////

export const verifyOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const { otp } = req.body;

    if (!normalizedPhone) {
      return sendError(res, 400, "INVALID_PHONE", "Invalid phone number format");
    }
    if (!isValidOtpFormat(otp)) {
      return sendError(res, 400, "INVALID_OTP_FORMAT", "OTP must be a 6-digit code");
    }

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during verifyOtp (OWNER)", { phone: normalizedPhone });
      return sendError(res, 503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable. Please try again.");
    }

    const attempt = await verifyOtpAttempt(redis, normalizedPhone, "OWNER", otp);
    if (!attempt.ok) {
      const status = attempt.code === "TOO_MANY_ATTEMPTS" ? 429 : 401;
      trackEvent("otp_verify_failed", { role: "OWNER", phone: normalizedPhone, code: attempt.code });
      return sendError(res, status, attempt.code, attempt.message);
    }

    //////////////////////////////////////////////////////
    // PARTNER USER — FIND OR CREATE
    //////////////////////////////////////////////////////

    const user = await createOrFindUser(normalizedPhone, "OWNER", "Salon Owner");

    if (user.status === "SUSPENDED") {
      return sendError(res, 403, "ACCOUNT_SUSPENDED", "Account suspended");
    }

    //////////////////////////////////////////////////////
    // SALON CHECK
    //////////////////////////////////////////////////////

    const salon = await Salon.findOne(
      { ownerId: user._id },
      { _id: 1, approval: 1, onboarding: 1 }
    ).lean();

    //////////////////////////////////////////////////////
    // SESSION
    //////////////////////////////////////////////////////

    const refreshToken = await createSession(user, req);
    const accessToken = generateAccessToken(user, salon?._id);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions());

    //////////////////////////////////////////////////////
    // ROUTING LOGIC
    //////////////////////////////////////////////////////

    let step = 0;
    let salonId = null;
    let status = null;
    let route = "ONBOARDING";

    if (salon) {
      salonId = salon._id;
      step = salon.onboarding?.step || 0;
      status = salon.approval?.status || null;

      if (status === "APPROVED") route = "DASHBOARD";
      else if (status === "PENDING") route = "PENDING";
      else if (status === "REJECTED") route = "REJECTED";
    }

    trackEvent("login_success", { role: "OWNER", userId: user._id.toString() });

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      userId: user._id,
      role: user.role,
      salonId,
      step,
      status,
      route,
      message: salon
        ? "OTP Verified. Resuming session."
        : "OTP Verified. Starting onboarding flow",
    });

  } catch (error) {
    logger.error("verifyOtp error", { message: error.message, stack: error.stack });
    return sendError(res, 500, "SERVER_ERROR", "Internal server error during verification");
  }
};

//////////////////////////////////////////////////////
// USER — SEND OTP
//////////////////////////////////////////////////////

export const sendUserOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    if (!normalizedPhone) {
      return sendError(res, 400, "INVALID_PHONE", "Invalid phone number format");
    }

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during sendUserOtp", { phone: normalizedPhone });
      return sendError(res, 503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable. Please try again.");
    }

    const otp = generateOtp();
    await storeOtpHash(redis, normalizedPhone, "USER", otp);
    const smsResult = await sendOtpSms(normalizedPhone, otp);

    if (!smsResult.success) {
      trackEvent("otp_send_failed", {
        role: "USER",
        phone: normalizedPhone,
        provider: smsResult.provider,
        error: smsResult.error,
      });
      return sendError(res, 502, "SMS_SEND_FAILED", "Could not send OTP. Please try again.");
    }

    trackEvent("otp_sent", {
      role: "USER",
      phone: normalizedPhone,
      provider: smsResult.provider,
      latencyMs: smsResult.latencyMs,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      ...(process.env.NODE_ENV !== "production" && { otp }),
    });

  } catch (error) {
    logger.error("sendUserOtp error", { message: error.message, stack: error.stack });
    return sendError(res, 500, "SERVER_ERROR", "Server error");
  }
};

//////////////////////////////////////////////////////
// USER — VERIFY OTP
//////////////////////////////////////////////////////

export const verifyUserOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const { otp } = req.body;

    if (!normalizedPhone) {
      return sendError(res, 400, "INVALID_PHONE", "Invalid phone number format");
    }
    if (!isValidOtpFormat(otp)) {
      return sendError(res, 400, "INVALID_OTP_FORMAT", "OTP must be a 6-digit code");
    }

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during verifyUserOtp", { phone: normalizedPhone });
      return sendError(res, 503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable. Please try again.");
    }

    const attempt = await verifyOtpAttempt(redis, normalizedPhone, "USER", otp);
    if (!attempt.ok) {
      const status = attempt.code === "TOO_MANY_ATTEMPTS" ? 429 : 401;
      trackEvent("otp_verify_failed", { role: "USER", phone: normalizedPhone, code: attempt.code });
      return sendError(res, status, attempt.code, attempt.message);
    }

    //////////////////////////////////////////////////////
    // USER — FIND OR CREATE
    //////////////////////////////////////////////////////

    const user = await createOrFindUser(normalizedPhone, "USER", "Customer");

    if (user.status === "SUSPENDED") {
      return sendError(res, 403, "ACCOUNT_SUSPENDED", "Account suspended");
    }

    //////////////////////////////////////////////////////
    // SESSION
    //////////////////////////////////////////////////////

    const refreshToken = await createSession(user, req);
    const accessToken = generateAccessToken(user);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions());

    trackEvent("login_success", { role: "USER", userId: user._id.toString() });

    //////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      userId: user._id,
      role: user.role,
      isNewUser: !user.name || user.name === "Customer",
      message: "Login successful",
    });

  } catch (error) {
    logger.error("verifyUserOtp error", { message: error.message, stack: error.stack });
    return sendError(res, 500, "SERVER_ERROR", "Internal server error");
  }
};