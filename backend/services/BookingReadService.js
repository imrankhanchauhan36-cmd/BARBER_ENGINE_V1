/**
 * BARBER ENGINE V1
 * backend/services/BookingReadService.js
 *
 * Phase H Step 4 (H.2a) — a pure, read-only extraction of the exact
 * field-shaping logic already proven safe in
 * controllers/adminBooking.controller.js's getBookingDetail handler.
 * That controller is left completely untouched (its own header marks
 * it "10/10 FROZEN", it has exactly one caller in routes/admin.routes.js)
 * — this file duplicates its query/shaping logic deliberately rather
 * than importing from it, matching the same decision made for
 * TransactionReadService.js.
 *
 * The linked Transaction is resolved via the one relationship that
 * actually exists — Transaction.bookingId → Booking._id (confirmed in
 * Phase H Step 2; Booking itself has no transactionRef field, and none
 * is invented here). No admin geo-scope check lives here — that stays
 * at the caller boundary, same as TransactionReadService.js.
 */

import Booking from "../models/Booking.js";
import { getTransactionByBookingId } from "./TransactionReadService.js";

/**
 * Returns the same shape adminBooking.controller.js's getBookingDetail
 * has always returned (id/status/paymentStatus/amounts/user/salon/
 * chair/services/cancelledBy/transaction/timeline/statusHistory/
 * timestamps) — this is a faithful, complete extraction, not a
 * Support-specific subset. Which fields a future Verification
 * Resolver actually surfaces to an agent is an H.2b/H.3 decision, not
 * this file's.
 *
 * @param {string} bookingId
 * @returns {Promise<object|null>} null if the id is invalid, the
 *   booking doesn't exist, or it is soft-deleted
 */
export async function getBookingWithTransaction(bookingId) {
  if (!/^[0-9a-fA-F]{24}$/.test(bookingId ?? "")) return null;

  const booking = await Booking.findOne({ _id: bookingId, isDeleted: { $ne: true } })
    .populate("userRef", "name phone email profilePhoto")
    .populate("salonRef", "basicInfo.shopName basicInfo.category location.address location.territory.stateRef location.territory.districtRef assignedAdmin")
    .populate("serviceRefs", "name price duration")
    .populate("chairRef", "name")
    .populate("cancelledBy", "name phone adminLevel")
    .populate("statusHistory.changedBy", "name adminLevel")
    .lean();

  if (!booking) return null;

  const transaction = await getTransactionByBookingId(booking._id);

  return {
    id: booking._id,
    bookingDate: booking.bookingDate ?? null,
    startTime: booking.startTime ?? null,
    endTime: booking.endTime ?? null,
    serviceDuration: booking.serviceDuration ?? null,
    bufferTime: booking.bufferTime ?? 0,
    status: booking.status ?? null,
    paymentStatus: booking.paymentStatus ?? null,
    amountRupees: Math.round((booking.totalAmountInPaise ?? 0) / 100),
    amountPaise: booking.totalAmountInPaise ?? 0,
    source: booking.source ?? null,
    rating: booking.rating ?? null,
    cancelReason: booking.cancelReason ?? null,
    // Phase H Step 7 (H.4) — additive: neither field was in the
    // original getBookingDetail() shape this file was extracted from,
    // but the Support refund-eligibility gate needs both to determine
    // whether a real, already-decided refund amount exists for an
    // already-cancelled booking, without re-deriving policy at
    // verification time (see RefundExecutionService.js's header for
    // why that would be unsafe). Both fields already existed on the
    // Booking schema untouched; this only widens what this read
    // service surfaces.
    cancellationPolicy: booking.cancellationPolicy ?? null,
    refundAmountInPaise: booking.refundAmountInPaise ?? null,

    user: booking.userRef ? {
      id: booking.userRef._id,
      name: booking.userRef.name ?? null,
      phone: booking.userRef.phone ?? null,
      email: booking.userRef.email ?? null,
      profilePhoto: booking.userRef.profilePhoto ?? null,
    } : null,

    salon: booking.salonRef ? {
      id: booking.salonRef._id,
      shopName: booking.salonRef.basicInfo?.shopName ?? null,
      category: booking.salonRef.basicInfo?.category ?? null,
      address: booking.salonRef.location?.address ?? null,
    } : null,

    chair: booking.chairRef ? {
      id: booking.chairRef._id,
      name: booking.chairRef.name ?? null,
    } : null,

    services: (booking.serviceRefs || []).map((s) => ({
      id: s._id,
      name: s.name ?? null,
      price: s.price ?? 0,
      duration: s.duration ?? 0,
    })),

    cancelledBy: booking.cancelledBy ? {
      id: booking.cancelledBy._id,
      name: booking.cancelledBy.name ?? null,
      phone: booking.cancelledBy.phone ?? null,
      adminLevel: booking.cancelledBy.adminLevel ?? null,
    } : null,

    transaction: transaction ? {
      id: transaction._id,
      amountPaise: transaction.amount ?? 0,
      amountRupees: Math.round((transaction.amount ?? 0) / 100),
      commission: transaction.commission ?? 0,
      payoutAmount: transaction.payoutAmount ?? 0,
      status: transaction.status ?? null,
      paymentId: transaction.paymentId ?? null,
      type: transaction.type ?? null,
      createdAt: transaction.createdAt ?? null,
    } : null,

    timeline: [
      { event: "BOOKING_CREATED", label: "Booking Created", time: booking.createdAt, done: true },
      { event: "CONFIRMED", label: "Payment Confirmed", time: transaction?.createdAt ?? null, done: !!transaction },
      { event: "CHECKED_IN", label: "Customer Checked In", time: booking.checkedInAt, done: !!booking.checkedInAt },
      { event: "ONGOING", label: "Service Started", time: booking.serviceStartedAt, done: !!booking.serviceStartedAt },
      { event: "COMPLETED", label: "Service Completed", time: booking.completedAt, done: !!booking.completedAt },
      { event: "CANCELLED", label: "Booking Cancelled", time: booking.cancelledAt, done: !!booking.cancelledAt },
      { event: "NO_SHOW", label: "Marked No Show", time: booking.noShowMarkedAt, done: !!booking.noShowMarkedAt },
    ].filter((t) => t.done || !["CANCELLED", "NO_SHOW"].includes(t.event)),

    statusHistory: (booking.statusHistory || []).map((h) => ({
      status: h.status ?? null,
      changedAt: h.changedAt ?? null,
      changedBy: h.changedBy ? {
        id: h.changedBy._id,
        name: h.changedBy.name ?? "System",
        adminLevel: h.changedBy.adminLevel ?? null,
      } : { name: "System" },
    })),

    createdAt: booking.createdAt ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    completedAt: booking.completedAt ?? null,
    checkedInAt: booking.checkedInAt ?? null,
    serviceStartedAt: booking.serviceStartedAt ?? null,
    noShowMarkedAt: booking.noShowMarkedAt ?? null,
  };
}
