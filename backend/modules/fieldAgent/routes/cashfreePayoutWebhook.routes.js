/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/cashfreePayoutWebhook.routes.js
 *
 * FA-P4-D Step 1 — inbound Cashfree Payouts webhook. Server-to-server:
 * no user session, so it is mounted in app.js BEFORE the JSON body parser
 * and BEFORE protect(), and secured by the HMAC signature check below.
 * The body is read RAW (express.raw) because the signature covers the
 * exact bytes Cashfree sent — re-serialised JSON would not match.
 *
 * Responses: 401 bad/missing/stale signature (nothing is processed),
 * 400 unparseable body, 200 for every verified event (including ones we
 * deliberately ignore, so Cashfree does not retry them), 500 only when
 * processing itself failed so Cashfree retries.
 */

import express from "express";
import { verifyWebhookSignature } from "../../../services/settlement/cashfree/cashfreePayoutClient.js";
import { handlePayoutWebhookEvent } from "../services/fieldAgentAutoPayout.service.js";
import logger from "../../../utils/logger.js";

const router = express.Router();

router.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");

  const valid = verifyWebhookSignature({
    rawBody,
    signature: req.get("x-webhook-signature"),
    timestamp: req.get("x-webhook-timestamp"),
  });
  if (!valid) {
    logger.warn("[CashfreePayoutWebhook] rejected — invalid or stale signature");
    return res.status(401).json({ success: false, message: "Invalid webhook signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false, message: "Malformed webhook body" });
  }

  try {
    const outcome = await handlePayoutWebhookEvent(payload);
    return res.status(200).json({ success: true, handled: !!outcome?.handled });
  } catch (err) {
    logger.error("[CashfreePayoutWebhook] processing failed", { message: err.message });
    return res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

export default router;
