/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminQueue.routes.js
 *
 * Phase H Step 8 (Step 3) — Support Configuration Management: Queues.
 * Fully new — no prior SupportQueue-facing route existed anywhere
 * (confirmed by inspection: every existing consumer only ever carries
 * targetQueueRef/queueRef as an opaque id, never queries SupportQueue
 * itself). SUPPORT_ADMIN/India-Admin-only, same
 * requireSupportAccess("SUPPORT_ADMIN") gate as every sibling Support
 * config router.
 *
 * Mounted at /api/support/admin/queues, BEFORE the broader
 * /api/support/admin prefix in app.js — same defensive route-order
 * convention as every other Support admin router.
 */

import express from "express";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createQueueHandler,
  listQueuesForAdminHandler,
  updateQueueHandler,
  updateQueueStatusHandler,
} from "../controllers/adminQueueConfig.controller.js";
import { supportQueueConfigSchemas } from "../validators/supportQueueConfig.validator.js";

const router = express.Router();

router.use(requireSupportAccess("SUPPORT_ADMIN"));

router.get("/", listQueuesForAdminHandler);
router.post("/", validate(supportQueueConfigSchemas.create), createQueueHandler);
router.patch("/:id", validate(supportQueueConfigSchemas.update), updateQueueHandler);
router.patch("/:id/status", validate(supportQueueConfigSchemas.updateStatus), updateQueueStatusHandler);

export default router;
