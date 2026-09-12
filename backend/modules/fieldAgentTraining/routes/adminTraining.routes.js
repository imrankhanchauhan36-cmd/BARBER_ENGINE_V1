/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/routes/adminTraining.routes.js
 *
 * FA-3.3 — admin authoring + governance surface, mounted under
 * /api/admin/field-agent-training with `protect` applied at the
 * app.js mount level (matching routes/admin.routes.js's own mount
 * comment: "adminRoutes owns its own [internal gating]"). Curriculum
 * authoring is a national ZEMISH-policy asset — write operations
 * require INDIA-level admin, matching the same level
 * routes/location.routes.js and routes/admin.routes.js already use
 * for nation-wide config writes (states, categories). Read-only
 * inspection (progress, audit) is available to INDIA/STATE/DISTRICT,
 * mirroring location.routes.js's own read-vs-write level split.
 *
 * Media upload reuses the exact inline multer + Cloudinary pattern
 * already proven by modules/kyc/routes/fieldAgentKyc.routes.js —
 * memoryStorage, fileFilter allowlist, kept as its own copy (not a
 * shared helper) for the same "zero risk to unrelated upload paths"
 * reason that file states, and because this path uploads
 * type:"authenticated" via mediaDelivery.service.js, not a public
 * secure_url.
 */

import express from "express";
import multer from "multer";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { isAllowedTrainingMediaMime } from "../services/mediaDelivery.service.js";
import { Errors } from "../../../utils/response.js";
import {
  createDraftVersionHandler,
  listVersionsHandler,
  getVersionDetailHandler,
  addModuleHandler,
  updateModuleHandler,
  addContentHandler,
  updateContentHandler,
  deleteContentHandler,
  reorderModuleContentHandler,
  uploadContentMediaHandler,
  removeContentMediaHandler,
  publishVersionHandler,
  retireVersionHandler,
  discardDraftVersionHandler,
  listAgentProgressHandler,
  getAgentProgressDetailHandler,
  listAgentTrainingHistoryHandler,
  listAuditEventsHandler,
  overrideCompletionHandler,
} from "../controllers/adminTraining.controller.js";
import { trainingContentSchemas } from "../validators/trainingContent.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];
const WRITE_LEVELS = ["INDIA"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // lessons may be short videos, unlike the 5MB image-only caps elsewhere
  fileFilter: (req, file, cb) => {
    if (isAllowedTrainingMediaMime(file.mimetype)) cb(null, true);
    else cb(Errors.badRequest(`Unsupported media type: ${file.mimetype}`), false);
  },
});

// ─── Versions ─────────────────────────────────────────────────────
router.post("/versions", requireAdminLevel(...WRITE_LEVELS), validate(trainingContentSchemas.createVersion), createDraftVersionHandler);
router.get(
  "/versions",
  requireAdminLevel(...READ_LEVELS),
  validate(trainingContentSchemas.versionsListQuery, "query"),
  listVersionsHandler
);
router.get(
  "/versions/:versionId",
  requireAdminLevel(...READ_LEVELS),
  validate(trainingContentSchemas.versionIdParam, "params"),
  getVersionDetailHandler
);
router.post(
  "/versions/:versionId/publish",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.versionIdParam, "params"),
  publishVersionHandler
);
router.post(
  "/versions/:versionId/retire",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.versionIdParam, "params"),
  validate(trainingContentSchemas.retireVersion),
  retireVersionHandler
);
// FA-3.3.2.2 — discardDraftVersion itself re-reads the live document
// and refuses anything not DRAFT (409) — this route adds no separate
// status check, it's the service's own hard guarantee.
router.delete(
  "/versions/:versionId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.versionIdParam, "params"),
  discardDraftVersionHandler
);

// ─── Modules ──────────────────────────────────────────────────────
router.post(
  "/versions/:versionId/modules",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.versionIdParam, "params"),
  validate(trainingContentSchemas.addModule),
  addModuleHandler
);
router.patch(
  "/modules/:moduleId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.moduleIdParam, "params"),
  validate(trainingContentSchemas.updateModule),
  updateModuleHandler
);

// ─── Content ──────────────────────────────────────────────────────
router.post(
  "/modules/:moduleId/content",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.moduleIdParam, "params"),
  validate(trainingContentSchemas.addContent),
  addContentHandler
);
router.patch(
  "/content/:contentId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.contentIdParam, "params"),
  validate(trainingContentSchemas.updateContent),
  updateContentHandler
);
router.delete(
  "/content/:contentId",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.contentIdParam, "params"),
  deleteContentHandler
);
router.patch(
  "/modules/:moduleId/reorder-content",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.moduleIdParam, "params"),
  validate(trainingContentSchemas.reorderContent),
  reorderModuleContentHandler
);
router.post(
  "/content/:contentId/media",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.contentIdParam, "params"),
  upload.single("media"),
  uploadContentMediaHandler
);
router.delete(
  "/content/:contentId/media",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.contentIdParam, "params"),
  removeContentMediaHandler
);

// ─── Progress / Audit (read-only) ─────────────────────────────────
router.get(
  "/progress",
  requireAdminLevel(...READ_LEVELS),
  validate(trainingContentSchemas.progressListQuery, "query"),
  listAgentProgressHandler
);
router.get(
  "/progress/:agentUserId",
  requireAdminLevel(...READ_LEVELS),
  validate(trainingContentSchemas.agentUserIdParam, "params"),
  getAgentProgressDetailHandler
);
router.get(
  "/progress/:agentUserId/history",
  requireAdminLevel(...READ_LEVELS),
  validate(trainingContentSchemas.agentUserIdParam, "params"),
  listAgentTrainingHistoryHandler
);
router.get(
  "/audit",
  requireAdminLevel(...READ_LEVELS),
  validate(trainingContentSchemas.auditListQuery, "query"),
  listAuditEventsHandler
);

// ─── Progress override (RECOMMENDED / REQUIRES_APPROVAL, audited) ──
router.post(
  "/progress/override",
  requireAdminLevel(...WRITE_LEVELS),
  validate(trainingContentSchemas.overrideCompletion),
  overrideCompletionHandler
);

export default router;
