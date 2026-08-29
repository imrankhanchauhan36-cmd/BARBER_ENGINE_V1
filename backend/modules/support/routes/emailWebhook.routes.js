/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/emailWebhook.routes.js
 *
 * Phase H Step 9 — Email Support (inbound). Deliberately NOT behind
 * `protect` — this is an unauthenticated provider/dev-adapter callback
 * (an inbound webhook has no user session to verify), secured instead
 * by emailWebhookAuth's own shared-secret check. Mounted alongside the
 * other pre-protect public routes in app.js (/api/support/auth,
 * /api/auth), not under the generic /api/support/admin or
 * /api/support/customer prefixes, which both require protect.
 */

import express from "express";
import { emailWebhookAuth } from "../../../middlewares/emailWebhookAuth.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { ingestInboundEmailHandler } from "../controllers/emailWebhook.controller.js";
import { emailInboundSchemas } from "../validators/emailInbound.validator.js";

const router = express.Router();

router.post("/inbound", emailWebhookAuth, validate(emailInboundSchemas.ingest), ingestInboundEmailHandler);

export default router;
