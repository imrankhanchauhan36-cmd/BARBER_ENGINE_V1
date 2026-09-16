/**
 * BARBER ENGINE V1
 * backend/routes/adminGstPolicy.routes.js
 *
 * PAN-India GST configuration — mounted under /api/admin/finance/gst
 * with `protect` applied at the app.js mount level. INDIA-only for
 * every verb, including reads — same rationale as
 * adminCommercialPolicy.routes.js's own header comment: a commercial/
 * financial number is sensitive regardless of geography, and
 * requireAdminLevel has no built-in mechanism to scope a STATE/
 * DISTRICT admin to only their own territory, so this stays as narrow
 * as the closest existing precedent rather than assuming a broader
 * "appropriate admins" scope that nothing in this codebase can
 * actually enforce yet.
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createDraftGstPolicyHandler,
  listGstPoliciesHandler,
  getGstPolicyDetailHandler,
  updateDraftGstPolicyHandler,
  publishGstPolicyHandler,
  retireGstPolicyHandler,
} from "../controllers/adminGstPolicy.controller.js";
import { gstPolicySchemas } from "../validators/adminFinancePolicy.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];

router.post(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(gstPolicySchemas.createDraft),
  createDraftGstPolicyHandler
);
router.get(
  "/",
  requireAdminLevel(...INDIA_ONLY),
  validate(gstPolicySchemas.listQuery, "query"),
  listGstPoliciesHandler
);
router.get(
  "/:versionId",
  requireAdminLevel(...INDIA_ONLY),
  validate(gstPolicySchemas.versionIdParam, "params"),
  getGstPolicyDetailHandler
);
router.patch(
  "/:versionId",
  requireAdminLevel(...INDIA_ONLY),
  validate(gstPolicySchemas.versionIdParam, "params"),
  validate(gstPolicySchemas.updateDraft),
  updateDraftGstPolicyHandler
);
router.post(
  "/:versionId/publish",
  requireAdminLevel(...INDIA_ONLY),
  validate(gstPolicySchemas.versionIdParam, "params"),
  publishGstPolicyHandler
);
router.post(
  "/:versionId/retire",
  requireAdminLevel(...INDIA_ONLY),
  validate(gstPolicySchemas.versionIdParam, "params"),
  retireGstPolicyHandler
);

export default router;
