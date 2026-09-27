/**
 * BARBER ENGINE V1
 * backend/modules/wallet/routes/wallet.routes.js
 *
 * STEP 6.5A — HTTP API Exposure Audit + Build. Mounted under
 * /api/wallet with `protect` + `onboardingBypass` applied at the
 * app.js mount level — the exact same convention already documented
 * there for /api/payouts and /api/field-agent/payout* ("protect/
 * onboardingBypass-at-mount + requireRole-inside-route-file
 * convention"). requireRole("OWNER", "FIELD_AGENT") here, not just
 * "OWNER" like the SALON-only /api/payouts, because this ONE route set
 * serves all three entity types (SALON via OWNER, ACQUISITION_AGENT/
 * TERRITORY_PARTNER via FIELD_AGENT) — walletIdentityResolver.service.js
 * resolves exactly which one per request.
 */

import express from "express";
import asyncHandler from "express-async-handler";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getMyWalletHandler,
  getMyWalletHistoryHandler,
  requestPayoutHandler,
  getMyPayoutsHandler,
} from "../controllers/wallet.controller.js";
import { walletSchemas } from "../validators/wallet.validator.js";

const router = express.Router();

const SELF_SERVICE_ROLES = ["OWNER", "FIELD_AGENT"];

router.get("/me", requireRole(...SELF_SERVICE_ROLES), asyncHandler(getMyWalletHandler));
router.get("/history", requireRole(...SELF_SERVICE_ROLES), validate(walletSchemas.paginationQuery, "query"), asyncHandler(getMyWalletHistoryHandler));
router.post("/payout/request", requireRole(...SELF_SERVICE_ROLES), validate(walletSchemas.requestPayoutBody), asyncHandler(requestPayoutHandler));
router.get("/payouts", requireRole(...SELF_SERVICE_ROLES), validate(walletSchemas.paginationQuery, "query"), asyncHandler(getMyPayoutsHandler));

export default router;
