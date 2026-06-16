import User from "../models/User.js";
import Salon from "../models/Salon.js";
import { createSession } from "../services/session.service.js";
import { generateAccessToken } from "../services/token.service.js";

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
// OTP CONFIG
//////////////////////////////////////////////////////

const OTP_ATTEMPT_LIMIT = 5;
const OTP_WINDOW_SECONDS = 300;

const getOtpKey = (phone, role) => `otp:attempts:${role}:${phone}`;

//////////////////////////////////////////////////////
// PARTNER — SEND OTP
//////////////////////////////////////////////////////

export const sendOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    // TODO: Integrate real SMS provider (Twilio / MSG91)
    // await smsService.send(normalizedPhone, generatedOtp);

    return res.status(200).json({
      success: true,
      otp: "123456", // dev only — remove in production
      message: "OTP sent successfully",
    });

  } catch (error) {
    console.error("sendOtp error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

//////////////////////////////////////////////////////
// PARTNER — VERIFY OTP
//////////////////////////////////////////////////////

export const verifyOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const { otp } = req.body;

    if (!normalizedPhone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone & OTP are required",
      });
    }

    //////////////////////////////////////////////////////
    // REDIS — OTP ATTEMPT PROTECTION
    //////////////////////////////////////////////////////

    const redis = req.redis;

    if (!redis) {
      console.warn("⚠️ Redis not available");
    }

    const otpKey = getOtpKey(normalizedPhone, "OWNER");

    const attempts = await redis.get(otpKey);

    if (attempts && Number(attempts) >= OTP_ATTEMPT_LIMIT) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP attempts. Try again later.",
      });
    }

    //////////////////////////////////////////////////////
    // OTP CHECK
    //////////////////////////////////////////////////////

    if (otp !== "123456") {
      await redis.multi()
        .incr(otpKey)
        .expire(otpKey, OTP_WINDOW_SECONDS)
        .exec();

      return res.status(401).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await redis.del(otpKey);

    //////////////////////////////////////////////////////
    // PARTNER USER — FIND OR CREATE
    //////////////////////////////////////////////////////

    let user = await User.findOne({
      phone: normalizedPhone,
      role: "OWNER",
    }).select("+tokenVersion");

    if (!user) {
      user = new User({
        phone: normalizedPhone,
        role: "OWNER",
        name: "Salon Owner",
      });

      await user.save({ validateBeforeSave: false });
    }

    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: "Account suspended",
      });
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

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,  //
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
    console.error("verifyOtp error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error during verification",
    });
  }
};

//////////////////////////////////////////////////////
// USER — SEND OTP
//////////////////////////////////////////////////////

export const sendUserOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    // TODO: Integrate real SMS provider (Twilio / MSG91)
    // await smsService.send(normalizedPhone, generatedOtp);

    return res.status(200).json({
      success: true,
      otp: "123456", // dev only — remove in production
      message: "OTP sent successfully",
    });

  } catch (error) {
    console.error("sendUserOtp error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

//////////////////////////////////////////////////////
// USER — VERIFY OTP
//////////////////////////////////////////////////////

export const verifyUserOtp = async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const { otp } = req.body;

    if (!normalizedPhone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone & OTP are required",
      });
    }

    //////////////////////////////////////////////////////
    // REDIS — OTP ATTEMPT PROTECTION
    //////////////////////////////////////////////////////

    const redis = req.redis;

    if (!redis) {
      console.warn("⚠️ Redis not available");
    }

    const otpKey = getOtpKey(normalizedPhone, "USER");

    const attempts = await redis.get(otpKey);

    if (attempts && Number(attempts) >= OTP_ATTEMPT_LIMIT) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP attempts. Try again later.",
      });
    }

    //////////////////////////////////////////////////////
    // OTP CHECK
    //////////////////////////////////////////////////////

    if (otp !== "123456") {
      await redis.multi()
        .incr(otpKey)
        .expire(otpKey, OTP_WINDOW_SECONDS)
        .exec();

      return res.status(401).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await redis.del(otpKey);

    //////////////////////////////////////////////////////
    // USER — FIND OR CREATE
    //////////////////////////////////////////////////////

    let user = await User.findOne({
      phone: normalizedPhone,
      role: "USER",
    }).select("+tokenVersion");

    if (!user) {
      user = new User({
        phone: normalizedPhone,
        role: "USER",
        name: "Customer",
      });

      await user.save({ validateBeforeSave: false });
    }

    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: "Account suspended",
      });
    }

    //////////////////////////////////////////////////////
    // SESSION
    //////////////////////////////////////////////////////

    const refreshToken = await createSession(user, req);
    const accessToken = generateAccessToken(user);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions());

    //////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      accessToken,
      userId: user._id,
      role: user.role,
      isNewUser: !user.name || user.name === "Customer",
      message: "Login successful",
    });

  } catch (error) {
    console.error("verifyUserOtp error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};