/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentAuth.controller.js
 *
 * FA-2 — Field Agent OTP apply/login. Reuses the existing production
 * OTP helpers (utils/otp.helpers.js), session service, and token
 * service completely unmodified — no new authentication architecture.
 * Mirrors controllers/auth.controller.js's sendUserOtp/verifyUserOtp
 * shape exactly (phone normalization, Redis-backed OTP, same response
 * envelope), parameterized to role "FIELD_AGENT" instead of "USER".
 *
 * IMPORTANT: verifying OTP here only ever produces a User with role
 * FIELD_AGENT plus a FieldAgentApplication — it never creates a
 * FieldAgent profile or mints an Agent ID (FA-4 scope only).
 */

import { createSession } from "../../../services/session.service.js";
import { generateAccessToken } from "../../../services/token.service.js";
import logger from "../../../utils/logger.js";
import { createOrFindUser } from "../../../utils/otp.helpers.js";
import { sendOtp as sendOtpEngine, verifyOtp as verifyOtpEngine } from "../../../modules/otp/services/otp.service.js";
import { OTP_PURPOSE } from "../../../modules/otp/constants/otpPurpose.constants.js";
import {
  REFRESH_COOKIE_NAME,
  getRefreshCookieOptions as getCookieOptions,
} from "../../../utils/refreshCookie.js";
import { Errors } from "../../../utils/response.js";
import { FIELD_AGENT_OTP_ROLE } from "../constants/fieldAgent.constants.js";
import { createOrGetDraftApplication } from "../services/fieldAgentApplication.service.js";

export const sendFieldAgentOtp = async (req, res, next) => {
  try {
    const { phone } = req.body; // already normalized/validated by Joi

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during sendFieldAgentOtp", { phone });
      return next(Errors.internal("Service temporarily unavailable. Please try again."));
    }

    const result = await sendOtpEngine({ phone, purpose: OTP_PURPOSE.FIELD_AGENT_APPLY, role: FIELD_AGENT_OTP_ROLE, req, redis });

    if (!result.success) {
      if (result.code === "RESEND_TOO_SOON") {
        res.set("Retry-After", String(result.retryAfterSeconds));
        return next(Errors.tooMany("Please wait before requesting another OTP."));
      }
      logger.warn("Field agent OTP send failed", { phone, provider: result.provider, error: result.error });
      return next(Errors.badRequest("Could not send OTP. Please try again."));
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      ...(result.otp && { otp: result.otp }),
    });
  } catch (err) {
    return next(err);
  }
};

export const verifyFieldAgentOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body; // already validated by Joi

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during verifyFieldAgentOtp", { phone });
      return next(Errors.internal("Service temporarily unavailable. Please try again."));
    }

    const attempt = await verifyOtpEngine({ phone, purpose: OTP_PURPOSE.FIELD_AGENT_APPLY, otp, role: FIELD_AGENT_OTP_ROLE, req, redis });
    if (!attempt.ok) {
      const status = attempt.code === "TOO_MANY_ATTEMPTS" ? 429 : 401;
      return res.status(status).json({
        success: false,
        message: attempt.message,
        error: { code: attempt.code, message: attempt.message },
      });
    }

    //////////////////////////////////////////////////////////////
    // FIND OR CREATE — role is server-assigned here ONLY. Never
    // derived from req.body in any form (see route/validator — the
    // request schema has no "role" field at all).
    //////////////////////////////////////////////////////////////

    const user = await createOrFindUser(phone, FIELD_AGENT_OTP_ROLE, "Field Agent Applicant");

    if (user.accountStatus === "SUSPENDED" || user.accountStatus === "BLOCKED") {
      return next(Errors.forbidden(`Account ${user.accountStatus.toLowerCase()}`));
    }

    // Ensure an application exists (idempotent — see service). This is
    // the ONLY record created for this user pre-approval; no
    // FieldAgent profile, no Agent ID.
    const { application } = await createOrGetDraftApplication({ userId: user._id, phone });

    const refreshToken = await createSession(user, req);
    const accessToken = generateAccessToken(user);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions());

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      userId: user._id,
      role: user.role,
      application,
      message: "Login successful",
    });
  } catch (err) {
    return next(err);
  }
};
