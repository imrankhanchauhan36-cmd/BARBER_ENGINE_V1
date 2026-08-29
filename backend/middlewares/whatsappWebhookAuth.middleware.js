/**
 * BARBER ENGINE V1
 * backend/middlewares/whatsappWebhookAuth.middleware.js
 *
 * Phase H — WhatsApp Support (inbound). Shared-secret verification for
 * the dev/test inbound-WhatsApp adapter — the SAME timing-safe
 * comparison pattern already used by emailWebhookAuth.middleware.js
 * (and, before that, adminAuth.controller.js's own adminKey check):
 * crypto.timingSafeEqual, length-checked first so a mismatched length
 * never throws instead of cleanly rejecting.
 *
 * Deliberately its OWN secret/header, not a reuse of Email's — a
 * different transport, a different trust boundary. A future real
 * WhatsApp Business provider (Meta Cloud API) requires a structurally
 * different scheme (an X-Hub-Signature-256 HMAC over the raw body,
 * plus a separate GET verification handshake for webhook
 * registration) — this middleware is scoped to the dev adapter only,
 * never assumed to be the final production mechanism, exactly
 * matching emailWebhookAuth.middleware.js's own scoping. Nothing about
 * the request is trusted before this check runs: no parsing, no DB
 * access, happens first in the route's middleware chain.
 */

import crypto from "crypto";
import { Errors } from "../utils/response.js";

const HEADER_NAME = "x-support-whatsapp-webhook-secret";

export const whatsappWebhookAuth = (req, res, next) => {
  const expectedSecret = process.env.WHATSAPP_INBOUND_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return next(Errors.internal("Inbound WhatsApp webhook is not configured"));
  }

  const providedSecret = req.headers[HEADER_NAME];
  if (!providedSecret) {
    return next(Errors.unauthorized("Missing webhook secret"));
  }

  const providedBuffer = Buffer.from(String(providedSecret));
  const expectedBuffer = Buffer.from(expectedSecret);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return next(Errors.unauthorized("Invalid webhook secret"));
  }

  next();
};
