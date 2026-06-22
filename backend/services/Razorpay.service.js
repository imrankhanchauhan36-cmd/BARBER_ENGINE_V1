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