import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

import crypto from "crypto";
import Razorpay from "razorpay";

//////////////////////////////////////////////////////////////
// STARTUP VALIDATION
// Fail fast if credentials are missing — catches bad deploys
// immediately instead of failing silently on the first request.
//////////////////////////////////////////////////////////////

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("Razorpay credentials missing — check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env");
}

//////////////////////////////////////////////////////////////
// RAZORPAY CLIENT INSTANCE
//////////////////////////////////////////////////////////////

export const razorpayInstance = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

//////////////////////////////////////////////////////////////
// CREATE ORDER
// amount must be passed in PAISE (smallest currency unit)
//////////////////////////////////////////////////////////////

export const createRazorpayOrder = async ({ amountInPaise, receipt, notes = {} }) => {
  const order = await razorpayInstance.orders.create({
    amount:   amountInPaise,
    currency: "INR",
    receipt,
    notes,
  });
  return order;
};

//////////////////////////////////////////////////////////////
// VERIFY PAYMENT SIGNATURE
// Razorpay signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
//////////////////////////////////////////////////////////////

export const verifyRazorpaySignature = ({ orderId, paymentId, signature }) => {
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature);
  const givenBuffer     = Buffer.from(signature || "");

  // timingSafeEqual throws if buffer lengths differ, so guard first
  if (expectedBuffer.length !== givenBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, givenBuffer);
};

//////////////////////////////////////////////////////////////
// FETCH PAYMENT STATUS (for getPaymentStatus / admin debug)
//////////////////////////////////////////////////////////////

export const fetchRazorpayPayment = async (paymentId) => {
  return razorpayInstance.payments.fetch(paymentId);
};

//////////////////////////////////////////////////////////////
// P0-A — BOOKING PAYMENT VERIFICATION HELPERS
//////////////////////////////////////////////////////////////

export const getRazorpayKeyId = () => process.env.RAZORPAY_KEY_ID;

// Fetch one order (status: created | attempted | paid; amount; notes).
export const fetchRazorpayOrder = async (orderId) => {
  return razorpayInstance.orders.fetch(orderId);
};

// Razorpay SDK errors carry the HTTP status on `statusCode`.
export const isRazorpayNotFound = (err) =>
  err?.statusCode === 400 || err?.statusCode === 404;

/**
 * Pure check of a payment fetched from Razorpay against what THIS server
 * expects. A valid HMAC only proves Razorpay signed "order|payment"; it says
 * nothing about which booking the order was for, how much was paid, or
 * whether the money was actually captured.
 *
 * @returns {{ok:true}|{ok:false, code:string, message:string}}
 */
export const evaluateCapturedPayment = ({ payment, orderId, paymentId, amountInPaise }) => {
  if (!payment || payment.id !== paymentId) {
    return { ok: false, code: "PAYMENT_MISMATCH", message: "Payment record does not match the submitted payment id" };
  }
  if (payment.order_id !== orderId) {
    return { ok: false, code: "ORDER_MISMATCH", message: "Payment was not made against this order" };
  }
  if (payment.currency !== "INR") {
    return { ok: false, code: "CURRENCY_MISMATCH", message: "Payment currency is not INR" };
  }
  if (payment.amount !== amountInPaise) {
    return { ok: false, code: "AMOUNT_MISMATCH", message: "Paid amount does not match the booking amount" };
  }
  if (payment.status !== "captured") {
    return { ok: false, code: "NOT_CAPTURED", message: `Payment is not captured (status: ${payment.status})` };
  }
  if ((payment.amount_refunded || 0) > 0) {
    return { ok: false, code: "PAYMENT_REFUNDED", message: "Payment has been refunded" };
  }
  return { ok: true };
};

/**
 * Fetches the payment and evaluates it. Right after checkout a payment can
 * still read "authorized" for a moment while auto-capture completes, so an
 * "authorized" payment is re-fetched a few times before being rejected.
 */
export const fetchAndEvaluateCapturedPayment = async ({ orderId, paymentId, amountInPaise, retries = 3, delayMs = 800 }) => {
  let payment;
  let verdict;
  for (let attempt = 0; attempt <= retries; attempt++) {
    payment = await fetchRazorpayPayment(paymentId);
    verdict = evaluateCapturedPayment({ payment, orderId, paymentId, amountInPaise });
    if (verdict.ok || verdict.code !== "NOT_CAPTURED" || payment?.status !== "authorized") break;
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { verdict, payment };
};


//////////////////////////////////////////////////////////////
// P0-B — WEBHOOK SIGNATURE + REFUNDS
//////////////////////////////////////////////////////////////

export const isRazorpayWebhookConfigured = () => !!process.env.RAZORPAY_WEBHOOK_SECRET;

/**
 * Razorpay webhook signature = hex HMAC-SHA256(rawBody, webhookSecret), sent in
 * X-Razorpay-Signature. The secret is the one set on the webhook in the Razorpay
 * dashboard (RAZORPAY_WEBHOOK_SECRET) — NOT the API key secret. `rawBody` must be
 * the exact bytes received. Constant-time compare.
 */
export const verifyRazorpayWebhookSignature = ({ rawBody, signature }) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || rawBody === undefined || rawBody === null) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : String(rawBody))
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const fetchRazorpayRefunds = async (paymentId) => {
  const res = await razorpayInstance.payments.fetchMultipleRefund(paymentId);
  return res?.items || [];
};

export const createRazorpayRefund = async ({ paymentId, amountInPaise, notes = {}, receipt }) => {
  return razorpayInstance.payments.refund(paymentId, {
    amount: amountInPaise,
    speed:  "normal",
    notes,
    ...(receipt ? { receipt } : {}),
  });
};
