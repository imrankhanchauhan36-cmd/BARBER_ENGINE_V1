/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/acquisitionRedeem.routes.js
 *
 * FA-5.3 — the owner-facing bridge. protect + requireRole("OWNER") are
 * applied INSIDE this router (never at the app.js mount level), the
 * exact same convention salon.onboarding.routes.js already uses for
 * every step of the onboarding wizard this endpoint is a sibling to.
 */

import express from "express";
import { protect } from "../../../middlewares/auth.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { redeemReferralHandler } from "../controllers/acquisitionRedeem.controller.js";
import { acquisitionClaimSchemas } from "../validators/acquisitionClaim.validator.js";

const router = express.Router();

router.use(protect);
router.use(requireRole("OWNER"));

router.post("/redeem", idempotency, validate(acquisitionClaimSchemas.redeemBody), redeemReferralHandler);

export default router;
