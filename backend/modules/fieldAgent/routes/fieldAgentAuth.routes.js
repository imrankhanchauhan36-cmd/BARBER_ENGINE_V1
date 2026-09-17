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
 *
 * FA-13A — additive only. The two /login/* routes below are the
 * APPROVED FIELD AGENT OPERATIONAL LOGIN contract (day-to-day login
 * for an already-approved agent), deliberately separate from
 * /send-otp and /verify-otp above (FA-2's own apply/application flow,
 * byte-for-byte unchanged — same handlers, same limiters, same
 * validator). /login/send-otp reuses sendFieldAgentOtp UNMODIFIED
 * (sending an OTP is role-scoped, not journey-scoped, so no new logic
 * or Redis key namespace is needed for it) with its own dedicated
 * rate limiter so operational-login OTP traffic can never exhaust or
 * be exhausted by the apply-flow's own quota. /login/verify-otp is a
 * genuinely new handler (fieldAgentOperationalAuth.controller.js) —
 * see that file's own header for the full contract.
 */

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  sendFieldAgentOtp,
  verifyFieldAgentOtp,
} from "../controllers/fieldAgentAuth.controller.js";
import { verifyFieldAgentOperationalOtp } from "../controllers/fieldAgentOperationalAuth.controller.js";
import { fieldAgentSchemas } from "../validators/fieldAgentApplication.validator.js";

const router = express.Router();

// FA-15 Phase A — fixed the ipKeyGenerator misuse found in the FA-15
// security audit: express-rate-limit's ipKeyGenerator signature is
// `(ip: string, ipv6Subnet?) => string` — it expects the IP itself,
// not the whole Express request object. The previous
// `ipKeyGenerator(req)` call passed a non-string, which fails the
// internal isIPv6() check and falls through to returning the object
// template-coerced to the literal string "[object Object]" — every
// caller collapsed onto the SAME bucket regardless of source IP, so
// the limiter enforced its max globally instead of per-IP. Fixed by
// switching to `ipKeyGenerator(req.ip)`, the same correct pattern
// already used below by fieldAgentLoginOtpLimiter/
// fieldAgentLoginVerifyLimiter.
//
// NOTE — the identical root-cause bug also exists in the platform's
// shared globalLimiter (app.js) and in routes/auth.routes.js's
// OWNER/USER OTP limiters. Those are explicitly OUT OF SCOPE for this
// FA-15 phase (frozen/shared code, not owned by this feature) and are
// tracked as a separate backlog observation, not fixed here.
const fieldAgentOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `field_agent_otp_${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const fieldAgentVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `field_agent_verify_${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

// FA-13A — isolated quota, same shape as the two limiters above, so
// operational-login abuse/traffic can never exhaust (or be exhausted
// by) the apply-flow's own OTP quota. Already used the correct
// `ipKeyGenerator(req.ip)` pattern from the start.
const fieldAgentLoginOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `field_agent_login_otp_${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const fieldAgentLoginVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `field_agent_login_verify_${ipKeyGenerator(req.ip)}`,
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

// FA-13A — APPROVED FIELD AGENT OPERATIONAL LOGIN.
router.post(
  "/login/send-otp",
  fieldAgentLoginOtpLimiter,
  validate(fieldAgentSchemas.sendOtp),
  sendFieldAgentOtp
);

router.post(
  "/login/verify-otp",
  fieldAgentLoginVerifyLimiter,
  validate(fieldAgentSchemas.verifyOtp),
  verifyFieldAgentOperationalOtp
);

export default router;
