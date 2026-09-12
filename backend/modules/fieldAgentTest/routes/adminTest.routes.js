/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/routes/adminTest.routes.js
 *
 * FA-3.4.1 — admin authoring + governance surface, mounted under
 * /api/admin/field-agent-test with `protect` applied at the app.js
 * mount level (same convention as adminTraining.routes.js). Exam
 * authoring is a national ZEMISH-policy asset — write operations
 * require INDIA-level admin; read-only inspection is available to
 * INDIA/STATE/DISTRICT — identical read/write level split to
 * adminTraining.routes.js.
 *
 * No attempt-listing/review endpoint exists here — TestAttempt does
 * not exist yet (FA-3.4.2/3.4.3), and admin attempt review is
 * explicitly deferred to FA-4 per the approved plan.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createDraftVersionHandler,
  listVersionsHandler,
  getVersionDetailHandler,
  updateDraftVersionHandler,
  addQuestionHandler,
  updateQuestionHandler,
  deleteQuestionHandler,
  reorderQuestionsHandler,
  publishVersionHandler,
  retireVersionHandler,
  discardDraftVersionHandler,
} from "../controllers/adminTest.controller.js";
import { testContentSchemas } from "../validators/testContent.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];
const WRITE_LEVELS = ["INDIA"];

// ─── Versions ─────────────────────────────────────────────────────
router.post("/versions", requireAdminLevel(...WRITE_LEVELS), validate(testContentSchemas.createVersion), createDraftVersionHandler);
router.get(
  "/versions",
  requireAdminLevel(...READ_LEVELS),
  validate(testContentSchemas.versionsListQuery, "query"),
  listVersionsHandler
);
router.get(
  "/versions/:versionId",
  requireAdminLevel(...READ_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  getVersionDetailHandler
);
router.patch(
  "/versions/:versionId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  validate(testContentSchemas.updateVersion),
  updateDraftVersionHandler
);
// discardDraftVersion itself re-reads the live document and refuses
// anything not DRAFT (409) — this route adds no separate status
// check, it's the service's own hard guarantee.
router.delete(
  "/versions/:versionId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  discardDraftVersionHandler
);
router.post(
  "/versions/:versionId/publish",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  publishVersionHandler
);
router.post(
  "/versions/:versionId/retire",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  validate(testContentSchemas.retireVersion),
  retireVersionHandler
);

// ─── Questions ────────────────────────────────────────────────────
router.post(
  "/versions/:versionId/questions",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  validate(testContentSchemas.addQuestion),
  addQuestionHandler
);
router.patch(
  "/questions/:questionId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.questionIdParam, "params"),
  validate(testContentSchemas.updateQuestion),
  updateQuestionHandler
);
router.delete(
  "/questions/:questionId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.questionIdParam, "params"),
  deleteQuestionHandler
);
router.patch(
  "/versions/:versionId/reorder-questions",
  requireAdminLevel(...WRITE_LEVELS),
  validate(testContentSchemas.versionIdParam, "params"),
  validate(testContentSchemas.reorderQuestions),
  reorderQuestionsHandler
);

export default router;
