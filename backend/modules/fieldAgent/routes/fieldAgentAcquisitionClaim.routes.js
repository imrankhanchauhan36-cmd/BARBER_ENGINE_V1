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

router.post("/referrals", idempotency, issueReferralHandler);

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
