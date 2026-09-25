/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentOperationalAuth.controller.js
 *
 * FA-13A — APPROVED FIELD AGENT OPERATIONAL LOGIN. Deliberately a
 * SEPARATE file from fieldAgentAuth.controller.js (FA-2's own
 * application/apply OTP flow) — that file is untouched by this phase.
 *
 * CRITICAL DISTINCTION from fieldAgentAuth.controller.js#verifyFieldAgentOtp:
 *   - This handler NEVER calls createOrFindUser — it never creates a
 *     User. An unrecognized phone number is a clean 404, never an
 *     implicit "start applying" side effect.
 *   - This handler NEVER calls createOrGetDraftApplication (or any
 *     FieldAgentApplication write path) — confirmed by this file's own
 *     import list containing no reference to fieldAgentApplication.service.js
 *     at all. An approved agent's operational login can never spawn a
 *     new DRAFT application, reopen an approved one, or touch KYC/
 *     training/test state — those collections are not imported here.
 *   - Requires an EXISTING User (role FIELD_AGENT) AND an EXISTING
 *     FieldAgent profile (userRef match) AND
 *     FieldAgent.operationalStatus === ACTIVE (the only frozen
 *     "operational" status — PENDING_ACTIVATION is refused with a
 *     clear, non-guessable reason, never silently treated as eligible).
 *
 * REUSED UNMODIFIED: verifyOtpAttempt/storeOtpHash (utils/otp.helpers.js,
 * same FIELD_AGENT_OTP_ROLE Redis key namespace as the apply flow —
 * sending an OTP is role-scoped, not journey-scoped, so no new
 * namespace is introduced), createSession/generateAccessToken (session
 * architecture untouched, no second token/refresh/Redis-session
 * system), User.accountStatus SUSPENDED/BLOCKED enforcement (identical
 * check to every other login path in this codebase).
 *
 * Role is NEVER read from the request body — the Joi schema for this
 * route (reused verbatim from fieldAgentApplication.validator.js) has
 * no `role` field, and the query below is `{phone, role:"FIELD_AGENT"}`
 * — an OWNER-role user's phone simply never matches, returns 404,
 * never a wrong-role session.
 *
 * OTP-1 — sendFieldAgentOperationalOtp (below) is a NEW handler, added
 * so this flow's send-otp no longer shares fieldAgentAuth.controller.js's
 * sendFieldAgentOtp. Before OTP-1 both flows called the exact same
 * function with no purpose distinction, which meant they also shared
 * one Redis key (`otp:hash:FIELD_AGENT:{phone}`) — an agent with an
 * in-flight apply-OTP and an in-flight operational-login OTP at the
 * same time would silently overwrite one with the other. Both
 * send-otp and verify-otp for this flow now use
 * OTP_PURPOSE.FIELD_AGENT_LOGIN, its own isolated Redis namespace
 * (see modules/otp/constants/otpPurpose.constants.js).
 */

import FieldAgent from "../models/FieldAgent.js";
import User from "../../../models/User.js";
import { createSession } from "../../../services/session.service.js";
import { generateAccessToken } from "../../../services/token.service.js";
import logger from "../../../utils/logger.js";
import { sendOtp as sendOtpEngine, verifyOtp as verifyOtpEngine } from "../../../modules/otp/services/otp.service.js";
import { OTP_PURPOSE } from "../../../modules/otp/constants/otpPurpose.constants.js";
import {
  REFRESH_COOKIE_NAME,
  getRefreshCookieOptions as getCookieOptions,
} from "../../../utils/refreshCookie.js";
import { Errors } from "../../../utils/response.js";
import { FIELD_AGENT_OTP_ROLE, FIELD_AGENT_OPERATIONAL_STATUS } from "../constants/fieldAgent.constants.js";

export const sendFieldAgentOperationalOtp = async (req, res, next) => {
  try {
    const { phone } = req.body; // already normalized/validated by Joi

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during sendFieldAgentOperationalOtp", { phone });
      return next(Errors.internal("Service temporarily unavailable. Please try again."));
    }

    const result = await sendOtpEngine({ phone, purpose: OTP_PURPOSE.FIELD_AGENT_LOGIN, role: FIELD_AGENT_OTP_ROLE, req, redis });

    if (!result.success) {
      if (result.code === "RESEND_TOO_SOON") {
        res.set("Retry-After", String(result.retryAfterSeconds));
        return next(Errors.tooMany("Please wait before requesting another OTP."));
      }
      logger.warn("Field agent operational OTP send failed", { phone, provider: result.provider, error: result.error });
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

export const verifyFieldAgentOperationalOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body; // already validated by Joi — no role field exists on this schema

    const redis = req.redis;
    if (!redis) {
      logger.error("Redis unavailable during verifyFieldAgentOperationalOtp", { phone });
      return next(Errors.internal("Service temporarily unavailable. Please try again."));
    }

    const attempt = await verifyOtpEngine({ phone, purpose: OTP_PURPOSE.FIELD_AGENT_LOGIN, otp, role: FIELD_AGENT_OTP_ROLE, req, redis });
    if (!attempt.ok) {
      const status = attempt.code === "TOO_MANY_ATTEMPTS" ? 429 : 401;
      return res.status(status).json({
        success: false,
        message: attempt.message,
        error: { code: attempt.code, message: attempt.message },
      });
    }

    // NO createOrFindUser — operational login never creates a User.
    // Compound {phone, role} lookup: an OWNER (or any other role)
    // account with this phone simply does not match, same discipline
    // as createOrFindUser's own lookup half.
    const user = await User.findOne({ phone, role: FIELD_AGENT_OTP_ROLE }).select("+tokenVersion");
    if (!user) {
      return next(Errors.notFound("No Field Agent account found for this phone number"));
    }

    if (user.accountStatus === "SUSPENDED" || user.accountStatus === "BLOCKED") {
      return next(Errors.forbidden(`Account ${user.accountStatus.toLowerCase()}`));
    }

    // NO createOrGetDraftApplication — this file never imports or
    // calls anything from fieldAgentApplication.service.js. See file
    // header for why that is the whole point of this handler existing.
    const fieldAgent = await FieldAgent.findOne({ userRef: user._id }).lean();
    if (!fieldAgent) {
      return next(Errors.notFound("No approved Field Agent profile exists for this account yet"));
    }

    if (fieldAgent.operationalStatus !== FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE) {
      return next(Errors.forbidden(`Field Agent is not yet operational (status: ${fieldAgent.operationalStatus})`));
    }

    const refreshToken = await createSession(user, req);
    const accessToken = generateAccessToken(user);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions());

    logger.info("[analytics] field_agent_operational_login_success", { userId: user._id.toString() });

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      userId: user._id,
      role: user.role,
      fieldAgentId: fieldAgent._id,
      agentCode: fieldAgent.agentCode,
      commercialPath: fieldAgent.commercialPath,
      operationalStatus: fieldAgent.operationalStatus,
      message: "Login successful",
    });
  } catch (err) {
    return next(err);
  }
};
