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
// FINANCE-P0-1 — canonical PayoutRequest's own dispatch counterpart.
// Tried only as a fallback (see below) when the event's reference_id
// doesn't resolve to a GenericPayoutRequest — see that file's own
// header for why the reference_id prefix is safely shared between the
// two models and disambiguated by _id, not by the prefix label.
import { handlePayoutRequestWebhookEvent } from "../../../services/settlement/payoutRequestDispatch.service.js";
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
    let result = await handleGenericPayoutWebhookEvent(payload);
    // FINANCE-P0-1 — GenericPayoutRequest.js is untouched (ACQUISITION_AGENT/
    // TERRITORY_PARTNER payouts still resolve there, unaffected). Only
    // when this exact event's underlying payout _id is NOT a
    // GenericPayoutRequest (reason UNKNOWN_PAYOUT) do we try the
    // canonical PayoutRequest counterpart — never both, never a double
    // transition, since they key off the same real _id.
    if (!result.handled && result.reason === "UNKNOWN_PAYOUT") {
      result = await handlePayoutRequestWebhookEvent(payload);
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error("[GenericPayoutWebhook] processing failed", { message: err.message });
    return res.status(500).json({ success: false, message: "Processing failed" });
  }
});

export default router;
