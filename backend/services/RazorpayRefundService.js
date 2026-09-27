/**
 * BARBER ENGINE V1
 * backend/services/RazorpayRefundService.js
 *
 * RAZORPAY P0-C — the refund engine: refunds a captured Razorpay payment back
 * to its original payment source, fully or partially, with a persistent
 * Refund record, gateway refundId/status, webhook completion and automatic
 * booking/transaction updates.
 *
 *   issueRazorpayRefund   create (or replay) one refund — idempotent by key
 *   completeRefund        mark a refund PROCESSED/FAILED from gateway data
 *                         (refund.processed / refund.failed webhooks, or an
 *                         immediate "processed" answer) and apply the effects
 *   recordExternalRefund  a refund made outside this system (Razorpay dashboard)
 *   issueSourceRefundForCancelledBooking
 *                         the existing cancellation refund (policy amount,
 *                         salon PENDING clawback) executed to the ORIGINAL
 *                         payment source instead of the in-app wallet
 *
 * Duplicate protection, in layers:
 *   1. unique Refund.idempotencyKey (same request → same refund)
 *   2. a per-payment lock so two different requests cannot both read the same
 *      refundable balance
 *   3. refundable balance = payment.amount − max(gateway amount_refunded, our
 *      own non-failed refunds) — never more than what is left
 *   4. before creating at the gateway, existing gateway refunds are matched by
 *      our refundRef note, so a crash between "gateway call" and "save" adopts
 *      the refund instead of repeating it
 *
 * Never touches WalletLedger / WalletBalanceService except through the
 * unchanged existing cancellation clawback call in
 * issueSourceRefundForCancelledBooking.
 *
 * P0 Revenue Calculation Engine — Step 4.2 (GST Reversal Engine) — the
 * ONLY integration point, per that step's own instruction: inside
 * completeRefund(), once (and only once) a refund reaches PROCESSED,
 * find the RevenueSplit for its booking and create a proportional
 * REFUND_REVERSAL GST ledger row. Isolated in its own try/catch, same
 * non-blocking discipline as RevenueSplitIntegrationService.js — a GST
 * ledger failure can never affect this file's own refund
 * math/status/Transaction/Booking updates, all of which are computed and
 * committed first, completely unchanged.
 */

import mongoose from "mongoose";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import Refund, { REFUND_STATUS, REFUND_REASON } from "../models/Refund.js";
import WalletTransaction, { WALLET_TXN_TYPE, WALLET_TXN_DIRECTION, WALLET_TXN_STATUS } from "../models/WalletTransaction.js";
import WebhookEvent, { WEBHOOK_PROVIDER, WEBHOOK_EVENT_KIND, WEBHOOK_EVENT_STATUS } from "../models/WebhookEvent.js";
import WalletBalanceService from "./WalletBalanceService.js";
import { splitRefundComponents, REFUND_FRACTION_BY_POLICY } from "./refundComponentSplitter.js";
import { createRazorpayRefund, fetchRazorpayPayment, fetchRazorpayRefunds, isRazorpayNotFound } from "./Razorpay.service.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import { createRefundReversalLedger } from "../modules/finance/services/GSTLedgerService.js";
import { createTerritoryRevenueReversal } from "../modules/finance/services/TerritoryRevenueService.js"; // STEP 5.3 — Territory Revenue Distribution Engine
import logger from "../utils/logger.js";

const LOCK_LEASE_MS = 60 * 1000;
const err = (message, status, code) => Object.assign(new Error(message), { status, code });

export const mapGatewayRefundStatus = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "processed") return REFUND_STATUS.PROCESSED;
  if (v === "failed") return REFUND_STATUS.FAILED;
  return REFUND_STATUS.PENDING;
};

// ─── once-at-a-time lock (payment- or booking-scoped) ───────────────
export const withRefundLock = async (lockKey, fn) => {
  const eventId = `ACTION:${lockKey}`;
  let held = false;
  try {
    await WebhookEvent.create({ provider: WEBHOOK_PROVIDER.RAZORPAY, kind: WEBHOOK_EVENT_KIND.ACTION, eventId, eventType: "refund_lock", status: WEBHOOK_EVENT_STATUS.PROCESSING, lockedAt: new Date() });
    held = true;
  } catch (e) {
    if (e?.code !== 11000) throw e;
    const took = await WebhookEvent.findOneAndUpdate(
      { provider: WEBHOOK_PROVIDER.RAZORPAY, eventId, lockedAt: { $lt: new Date(Date.now() - LOCK_LEASE_MS) } },
      { $set: { lockedAt: new Date() } }
    );
    if (!took) throw err("Another refund for this payment/booking is in progress — retry shortly", 409, "REFUND_IN_PROGRESS");
    held = true;
  }
  try {
    return await fn();
  } finally {
    if (held) await WebhookEvent.deleteOne({ provider: WEBHOOK_PROVIDER.RAZORPAY, eventId }).catch(() => {});
  }
};
const withPaymentLock = (paymentId, fn) => withRefundLock(`refund-lock:${paymentId}`, fn);

/**
 * Has this booking ALREADY been refunded to the customer's in-app wallet?
 * (The wallet refund row is the record the existing cancellation flow writes.)
 */
export const findWalletRefundForBooking = (bookingId) =>
  WalletTransaction.findOne({
    bookingId,
    type: WALLET_TXN_TYPE.REFUND,
    direction: WALLET_TXN_DIRECTION.CREDIT,
    status: WALLET_TXN_STATUS.SUCCESS,
  });

/** A live (PENDING/PROCESSED) source refund issued through the cancellation flow for this booking. */
export const findSourceRefundForBooking = (bookingId) =>
  Refund.findOne({ idempotencyKey: `booking-refund:${bookingId}`, refundStatus: { $in: [REFUND_STATUS.PENDING, REFUND_STATUS.PROCESSED] } });

// ─── effects of a PROCESSED refund ─────────────────────────────────
/**
 * Idempotent recompute from the Refund records (called after every state change):
 *  - Transaction.refundAmount = everything accepted by the gateway so far
 *    (PENDING + PROCESSED); a FAILED refund drops out again.
 *  - Transaction.status = REFUNDED and Booking.paymentStatus = REFUNDED only when
 *    PROCESSED refunds cover the whole payment (and the booking is not validly paid
 *    by a DIFFERENT payment).
 */
export const applyRefundEffects = async (paymentId) => {
  const live = await Refund.find({ paymentId, refundStatus: { $in: [REFUND_STATUS.PENDING, REFUND_STATUS.PROCESSED] } }).lean();
  const total = live.reduce((s, r) => s + r.amountInPaise, 0);
  const processedTotal = live.filter((r) => r.refundStatus === REFUND_STATUS.PROCESSED).reduce((s, r) => s + r.amountInPaise, 0);
  const paymentAmount = live.length ? Math.max(...live.map((r) => r.paymentAmountInPaise)) : 0;
  const fullyRefunded = live.length > 0 && processedTotal >= paymentAmount;
  const last = live[live.length - 1];

  await Transaction.updateOne(
    { paymentId },
    { $set: { refundAmount: total, refundedAt: total > 0 ? new Date() : null, refundReason: total > 0 ? (last?.reason || null) : null, ...(fullyRefunded ? { status: "REFUNDED" } : {}) } }
  );

  if (fullyRefunded) {
    const bookingId = live.find((r) => r.bookingId)?.bookingId;
    if (bookingId) {
      const paidByOther = await Transaction.exists({ bookingId, paymentId: { $ne: paymentId }, status: "PAID" });
      if (!paidByOther) await Booking.updateOne({ _id: bookingId }, { $set: { paymentStatus: "REFUNDED" } });
    }
  }
  return { total, processedTotal, fullyRefunded };
};

/** Complete a Refund from gateway data. Idempotent. */
export const completeRefund = async ({ refundDoc, gatewayStatus, gatewayRefundId = null, failureReason = null }) => {
  const status = mapGatewayRefundStatus(gatewayStatus);
  const set = { gatewayStatus: String(gatewayStatus || "").toLowerCase() || null, refundStatus: status };
  if (gatewayRefundId) set.razorpayRefundId = gatewayRefundId;
  if (status === REFUND_STATUS.PROCESSED) set.processedAt = new Date();
  if (status === REFUND_STATUS.FAILED) set.failureReason = String(failureReason || "Refund failed at the gateway").slice(0, 500);

  // never move a PROCESSED refund backwards
  const doc = await Refund.findOneAndUpdate(
    { _id: refundDoc._id, refundStatus: { $ne: REFUND_STATUS.PROCESSED } },
    { $set: set },
    { new: true }
  );
  const current = doc || (await Refund.findById(refundDoc._id));
  await applyRefundEffects(current.paymentId); // PENDING / PROCESSED / FAILED all change what the Transaction should show

  // Step 4.2 — GST Reversal Engine. Only on a genuine PROCESSED transition
  // (never PENDING/FAILED — see createRefundReversalLedger's own PROCESSED
  // guard too, this check just avoids the lookups below on paths that can
  // never produce a reversal). Isolated so a GST-ledger failure can never
  // affect the refund's own status/Transaction/Booking updates above,
  // which have already completed by this point.
  if (status === REFUND_STATUS.PROCESSED && current.bookingId) {
    try {
      const revenueSplit = await RevenueSplit.findOne({ bookingId: current.bookingId }).lean();
      if (revenueSplit) {
        await createRefundReversalLedger({ revenueSplit, refundId: current.razorpayRefundId });
      }
    } catch (gstErr) {
      logger.error("[RazorpayRefundService] GST reversal ledger creation failed (refund itself succeeded; unaffected)", { refundId: String(current.razorpayRefundId || current._id), bookingId: String(current.bookingId), message: gstErr?.message });
    }

    // STEP 5.3 — Territory Revenue Distribution Engine. "Full refund
    // must create proportional reversal." Isolated in its own try/catch,
    // same pattern as the GST reversal block immediately above: the
    // refund's own status/Transaction/Booking updates have already
    // completed by this point and must never be affected by this. A
    // booking with no Territory Partner split (most bookings) is a safe
    // no-op inside createTerritoryRevenueReversal itself.
    try {
      const revenueSplitForTerritory = await RevenueSplit.findOne({ bookingId: current.bookingId }).lean();
      if (revenueSplitForTerritory) {
        await createTerritoryRevenueReversal({ revenueSplit: revenueSplitForTerritory, refundId: current.razorpayRefundId });
      }
    } catch (territoryErr) {
      logger.error("[RazorpayRefundService] Territory revenue reversal creation failed (refund itself succeeded; unaffected)", { refundId: String(current.razorpayRefundId || current._id), bookingId: String(current.bookingId), message: territoryErr?.message });
    }
  }

  return current;
};

// ─── the engine ─────────────────────────────────────────────────────
/**
 * @param {object} p
 * @param {string} p.paymentId
 * @param {number|null} [p.amountInPaise]  null/omitted = refund everything still refundable (FULL); otherwise PARTIAL
 * @param {string} p.idempotencyKey
 * @param {string} [p.reason]
 * @param {string|ObjectId|null} [p.bookingId]
 * @param {{type:string,id?:any}} [p.initiatedBy]
 * @returns {Promise<{refund: object, idempotent: boolean}>}
 */
export const issueRazorpayRefund = async ({ paymentId, amountInPaise = null, idempotencyKey, reason = null, bookingId = null, initiatedBy = { type: "SYSTEM" } }) => {
  if (typeof paymentId !== "string" || !paymentId.startsWith("pay_")) throw err("A Razorpay payment id is required", 400, "BAD_PAYMENT_ID");
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) throw err("idempotencyKey is required", 400, "BAD_KEY");
  if (amountInPaise !== null && (!Number.isInteger(amountInPaise) || amountInPaise <= 0)) throw err("amountInPaise must be a positive whole number of paise", 400, "BAD_AMOUNT");

  const replayable = (d) => d && [REFUND_STATUS.PENDING, REFUND_STATUS.PROCESSED].includes(d.refundStatus);
  let existing = await Refund.findOne({ idempotencyKey });
  if (replayable(existing)) return { refund: existing, idempotent: true };

  return withPaymentLock(paymentId, async () => {
    let doc = await Refund.findOne({ idempotencyKey });
    if (replayable(doc)) return { refund: doc, idempotent: true };

    let payment;
    try {
      payment = await fetchRazorpayPayment(paymentId);
    } catch (e) {
      if (isRazorpayNotFound(e)) throw err("Payment not found at the payment gateway", 400, "PAYMENT_NOT_FOUND");
      throw err("Could not reach the payment gateway to verify the payment. Retry.", 502, "GATEWAY_UNAVAILABLE");
    }
    if (!["captured", "refunded"].includes(payment.status)) throw err(`Payment is not refundable (status: ${payment.status})`, 409, "NOT_REFUNDABLE");

    const ours = await Refund.aggregate([
      { $match: { paymentId, refundStatus: { $ne: REFUND_STATUS.FAILED }, ...(doc ? { _id: { $ne: doc._id } } : {}) } },
      { $group: { _id: null, total: { $sum: "$amountInPaise" } } },
    ]);
    const alreadyRefunded = Math.max(payment.amount_refunded || 0, ours[0]?.total || 0);
    const refundable = payment.amount - alreadyRefunded;
    const amount = amountInPaise ?? refundable;
    if (refundable <= 0) throw err("This payment has already been fully refunded", 409, "ALREADY_FULLY_REFUNDED");
    if (amount > refundable) throw err(`Refund exceeds the refundable amount (₹${refundable / 100} left)`, 400, "EXCEEDS_REFUNDABLE");

    let resolvedBookingId = bookingId;
    if (!resolvedBookingId && payment.order_id) {
      resolvedBookingId = (await Booking.findOne({ razorpayOrderId: payment.order_id }).select("_id").lean())?._id || null;
    }

    const fields = {
      paymentId, orderId: payment.order_id || null, bookingId: resolvedBookingId,
      amountInPaise: amount, paymentAmountInPaise: payment.amount, isFull: alreadyRefunded + amount >= payment.amount,
      reason, initiatedBy, idempotencyKey,
    };
    if (doc) {
      Object.assign(doc, fields, { refundStatus: REFUND_STATUS.CREATING, failureReason: null });
      await doc.save();
    } else {
      try {
        doc = await Refund.create({ ...fields, refundStatus: REFUND_STATUS.CREATING });
      } catch (e) {
        if (e?.code === 11000) { const raced = await Refund.findOne({ idempotencyKey }); if (raced) return { refund: raced, idempotent: true }; }
        throw e;
      }
    }
    await Refund.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });

    // Adopt a gateway refund we created before a crash (matched by our refundRef note).
    let gatewayRefund = null;
    try {
      gatewayRefund = (await fetchRazorpayRefunds(paymentId)).find((r) => r?.notes?.refundRef === String(doc._id)) || null;
    } catch { /* fall through to create */ }

    if (!gatewayRefund) {
      try {
        gatewayRefund = await createRazorpayRefund({
          paymentId,
          amountInPaise: amount,
          receipt: `zr_${String(doc._id)}`,
          notes: { refundRef: String(doc._id), reason: reason || "", bookingId: String(resolvedBookingId || ""), idempotencyKey: idempotencyKey.slice(0, 80) },
        });
      } catch (e) {
        const status = e?.statusCode;
        if (status && status >= 400 && status < 500) {
          const description = e?.error?.description || e?.message || "Refund rejected by the gateway";
          await Refund.updateOne({ _id: doc._id }, { $set: { refundStatus: REFUND_STATUS.FAILED, failureReason: String(description).slice(0, 500) } });
          throw err(`Refund rejected by the payment gateway: ${description}`, 400, "REFUND_REJECTED");
        }
        // Unknown outcome (timeout / 5xx): keep CREATING; a retry with the same key adopts or re-issues safely.
        await Refund.updateOne({ _id: doc._id }, { $set: { failureReason: "Gateway outcome unknown — will be reconciled on retry" } });
        throw err("Could not confirm the refund with the payment gateway. Retry with the same request.", 502, "GATEWAY_UNAVAILABLE");
      }
    }

    const completed = await completeRefund({
      refundDoc: doc,
      gatewayStatus: gatewayRefund.status,
      gatewayRefundId: gatewayRefund.id,
    });
    return { refund: completed, idempotent: false };
  });
};

// ─── refunds made outside this system ───────────────────────────────
/** A refund seen in a webhook that we did not create (e.g. Razorpay dashboard). Idempotent by refund id. */
export const recordExternalRefund = async ({ gatewayRefund, payment }) => {
  const existing = await Refund.findOne({ razorpayRefundId: gatewayRefund.id });
  if (existing) return existing;
  const paymentAmount = payment?.amount || gatewayRefund.amount;
  const orderId = payment?.order_id || null;
  const bookingId = orderId ? (await Booking.findOne({ razorpayOrderId: orderId }).select("_id").lean())?._id || null : null;
  try {
    return await Refund.create({
      paymentId: gatewayRefund.payment_id || payment?.id, orderId, bookingId,
      amountInPaise: gatewayRefund.amount, paymentAmountInPaise: paymentAmount,
      isFull: gatewayRefund.amount >= paymentAmount,
      reason: REFUND_REASON.EXTERNAL, initiatedBy: { type: "EXTERNAL" },
      idempotencyKey: `external:${gatewayRefund.id}`, razorpayRefundId: gatewayRefund.id,
      refundStatus: mapGatewayRefundStatus(gatewayRefund.status), gatewayStatus: String(gatewayRefund.status || "").toLowerCase(),
      processedAt: gatewayRefund.status === "processed" ? new Date() : null,
    });
  } catch (e) {
    if (e?.code === 11000) return Refund.findOne({ razorpayRefundId: gatewayRefund.id });
    throw e;
  }
};

// ─── existing cancellation refund → original payment source ────────
/**
 * Same amount and the same salon PENDING clawback as
 * RefundExecutionService.issueRefundForCancelledBooking (policy fraction of
 * service + platform fee + GST; unchanged WalletBalanceService.debitPending with
 * the same idempotency key), but the customer's money goes back to the ORIGINAL
 * Razorpay payment instead of the in-app wallet.
 */
export const issueSourceRefundForCancelledBooking = async ({ bookingId, triggeredBy, triggeredById }) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err("Booking not found", 404);
  if (booking.status !== BOOKING_STATUS.CANCELLED) throw err(`A source refund requires a CANCELLED booking, got ${booking.status}`, 409);
  if (!booking.cancellationPolicy) throw err("No cancellation policy was recorded for this booking — refund amount cannot be safely determined", 409);

  const idempotencyKey = `booking-refund:${booking._id}`;
  const prior = await Refund.findOne({ idempotencyKey });
  if (prior && [REFUND_STATUS.PENDING, REFUND_STATUS.PROCESSED].includes(prior.refundStatus)) {
    return { alreadyIssued: true, refundPaise: prior.amountInPaise, walletTransactionId: null, refundId: prior.razorpayRefundId, refundStatus: prior.refundStatus };
  }

  // Never refund the same booking twice through two destinations: if the
  // customer was already refunded to their in-app wallet (the existing
  // cancellation flow, or an earlier WALLET support refund), stop here.
  const walletRefund = await findWalletRefundForBooking(booking._id);
  if (walletRefund) {
    return { alreadyIssued: true, refundPaise: walletRefund.amountInPaise, walletTransactionId: walletRefund._id, refundId: null, refundStatus: null, refundedTo: "WALLET" };
  }

  const refundFraction = REFUND_FRACTION_BY_POLICY[booking.cancellationPolicy];
  if (refundFraction === undefined) throw err(`Unrecognized cancellationPolicy: ${booking.cancellationPolicy}`, 500);
  const { serviceRefundPaise, totalRefundPaise: refundPaise } = splitRefundComponents({
    refundFraction,
    serviceAmountInPaise: booking.serviceAmountInPaise,
    commissionAmountInPaise: booking.commissionAmountInPaise,
    gstAmountInPaise: booking.gstAmountInPaise,
  });
  if (booking.refundAmountInPaise != null && booking.refundAmountInPaise !== refundPaise) {
    throw err(`Computed refund (${refundPaise} paise) does not match the amount recorded at cancellation time (${booking.refundAmountInPaise} paise) — refusing to execute an inconsistent refund`, 409);
  }
  if (refundPaise <= 0) return { alreadyIssued: false, refundPaise: 0, walletTransactionId: null, refundId: null, refundStatus: null };

  const txn = await Transaction.findOne({ bookingId: booking._id, status: { $in: ["PAID", "REFUNDED"] } }).lean();
  if (!txn?.paymentId || String(txn.paymentId).startsWith("wallet_")) {
    throw err("This booking was not paid through Razorpay — there is no original payment to refund", 409, "NOT_RAZORPAY_PAID");
  }

  // Salon side: the existing, unchanged clawback (idempotent by key).
  if (serviceRefundPaise > 0) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await WalletBalanceService.debitPending({
        salonId: booking.salonRef,
        amountInPaise: serviceRefundPaise,
        action: "REFUND",
        refType: "BOOKING",
        refId: booking._id,
        idempotencyKey: `booking:refund:${booking._id}`,
        session,
        triggeredBy,
        triggeredById,
        remarks: "Post-cancellation refund to original payment source",
      });
      await session.commitTransaction();
    } catch (e) {
      if (session.inTransaction()) await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }

  const { refund } = await issueRazorpayRefund({
    paymentId: txn.paymentId,
    amountInPaise: refundPaise,
    reason: REFUND_REASON.BOOKING_CANCELLED,
    bookingId: booking._id,
    initiatedBy: { type: triggeredBy === "ADMIN" ? "ADMIN" : "SYSTEM", id: triggeredById || null },
    idempotencyKey,
  });
  return { alreadyIssued: false, refundPaise, walletTransactionId: null, refundId: refund.razorpayRefundId, refundStatus: refund.refundStatus };
};
