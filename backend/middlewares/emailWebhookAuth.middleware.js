/**
 * BARBER ENGINE V1
 * backend/middlewares/emailWebhookAuth.middleware.js
 *
 * Phase H Step 9 — Email Support (inbound). Shared-secret verification
 * for the dev/test inbound-email adapter — the SAME timing-safe
 * comparison pattern already used by adminAuth.controller.js's own
 * adminKey check (crypto.timingSafeEqual, length-checked first so a
 * mismatched length never throws instead of cleanly rejecting).
 *
 * A future real-provider adapter (SendGrid Inbound Parse / Mailgun
 * Routes / etc.) would use THAT provider's own signature scheme
 * instead — this specific middleware is scoped to the dev adapter
 * only, never assumed to be the final production mechanism. Nothing
 * about the request is trusted before this check runs: no parsing, no
 * DB access, happens first in the route's middleware chain.
 */

import crypto from "crypto";
import { Errors } from "../utils/response.js";

const HEADER_NAME = "x-support-webhook-secret";

export const emailWebhookAuth = (req, res, next) => {
  const expectedSecret = process.env.EMAIL_INBOUND_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return next(Errors.internal("Inbound email webhook is not configured"));
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
