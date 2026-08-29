/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/callWebhook.routes.js
 *
 * Phase H — Call Support (inbound). Deliberately NOT behind `protect`
 * — this is an unauthenticated provider/dev-adapter callback (the
 * provider cannot send our users' JWTs), secured instead by
 * callWebhookAuth's own shared-secret check. Mounted alongside the
 * other pre-protect public routes in app.js (/api/support/email,
 * /api/support/whatsapp, /api/support/auth), not under the generic
 * /api/support/admin or /api/support/customer prefixes, which both
 * require protect.
 */

import express from "express";
import { callWebhookAuth } from "../../../middlewares/callWebhookAuth.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { ingestInboundCallHandler } from "../controllers/callWebhook.controller.js";
import { callInboundSchemas } from "../validators/callInbound.validator.js";

const router = express.Router();

router.post("/inbound", callWebhookAuth, validate(callInboundSchemas.ingest), ingestInboundCallHandler);

export default router;
