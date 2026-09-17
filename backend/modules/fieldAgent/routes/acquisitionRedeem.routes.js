/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/acquisitionRedeem.routes.js
 *
 * FA-5.3 — the owner-facing bridge. protect + requireRole("OWNER") are
 * applied INSIDE this router (never at the app.js mount level), the
 * exact same convention salon.onboarding.routes.js already uses for
 * every step of the onboarding wizard this endpoint is a sibling to.
 */

import express from "express";
import { protect } from "../../../middlewares/auth.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { createRedisRateLimiter, RATE_LIMIT_ACTIONS, RATE_LIMIT_CONFIG } from "../../../middlewares/redisRateLimit.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { redeemReferralHandler } from "../controllers/acquisitionRedeem.controller.js";
import { acquisitionClaimSchemas } from "../validators/acquisitionClaim.validator.js";

const router = express.Router();

router.use(protect);
router.use(requireRole("OWNER"));

// FA-15 Phase C1 — this route is authenticated OWNER (not anonymous),
// so the limiter key is the Owner's own req.user._id, never the
// referralCode or salonRef from the request body. Abuse/cost
// containment only — existing referral status/atomic DB correctness
// (one-time-use ISSUED->consumed transition) is unchanged.
const referralRedeemLimiter = createRedisRateLimiter({
  action: RATE_LIMIT_ACTIONS.OWNER_REFERRAL_REDEEM,
  ...RATE_LIMIT_CONFIG[RATE_LIMIT_ACTIONS.OWNER_REFERRAL_REDEEM],
});

router.post("/redeem", referralRedeemLimiter, idempotency, validate(acquisitionClaimSchemas.redeemBody), redeemReferralHandler);

export default router;
