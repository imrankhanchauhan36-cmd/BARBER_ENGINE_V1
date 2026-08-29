/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/whatsappWebhook.routes.js
 *
 * Phase H — WhatsApp Support (inbound). Deliberately NOT behind
 * `protect` — this is an unauthenticated provider/dev-adapter callback
 * (the provider cannot send our users' JWTs), secured instead by
 * whatsappWebhookAuth's own shared-secret check. Mounted alongside the
 * other pre-protect public routes in app.js (/api/support/email,
 * /api/support/auth, /api/auth), not under the generic
 * /api/support/admin or /api/support/customer prefixes, which both
 * require protect.
 */

import express from "express";
import { whatsappWebhookAuth } from "../../../middlewares/whatsappWebhookAuth.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { ingestInboundWhatsAppHandler } from "../controllers/whatsappWebhook.controller.js";
import { whatsappInboundSchemas } from "../validators/whatsappInbound.validator.js";

const router = express.Router();

router.post("/inbound", whatsappWebhookAuth, validate(whatsappInboundSchemas.ingest), ingestInboundWhatsAppHandler);

export default router;
