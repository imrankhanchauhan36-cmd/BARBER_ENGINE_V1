/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminAcquisitionClaim.routes.js
 *
 * FA-5.3 — admin review surface for AcquisitionClaim, mounted under
 * /api/admin/acquisition-claims with `protect` applied at the app.js
 * mount level, exact same convention as adminCommercialTerritory.routes.js.
 * Approve/reject/reassign are all INDIA-only (starting or ending an
 * attribution record is at least as sensitive as CommercialTerritory's
 * own admin actions); reads are INDIA/STATE/DISTRICT, scoped to the
 * admin's own geography in the service layer via the claim's own
 * denormalized stateRef/districtRef.
 *
 * FA-P3-B Step 1 — added /:claimId/approve (PENDING_APPROVAL ->
 * ACTIVE_RECOVERY, the only path into recovery).
 *
 * PHASE C.3-A — added /:claimId/complete (ACTIVE_RECOVERY -> COMPLETED,
 * the only path that pays the fixed acquisition reward and ends the
 * relationship). INDIA-only, same rationale as approve/reject/reassign.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  adminListClaimsHandler,
  adminGetClaimDetailHandler,
  adminApproveClaimHandler,
  adminRejectClaimHandler,
  adminReassignClaimHandler,
  adminCompleteClaimHandler,
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

// FA-P3-B Step 1 — INDIA-only, same sensitivity rationale as
// reject/reassign (this is what STARTS financial entitlement).
router.post(
  "/:claimId/approve",
  requireAdminLevel(...INDIA_ONLY),
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  adminApproveClaimHandler
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

// PHASE C.3-A — the explicit acquisition closure event (ACTIVE_RECOVERY
// -> COMPLETED, fixed reward paid once). INDIA-only, same sensitivity
// rationale as approve/reject/reassign above (ending the relationship
// and triggering a financial reward is at least as sensitive as
// starting one).
router.post(
  "/:claimId/complete",
  requireAdminLevel(...INDIA_ONLY),
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  adminCompleteClaimHandler
);

export default router;
