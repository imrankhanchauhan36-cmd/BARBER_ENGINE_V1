/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgentAcquisitionClaim.routes.js
 *
 * FA-5.3 — Field-Agent-facing acquisition surface. protect/onboardingBypass
 * are applied at the app.js mount level, matching the exact precedent
 * of fieldAgentTrainingRoutes/fieldAgentTestRoutes; requireRole is
 * applied here, mirroring fieldAgent.routes.js's own
 * router.use(requireRole("FIELD_AGENT")) pattern exactly. idempotency
 * is applied to every mutating endpoint, same convention as FA-2's own
 * field-agent-facing POST endpoints.
 *
 * No route here accepts a client-supplied fieldAgentRef — every
 * handler derives it from req.user._id via getFieldAgentByUserId.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { requireActiveFieldAgent } from "../middlewares/requireActiveFieldAgent.js";
import { createRedisRateLimiter, RATE_LIMIT_ACTIONS, RATE_LIMIT_CONFIG } from "../../../middlewares/redisRateLimit.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  issueReferralHandler,
  listMyReferralsHandler,
  cancelMyReferralHandler,
  listMyClaimsHandler,
  withdrawMyClaimHandler,
} from "../controllers/fieldAgentAcquisitionClaim.controller.js";
import { acquisitionClaimSchemas } from "../validators/acquisitionClaim.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));
// FA-15 Phase A — request-level operationalStatus re-check, uniform
// across this whole "operational" surface (issueReferral/withdrawClaim
// already had their own ad-hoc ACTIVE check via assertClaimEligible;
// this closes the gap on the read-only list endpoints too).
router.use(requireActiveFieldAgent);

// FA-15 Phase C1 — abuse/cost-containment only, sits before the
// existing idempotency+handler chain; does not alter referral
// generation, acquisition attribution, territory rules, referral
// ownership, cancellation, or claim creation in any way.
const referralCreateLimiter = createRedisRateLimiter({
  action: RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE,
  ...RATE_LIMIT_CONFIG[RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE],
});

router.post("/referrals", referralCreateLimiter, idempotency, issueReferralHandler);

router.get(
  "/referrals/mine",
  validate(acquisitionClaimSchemas.listReferralsQuery, "query"),
  listMyReferralsHandler
);

router.post(
  "/referrals/:referralId/cancel",
  validate(acquisitionClaimSchemas.referralIdParam, "params"),
  idempotency,
  cancelMyReferralHandler
);

router.get(
  "/claims/mine",
  validate(acquisitionClaimSchemas.listClaimsQuery, "query"),
  listMyClaimsHandler
);

router.post(
  "/claims/:claimId/withdraw",
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  idempotency,
  withdrawMyClaimHandler
);

export default router;
