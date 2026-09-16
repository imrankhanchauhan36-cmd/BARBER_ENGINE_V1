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

router.get(
  "/balance",
  getMyBalanceHandler
);

router.post(
  "/withdraw",
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
