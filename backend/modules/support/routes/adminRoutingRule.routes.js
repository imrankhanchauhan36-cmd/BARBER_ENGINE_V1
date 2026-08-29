/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminRoutingRule.routes.js
 *
 * Phase H Step 8 (Step 4) — Support Configuration Management: Routing
 * Rules. Fully new — routingResolution.service.js only ever READS
 * active SupportRoutingRule rows; no admin write route existed before
 * this. This router/controller/service do not modify, wrap, or bypass
 * resolveRouting()/selectWinningRule() in any way — they only manage
 * the rows that engine already reads.
 *
 * SUPPORT_ADMIN/India-Admin-only, same requireSupportAccess
 * ("SUPPORT_ADMIN") gate as every sibling Support config router.
 *
 * Mounted at /api/support/admin/routing-rules, BEFORE the broader
 * /api/support/admin prefix in app.js.
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createRoutingRuleHandler,
  listRoutingRulesForAdminHandler,
  updateRoutingRuleHandler,
  updateRoutingRuleStatusHandler,
} from "../controllers/adminRoutingRuleConfig.controller.js";
import { supportRoutingRuleConfigSchemas } from "../validators/supportRoutingRuleConfig.validator.js";

const router = express.Router();

router.use(requireSupportAccess("SUPPORT_ADMIN"));

router.get("/", listRoutingRulesForAdminHandler);
router.post("/", validate(supportRoutingRuleConfigSchemas.create), createRoutingRuleHandler);
router.patch("/:id", validate(supportRoutingRuleConfigSchemas.update), updateRoutingRuleHandler);
router.patch("/:id/status", validate(supportRoutingRuleConfigSchemas.updateStatus), updateRoutingRuleStatusHandler);

export default router;
