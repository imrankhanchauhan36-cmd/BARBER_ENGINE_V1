/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentApproval.routes.js
 *
 * FA-4.2 — admin approval/rejection surface, mounted under
 * /api/admin/field-agents with `protect` applied at the app.js mount
 * level (same convention as adminTest.routes.js/adminTraining.routes.js).
 * Approve/reject are a national ZEMISH-policy decision — INDIA-level
 * admin only; read-only review (list/detail) is available to
 * INDIA/STATE/DISTRICT — identical read/write level split already
 * proven by adminTest.routes.js.
 *
 * FA-4.3 — GET / and GET /:applicationId now serve the full review
 * queue/detail (fieldAgentReview.service.js), superseding FA-4.2's own
 * minimal placeholder handlers (which existed only as "the minimum
 * FA-4.2 capability" pending this exact build-out). approve/reject
 * below are completely untouched by FA-4.3.
 *
 * FA-5.1 — one new additive route: POST /:fieldAgentId/commercial-model,
 * INDIA-only, selecting a FieldAgent's one-time commercialPath (see
 * commercialModel.service.js#selectCommercialPath). Deliberately added
 * to THIS existing router rather than a new one — it operates on the
 * same admin-approval bounded context (a decision about an already-
 * approved Field Agent), reusing this file's own established
 * INDIA-only write-level convention. approve/reject/review routes
 * above are completely untouched by FA-5.1.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { approveApplicationHandler, rejectApplicationHandler } from "../controllers/adminFieldAgentApproval.controller.js";
import { listApplicationsForReviewHandler, getApplicationReviewDetailHandler } from "../controllers/adminFieldAgentReview.controller.js";
import { selectCommercialPathHandler } from "../controllers/adminCommercialModel.controller.js";
import { adminFieldAgentApprovalSchemas } from "../validators/adminFieldAgentApproval.validator.js";
import { adminFieldAgentReviewSchemas } from "../validators/adminFieldAgentReview.validator.js";
import { adminCommercialModelSchemas } from "../validators/adminCommercialModel.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];
const WRITE_LEVELS = ["INDIA"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentReviewSchemas.listQuery, "query"),
  listApplicationsForReviewHandler
);

router.get(
  "/:applicationId",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentReviewSchemas.applicationIdParam, "params"),
  getApplicationReviewDetailHandler
);

router.post(
  "/:applicationId/approve",
  requireAdminLevel(...WRITE_LEVELS),
  idempotency,
  validate(adminFieldAgentApprovalSchemas.applicationIdParam, "params"),
  validate(adminFieldAgentApprovalSchemas.approveBody),
  approveApplicationHandler
);

router.post(
  "/:applicationId/reject",
  requireAdminLevel(...WRITE_LEVELS),
  idempotency,
  validate(adminFieldAgentApprovalSchemas.applicationIdParam, "params"),
  validate(adminFieldAgentApprovalSchemas.rejectBody),
  rejectApplicationHandler
);

// FA-5.1 — commercial-path selection operates on a FieldAgent (not an
// application) id, so it intentionally does NOT reuse
// applicationIdParam above.
router.post(
  "/:fieldAgentId/commercial-model",
  requireAdminLevel(...WRITE_LEVELS),
  idempotency,
  validate(adminCommercialModelSchemas.fieldAgentIdParam, "params"),
  validate(adminCommercialModelSchemas.selectCommercialPath),
  selectCommercialPathHandler
);

export default router;
