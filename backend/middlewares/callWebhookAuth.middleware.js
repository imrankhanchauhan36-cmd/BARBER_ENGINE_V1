/**
 * BARBER ENGINE V1
 * backend/middlewares/callWebhookAuth.middleware.js
 *
 * Phase H — Call Support (inbound). Shared-secret verification for the
 * dev/test inbound-call adapter — the SAME timing-safe comparison
 * pattern already used by emailWebhookAuth.middleware.js and
 * whatsappWebhookAuth.middleware.js: crypto.timingSafeEqual,
 * length-checked first so a mismatched length never throws instead of
 * cleanly rejecting.
 *
 * Deliberately its OWN secret/header — not a reuse of Email's or
 * WhatsApp's, and NOT the generic authenticated idempotency.middleware.js
 * (which is keyed by {userId}:Idempotency-Key and requires a logged-in
 * user — structurally wrong for a public provider webhook with no user
 * session at all). A future real telephony provider's own signature
 * scheme would replace this, not extend it — this middleware is scoped
 * to the dev adapter only, never assumed to be the final production
 * mechanism, exactly matching the Email/WhatsApp precedent. Nothing
 * about the request is trusted before this check runs.
 */

import crypto from "crypto";
import { Errors } from "../utils/response.js";

const HEADER_NAME = "x-support-call-webhook-secret";

export const callWebhookAuth = (req, res, next) => {
  const expectedSecret = process.env.CALL_INBOUND_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return next(Errors.internal("Inbound call webhook is not configured"));
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
