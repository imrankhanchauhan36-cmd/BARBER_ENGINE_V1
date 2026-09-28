/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentWallet.routes.js
 *
 * STEP 2.4 — Admin Field Agent Wallet & Payout History APIs. Mounted
 * at the SAME base path as every sibling admin field-agent router
 * (/api/admin/field-agents), as a SEPARATE app.js mount registered
 * alongside them — GET /:id/wallet and GET /:id/payouts (two path
 * segments each, literal "wallet"/"payouts" second segments) never
 * collide with adminFieldAgentApprovalRoutes' own routes, nor with
 * any sibling STEP 2.x router's own "/:id/summary", "/:id/salons",
 * "/:id/earnings" routes, so Express correctly falls through to this
 * router untouched. `protect` is applied at the app.js mount level,
 * matching every other admin field-agent route file.
 *
 * READ_LEVELS mirrors every sibling STEP 2.x router's own identical
 * split (INDIA/STATE/DISTRICT) — these are single-agent, by-id reads,
 * so (per the STEP 1.3 audit) no additional per-admin-level scoping is
 * applied here, same precedent as every other by-id admin field-agent
 * read endpoint in this codebase.
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getAdminFieldAgentWalletHandler,
  getAdminFieldAgentPayoutHistoryHandler,
} from "../controllers/adminFieldAgentWallet.controller.js";
import { adminFieldAgentWalletSchemas } from "../validators/adminFieldAgentWallet.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];

router.get(
  "/:id/wallet",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentWalletSchemas.fieldAgentIdParam, "params"),
  getAdminFieldAgentWalletHandler
);

router.get(
  "/:id/payouts",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentWalletSchemas.fieldAgentIdParam, "params"),
  getAdminFieldAgentPayoutHistoryHandler
);

export default router;
