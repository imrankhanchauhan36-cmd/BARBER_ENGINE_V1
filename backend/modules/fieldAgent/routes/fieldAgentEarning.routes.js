/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgentEarning.routes.js
 *
 * FA-14 — Field-Agent-facing earnings self-service surface, READ ONLY.
 * protect/onboardingBypass are applied at the app.js mount level,
 * matching the exact precedent of fieldAgentAcquisitionClaimRoutes;
 * requireRole is applied here, mirroring that same router's own
 * router.use(requireRole("FIELD_AGENT")) pattern exactly.
 *
 * No route here accepts a client-supplied fieldAgentRef/userId/agentId
 * — the only handler derives identity from req.user._id via
 * getFieldAgentByUserId (see the service file), and the query schema's
 * .unknown(false) structurally rejects any such field outright.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { listMyEarningsHandler } from "../controllers/fieldAgentEarning.controller.js";
import { fieldAgentEarningSchemas } from "../validators/fieldAgentEarning.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));

router.get(
  "/mine",
  validate(fieldAgentEarningSchemas.listEarningsQuery, "query"),
  listMyEarningsHandler
);

export default router;
