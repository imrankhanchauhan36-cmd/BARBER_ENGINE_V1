/**
 * BARBER ENGINE V1
 * backend/modules/payout/routes/genericPayoutWebhook.routes.js
 *
 * STEP 6.4 — inbound Razorpay Route (Payouts) webhook. Server-to-server:
 * no user session, so it is mounted in app.js BEFORE the JSON body
 * parser and BEFORE protect(), and secured by the HMAC signature check
 * below — mirrors modules/fieldAgent/routes/cashfreePayoutWebhook.routes.js's
 * own mounting pattern exactly. The body is read RAW (express.raw)
 * because the signature covers the exact bytes Razorpay sent —
 * re-serialised JSON would not match.
 *
 * Responses: 401 bad/missing signature (nothing is processed), 400
 * unparseable body, 200 for every verified event (including ones this
 * module deliberately ignores, so Razorpay does not retry them), 500
 * only when processing itself failed so Razorpay retries.
 */

import express from "express";
import { verifyWebhookSignature } from "../../../services/settlement/razorpayx/razorpayxPayoutClient.js";
import { handleGenericPayoutWebhookEvent } from "../services/genericPayoutDispatch.service.js";
import logger from "../../../utils/logger.js";

const router = express.Router();

router.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");

  const valid = verifyWebhookSignature({
    rawBody,
    signature: req.get("x-razorpay-signature"),
  });
  if (!valid) {
    logger.warn("[GenericPayoutWebhook] rejected — invalid or missing signature");
    return res.status(401).json({ success: false, message: "Invalid webhook signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false, message: "Malformed JSON body" });
  }

  try {
    const result = await handleGenericPayoutWebhookEvent(payload);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error("[GenericPayoutWebhook] processing failed", { message: err.message });
    return res.status(500).json({ success: false, message: "Processing failed" });
  }
});

export default router;
