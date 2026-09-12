/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/routes/fieldAgentTest.routes.js
 *
 * FA-3.4.3 — agent-facing test surface. protect/onboardingBypass
 * applied at the app.js mount level, matching
 * fieldAgentTraining.routes.js exactly. requireRole("FIELD_AGENT")
 * applied here — an ADMIN (or any other role) token is rejected 403
 * before it ever reaches a handler, same as every other agent-facing
 * route family in this codebase; no new authorization policy is
 * invented.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import {
  getTestStatusHandler,
  startTestAttemptHandler,
  getAttemptQuestionsHandler,
  submitTestAttemptHandler,
} from "../controllers/fieldAgentTest.controller.js";
import { fieldAgentTestSchemas } from "../validators/fieldAgentTest.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));

router.get("/", getTestStatusHandler);

router.post(
  "/attempts",
  idempotency,
  validate(fieldAgentTestSchemas.startAttemptBody),
  startTestAttemptHandler
);

router.get(
  "/attempts/:attemptId",
  validate(fieldAgentTestSchemas.attemptIdParam, "params"),
  getAttemptQuestionsHandler
);

router.post(
  "/attempts/:attemptId/submit",
  idempotency,
  validate(fieldAgentTestSchemas.attemptIdParam, "params"),
  validate(fieldAgentTestSchemas.submitAnswers),
  submitTestAttemptHandler
);

export default router;
