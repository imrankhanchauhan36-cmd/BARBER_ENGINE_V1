/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgentPayout.routes.js
 *
 * FA-14 — Field-Agent-facing withdrawal/payout self-service surface.
 * protect/onboardingBypass are applied at the app.js mount level,
 * matching the exact precedent of fieldAgentEarningRoutes;
 * requireRole is applied here, mirroring that same router's own
 * router.use(requireRole("FIELD_AGENT")) pattern exactly.
 *
 * No route here accepts a client-supplied fieldAgentRef/userId/agentId/
 * bankSnapshot/status — every handler derives identity from
 * req.user._id via the service layer, and the request schemas'
 * .unknown(false) rejects any such field outright.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { requireActiveFieldAgent } from "../middlewares/requireActiveFieldAgent.js";
import { createRedisRateLimiter, RATE_LIMIT_ACTIONS, RATE_LIMIT_CONFIG } from "../../../middlewares/redisRateLimit.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getMyBalanceHandler,
  createWithdrawalHandler,
  listMyPayoutsHandler,
  getMyPayoutDetailHandler,
  cancelMyPayoutHandler,
} from "../controllers/fieldAgentPayout.controller.js";
import { fieldAgentPayoutSchemas } from "../validators/fieldAgentPayout.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));
// FA-15 Phase A — request-level operationalStatus re-check, added in
// front of this frozen FA-14 route file. This is a route-layer
// authorization gate only — it does not touch, wrap, or alter any
// FA-14 service logic (balance computation, transaction, state
// machine, bank snapshot) below it. createWithdrawalRequest already
// had its own ad-hoc ACTIVE check (assertFieldAgentEligibleForPayout);
// this closes the same gap on /balance, /mine, /mine/:id, and
// /mine/:id/cancel, which had none.
router.use(requireActiveFieldAgent);

router.get(
  "/balance",
  getMyBalanceHandler
);

// FA-15 Phase C1 — defense-in-depth abuse/cost containment only. Does
// NOT touch, wrap, or alter available-balance computation, the ₹100
// minimum, full/partial withdrawal, bank verification/snapshot,
// idempotency, the one-active-withdrawal rule, the Mongo transaction,
// status transitions, admin approval, or failed-payout retry — all of
// that remains entirely inside createWithdrawalRequest, unmodified.
const payoutWithdrawLimiter = createRedisRateLimiter({
  action: RATE_LIMIT_ACTIONS.FIELD_AGENT_PAYOUT_WITHDRAW,
  ...RATE_LIMIT_CONFIG[RATE_LIMIT_ACTIONS.FIELD_AGENT_PAYOUT_WITHDRAW],
});

router.post(
  "/withdraw",
  payoutWithdrawLimiter,
  validate(fieldAgentPayoutSchemas.createWithdrawal, "body"),
  createWithdrawalHandler
);

router.get(
  "/mine",
  validate(fieldAgentPayoutSchemas.listMyPayoutsQuery, "query"),
  listMyPayoutsHandler
);

router.get(
  "/mine/:id",
  validate(fieldAgentPayoutSchemas.payoutIdParam, "params"),
  getMyPayoutDetailHandler
);

router.post(
  "/mine/:id/cancel",
  validate(fieldAgentPayoutSchemas.payoutIdParam, "params"),
  cancelMyPayoutHandler
);

export default router;
