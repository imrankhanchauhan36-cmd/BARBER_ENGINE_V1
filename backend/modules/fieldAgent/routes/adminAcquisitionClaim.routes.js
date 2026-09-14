/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminAcquisitionClaim.routes.js
 *
 * FA-5.3 — admin review surface for AcquisitionClaim, mounted under
 * /api/admin/acquisition-claims with `protect` applied at the app.js
 * mount level, exact same convention as adminCommercialTerritory.routes.js.
 * Reject/reassign are INDIA-only (ending an attribution record is at
 * least as sensitive as CommercialTerritory's own admin actions);
 * reads are INDIA/STATE/DISTRICT, scoped to the admin's own geography
 * in the service layer via the claim's own denormalized stateRef/districtRef.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  adminListClaimsHandler,
  adminGetClaimDetailHandler,
  adminRejectClaimHandler,
  adminReassignClaimHandler,
} from "../controllers/adminAcquisitionClaim.controller.js";
import { acquisitionClaimSchemas } from "../validators/acquisitionClaim.validator.js";

const router = express.Router();

const INDIA_ONLY = ["INDIA"];
const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(acquisitionClaimSchemas.adminListQuery, "query"),
  adminListClaimsHandler
);

router.get(
  "/:claimId",
  requireAdminLevel(...READ_LEVELS),
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  adminGetClaimDetailHandler
);

router.post(
  "/:claimId/reject",
  requireAdminLevel(...INDIA_ONLY),
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  adminRejectClaimHandler
);

router.post(
  "/:claimId/reassign",
  requireAdminLevel(...INDIA_ONLY),
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  adminReassignClaimHandler
);

export default router;
