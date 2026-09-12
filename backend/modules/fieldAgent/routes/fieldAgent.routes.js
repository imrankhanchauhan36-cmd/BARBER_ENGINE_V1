/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgent.routes.js
 *
 * FA-2 — applicant-facing application CRUD. protect/onboardingBypass
 * are applied at the app.js mount level, matching every other
 * consumer-facing route group (booking, support/customer, ratings).
 * requireRole is applied here, mirroring supportCustomer.routes.js's
 * own router.use(requireRole(...)) pattern exactly.
 *
 * Only the minimum FA-2 surface is exposed: request/verify OTP (see
 * fieldAgentAuth.routes.js), get own application, create/start,
 * update while DRAFT, submit, withdraw. No admin approval, no KYC, no
 * training/test, no zone, no salon, no commission/earnings, no
 * support, no payout — all explicitly out of FA-2 scope.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createMyApplicationHandler,
  getMyApplicationHandler,
  submitMyApplicationHandler,
  updateMyDraftApplicationHandler,
  withdrawMyApplicationHandler,
} from "../controllers/fieldAgentApplication.controller.js";
import { fieldAgentSchemas } from "../validators/fieldAgentApplication.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));

router.get("/applications/me", getMyApplicationHandler);
router.post("/applications", idempotency, createMyApplicationHandler);
router.patch(
  "/applications/me",
  idempotency,
  validate(fieldAgentSchemas.updateDraft),
  updateMyDraftApplicationHandler
);
router.post("/applications/me/submit", idempotency, submitMyApplicationHandler);
router.post(
  "/applications/me/withdraw",
  idempotency,
  validate(fieldAgentSchemas.withdraw),
  withdrawMyApplicationHandler
);

export default router;
