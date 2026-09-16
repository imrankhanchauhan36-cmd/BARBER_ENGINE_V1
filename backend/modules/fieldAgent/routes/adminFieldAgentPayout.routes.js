/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentPayout.routes.js
 *
 * FA-14 — Admin-facing Field Agent payout approval/rejection/manual-
 * payout-recording surface. `protect` is applied at the app.js mount
 * level (same convention as adminFieldAgentApproval.routes.js);
 * requireRole("ADMIN") + requireAdminLevel("INDIA") are applied here.
 *
 * INDIA-ONLY, NOT "INDIA and STATE" as originally locked — a
 * mid-implementation product decision (confirmed explicitly) after
 * discovering no Field Agent record carries one authoritative state
 * the way a salon's location.territory.stateRef does (see the
 * extensive comment on fieldAgentPayout.service.js's
 * isFieldAgentWithinPayoutScope for the full reasoning). STATE-level
 * admin approval is deferred to a future phase once a real universal
 * Field Agent territory concept exists. DISTRICT was never granted.
 *
 * isFieldAgentWithinPayoutScope() is still called a second time inside
 * fieldAgentPayout.service.js, so a future change to this route's
 * middleware alone could never silently widen access without the
 * service layer's own check also being updated.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  listPayoutsForAdminHandler,
  getPayoutDetailForAdminHandler,
  approvePayoutHandler,
  rejectPayoutHandler,
  recordManualPayoutResultHandler,
  retryFailedPayoutHandler,
} from "../controllers/adminFieldAgentPayout.controller.js";
import { adminFieldAgentPayoutSchemas } from "../validators/adminFieldAgentPayout.validator.js";

const router = express.Router();

router.use(requireRole("ADMIN"), requireAdminLevel("INDIA"));

router.get(
  "/",
  validate(adminFieldAgentPayoutSchemas.listPayoutsQuery, "query"),
  listPayoutsForAdminHandler
);

router.get(
  "/:id",
  validate(adminFieldAgentPayoutSchemas.payoutIdParam, "params"),
  getPayoutDetailForAdminHandler
);

router.patch(
  "/:id/approve",
  validate(adminFieldAgentPayoutSchemas.payoutIdParam, "params"),
  approvePayoutHandler
);

router.patch(
  "/:id/reject",
  validate(adminFieldAgentPayoutSchemas.payoutIdParam, "params"),
  validate(adminFieldAgentPayoutSchemas.rejectPayout, "body"),
  rejectPayoutHandler
);

router.patch(
  "/:id/manual-result",
  validate(adminFieldAgentPayoutSchemas.payoutIdParam, "params"),
  validate(adminFieldAgentPayoutSchemas.recordManualPayoutResult, "body"),
  recordManualPayoutResultHandler
);

router.patch(
  "/:id/retry",
  validate(adminFieldAgentPayoutSchemas.payoutIdParam, "params"),
  retryFailedPayoutHandler
);

export default router;
