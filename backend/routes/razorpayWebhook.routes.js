/**
 * BARBER ENGINE V1
 * backend/routes/razorpayWebhook.routes.js
 *
 * RAZORPAY P0-B — inbound Razorpay webhook. Server-to-server: no user session,
 * so it is mounted in app.js BEFORE the JSON body parser and BEFORE protect(),
 * and secured by the HMAC check below. The body is read RAW because the
 * signature covers the exact bytes Razorpay sent.
 *
 * 503 not configured (fails closed) · 401 bad/missing signature · 400 unparseable
 * · 200 processed / ignored / duplicate · 503 duplicate still in flight and 500
 * processing error (both make Razorpay retry).
 */

import crypto from "crypto";
import express from "express";
import { isRazorpayWebhookConfigured, verifyRazorpayWebhookSignature } from "../services/Razorpay.service.js";
import { processRazorpayWebhook } from "../services/razorpayWebhook.service.js";
import logger from "../utils/logger.js";

const router = express.Router();

router.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  if (!isRazorpayWebhookConfigured()) {
    logger.error("[RazorpayWebhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook");
    return res.status(503).json({ success: false, message: "Webhook not configured" });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");
  if (!verifyRazorpayWebhookSignature({ rawBody, signature: req.get("x-razorpay-signature") })) {
    logger.warn("[RazorpayWebhook] rejected — invalid or missing signature");
    return res.status(401).json({ success: false, message: "Invalid webhook signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false, message: "Malformed webhook body" });
  }

  // X-Razorpay-Event-Id is stable across Razorpay's retries of one event; fall back
  // to a body hash (identical for a byte-identical redelivery).
  const eventId = req.get("x-razorpay-event-id") || `body:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;

  try {
    const { httpStatus, body } = await processRazorpayWebhook({ payload, eventId, app: req.app });
    return res.status(httpStatus).json(body);
  } catch (err) {
    logger.error("[RazorpayWebhook] unexpected error", { message: err.message });
    return res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

export default router;
