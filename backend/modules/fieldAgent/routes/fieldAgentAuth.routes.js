/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgentAuth.routes.js
 *
 * FA-2 — public (pre-authentication) OTP apply/login routes. Mounted
 * WITHOUT protect/onboardingBypass, mirroring /api/auth/user/* and
 * /api/auth/partner/* in routes/auth.routes.js exactly (those are
 * frozen and are NOT modified here — this is a new, separate route
 * file for a new role, not an extension of the existing one).
 *
 * Rate limiters mirror auth.routes.js's userOtpLimiter/userVerifyLimiter
 * shape exactly (same window/max/key-generator pattern), scoped with
 * their own key prefix so field-agent OTP abuse can never exhaust or
 * be exhausted by the existing user/partner OTP quotas.
 */

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  sendFieldAgentOtp,
  verifyFieldAgentOtp,
} from "../controllers/fieldAgentAuth.controller.js";
import { fieldAgentSchemas } from "../validators/fieldAgentApplication.validator.js";

const router = express.Router();

const fieldAgentOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `field_agent_otp_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const fieldAgentVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `field_agent_verify_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/send-otp",
  fieldAgentOtpLimiter,
  validate(fieldAgentSchemas.sendOtp),
  sendFieldAgentOtp
);

router.post(
  "/verify-otp",
  fieldAgentVerifyLimiter,
  validate(fieldAgentSchemas.verifyOtp),
  verifyFieldAgentOtp
);

export default router;
