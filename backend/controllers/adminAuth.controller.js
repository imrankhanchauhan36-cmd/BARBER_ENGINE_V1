import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";

import { createSession } from "../services/session.service.js";
import { generateAccessToken } from "../services/token.service.js";

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

export const adminLogin = async (req, res) => {
  try {
    //////////////////////////////////////////////////////
    // INPUT VALIDATION
    //////////////////////////////////////////////////////

    let { email, password, adminKey } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    //////////////////////////////////////////////////////
    // NORMALIZE PHONE
    //////////////////////////////////////////////////////

    

    //////////////////////////////////////////////////////
    // FETCH ADMIN
    //////////////////////////////////////////////////////

    const admin = await User.findOne({
      email,
      role: "ADMIN",
      isActive: true,
      isDeleted: { $ne: true },
    }).select(
      "+password +tokenVersion +loginAttempts +lockUntil +adminLevel +countryRef +stateRef +cityRef"
    );

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    //////////////////////////////////////////////////////
    // ACCOUNT LOCK CHECK
    //////////////////////////////////////////////////////

    if (admin.lockUntil && admin.lockUntil > Date.now()) {
      return res.status(423).json({
        success: false,
        message: "Account locked. Try again later.",
      });
    }

    //////////////////////////////////////////////////////
    // PASSWORD CHECK
    //////////////////////////////////////////////////////

    console.log("INPUT PASSWORD:", password);
    console.log("DB PASSWORD:", admin.password);

    const isMatch = await bcrypt.compare(password, admin.password);

    console.log("MATCH RESULT:", isMatch);

    if (!isMatch) {
      admin.loginAttempts += 1;

      if (admin.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        admin.lockUntil = Date.now() + LOCK_TIME;
        admin.loginAttempts = 0;
      }

      await admin.save();

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
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
        return res.status(401).json({
          success: false,
          message: "Invalid admin key",
        });
      }

      const keyBuffer = Buffer.from(adminKey);
      const envBuffer = Buffer.from(process.env.ADMIN_PANEL_KEY);

      if (
        keyBuffer.length !== envBuffer.length ||
        !crypto.timingSafeEqual(keyBuffer, envBuffer)
      ) {
        return res.status(401).json({
          success: false,
          message: "Invalid admin key",
        });
      }
    }

    //////////////////////////////////////////////////////
    // SAFETY CHECK
    //////////////////////////////////////////////////////

    if (!admin.countryRef) {
      console.error("CRITICAL: countryRef missing for admin:", admin._id);
      return res.status(500).json({
        success: false,
        message: "Admin configuration error",
      });
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

    console.log("ADMIN LOGIN SUCCESS:", {
      adminId: admin._id.toString(),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      time: new Date().toISOString(),
    });

    //////////////////////////////////////////////////////
    // RESPONSE (NO REFRESH TOKEN IN BODY)
    //////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      accessToken,
      admin: {
        id: admin._id,
        role: admin.role,
        adminLevel: admin.adminLevel,
        countryRef: admin.countryRef,
        stateRef: admin.stateRef || null,
        cityRef: admin.cityRef || null,
      },
    });

  } catch (error) {
    console.error("ADMIN LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};