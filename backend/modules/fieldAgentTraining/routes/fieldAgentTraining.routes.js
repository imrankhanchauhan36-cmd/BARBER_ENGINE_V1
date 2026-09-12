/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/routes/fieldAgentTraining.routes.js
 *
 * FA-3.3 — agent-facing training surface. protect/onboardingBypass
 * applied at the app.js mount level, matching
 * modules/fieldAgent/routes/fieldAgent.routes.js and
 * modules/kyc/routes/fieldAgentKyc.routes.js exactly. requireRole
 * applied here.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import {
  getMyTrainingOverviewHandler,
  getModuleContentHandler,
  recordLessonProgressHandler,
  submitGradedContentHandler,
  getMediaAccessUrlHandler,
} from "../controllers/fieldAgentTraining.controller.js";
import { fieldAgentTrainingSchemas } from "../validators/fieldAgentTraining.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));

router.get(
  "/me",
  validate(fieldAgentTrainingSchemas.languageQuery, "query"),
  getMyTrainingOverviewHandler
);

router.get(
  "/modules/:moduleKey",
  validate(fieldAgentTrainingSchemas.moduleKeyParam, "params"),
  validate(fieldAgentTrainingSchemas.languageQuery, "query"),
  getModuleContentHandler
);

router.post(
  "/content/:contentId/lesson-progress",
  idempotency,
  validate(fieldAgentTrainingSchemas.contentIdParam, "params"),
  validate(fieldAgentTrainingSchemas.lessonProgress),
  recordLessonProgressHandler
);

router.post(
  "/content/:contentId/submit",
  idempotency,
  validate(fieldAgentTrainingSchemas.contentIdParam, "params"),
  validate(fieldAgentTrainingSchemas.gradedSubmission),
  submitGradedContentHandler
);

router.get(
  "/content/:contentId/media",
  validate(fieldAgentTrainingSchemas.contentIdParam, "params"),
  getMediaAccessUrlHandler
);

export default router;
