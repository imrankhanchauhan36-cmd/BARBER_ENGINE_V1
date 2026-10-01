/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/assistedOnboarding.controller.js
 *
 * PHASE 1 — PAN-India Field Agent Assisted Onboarding. Thin controllers
 * only — identity (fieldAgentUserId) is derived exclusively from
 * req.user._id, never from a client-supplied field, matching the exact
 * convention already used in fieldAgentAcquisitionClaim.controller.js.
 *
 * Neither handler ever reads/writes req.user beyond this derivation,
 * never calls any session/token helper for the OWNER, and never
 * returns an OTP value, an owner auth token, or a Field Agent token in
 * its response (see assistedOnboarding.service.js's own return shapes
 * — devOtp is only ever present when the OTP engine's own dev-echo
 * flag, ALLOW_FIXED_OTP, is set, exactly like every other existing
 * send-otp controller in this codebase).
 */

import { successResponse } from "../../../utils/response.js";
import { sendOwnerVerificationOtp, startAssistedOnboarding } from "../services/assistedOnboarding.service.js";

export const sendAssistedOnboardingOtpHandler = async (req, res, next) => {
  try {
    const result = await sendOwnerVerificationOtp({ phone: req.body.phone, req, redis: req.redis });
    return successResponse(res, {
      message: "OTP sent to the owner's phone",
      data: {
        phone: result.phone,
        ...(result.devOtp ? { devOtp: result.devOtp } : {}),
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const startAssistedOnboardingHandler = async (req, res, next) => {
  try {
    const result = await startAssistedOnboarding({
      fieldAgentUserId: req.user._id,
      phone: req.body.phone,
      otp: req.body.otp,
      createNewBranch: req.body.createNewBranch,
      assistedOnboardingToken: req.body.assistedOnboardingToken,
      req,
      redis: req.redis,
    });

    return successResponse(res, {
      statusCode: result.requiresSalonSelection ? 200 : 201,
      message: result.requiresSalonSelection
        ? "Owner verified — existing salons found, selection required"
        : "Assisted onboarding started",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};
