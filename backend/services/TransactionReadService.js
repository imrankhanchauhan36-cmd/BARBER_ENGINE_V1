/**
 * BARBER ENGINE V1
 * backend/services/TransactionReadService.js
 *
 * Phase H Step 4 (H.2a) — a pure, read-only extraction of the exact
 * field-shaping logic already proven safe in
 * controllers/adminFinance.controller.js's getTransaction handler.
 * That controller is left completely untouched (its own header marks
 * it "10/10 FROZEN", it has exactly one caller in routes/admin.routes.js,
 * and refactoring it carries real regression risk for zero behavioral
 * benefit) — this file duplicates its query/shaping logic deliberately
 * rather than importing from it, so a future Support Verification
 * Resolver (H.2b, not built yet) has a clean, req/res-free, non-mutating
 * function to call.
 *
 * No admin geo-scope check lives here — that authorization concern
 * belongs to whichever caller uses this (the existing admin controller
 * has its own; a future Support resolver will apply its own ticket-
 * ownership-based check). This file only ever reads Transaction/Salon/
 * User for display purposes — it never writes anything.
 */

import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";

const toRupees = (v) => Math.round(v ?? 0) / 100;

/**
 * Returns the same field set adminFinance.controller.js's getTransaction
 * has always returned (gatewaySignature is schema-level select:false and
 * was never included; idempotencyKey was never included either — both
 * stay excluded here for the same reason).
 *
 * @param {string} transactionId
 * @returns {Promise<object|null>} null if the id is invalid or not found
 */
export async function getTransactionById(transactionId) {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) return null;

  const t = await Transaction.findById(transactionId)
    .populate("salonId", "basicInfo.shopName basicInfo.phone location.address location.territory.stateRef location.territory.districtRef")
    .populate("userId", "name phone")
    .populate("bookingId", "_id")
    .lean();

  if (!t) return null;

  return {
    id: t._id,
    type: t.type,
    status: t.status,
    provider: t.provider ?? "MANUAL",
    paymentMethod: t.paymentMethod ?? "UNKNOWN",
    currency: t.currency ?? "INR",
    amountInPaise: t.amount ?? 0,
    amountInRupees: toRupees(t.amount),
    commissionInPaise: t.commission ?? 0,
    commissionInRupees: toRupees(t.commission),
    payoutAmountInPaise: t.payoutAmount ?? 0,
    payoutAmountInRupees: toRupees(t.payoutAmount),
    gatewayFeeInPaise: t.gatewayFee ?? 0,
    refundAmountInPaise: t.refundAmount ?? 0,
    salon: {
      id: t.salonId?._id,
      name: t.salonId?.basicInfo?.shopName,
      phone: t.salonId?.basicInfo?.phone ?? null,
      address: t.salonId?.location?.address ?? null,
    },
    user: { id: t.userId?._id, name: t.userId?.name, phone: t.userId?.phone },
    booking: { id: t.bookingId?._id },
    paymentId: t.paymentId ?? null,
    orderId: t.orderId ?? null,
    source: t.source ?? "APP",
    failureReason: t.failureReason ?? null,
    refundedAt: t.refundedAt ?? null,
    refundReason: t.refundReason ?? null,
    settledAt: t.settledAt ?? null,
    gatewaySettlementId: t.gatewaySettlementId ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/**
 * The only stored link between Transaction and Booking is
 * Transaction.bookingId → Booking._id (confirmed by repo-wide grep in
 * Phase H Step 2 — Booking has no transactionRef of its own). This
 * reverse lookup is exactly what adminBooking.controller.js's
 * getBookingDetail already does inline; kept as a small separate export
 * here so BookingReadService.js doesn't need its own duplicate query.
 *
 * @param {string} bookingId
 * @returns {Promise<object|null>}
 */
export async function getTransactionByBookingId(bookingId) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return null;
  const t = await Transaction.findOne({ bookingId }).lean();
  if (!t) return null;
  return t;
}
