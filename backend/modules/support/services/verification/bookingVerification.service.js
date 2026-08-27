/**
 * BARBER ENGINE V1
 * backend/modules/support/services/verification/bookingVerification.service.js
 *
 * Phase H Step 5 (H.2b) — the Booking domain's read-only verification
 * adapter. Reads the authoritative Booking (+ its linked Transaction,
 * via BookingReadService.js from H.2a) and reports verified facts.
 *
 * This file NEVER decides whether a refund is owed — that judgment
 * belongs to paymentVerification.service.js, which composes on top of
 * resolveBookingContext() below rather than duplicating the booking
 * lookup + ownership check. Kept this way per the approved H.2 design:
 * "the two adapters compose rather than re-implement each other."
 *
 * Zero writes. Zero mutation. No req/res. No client-supplied booking
 * id is ever accepted — the only input is the ticket's own
 * relatedBookingRef, already ownership-verified once at ticket
 * creation (resolveRelatedReferences(), supportTicket.service.js).
 */

import { REQUESTER_TYPE } from "../../constants/support.constants.js";
import { getBookingWithTransaction } from "../../../../services/BookingReadService.js";

/**
 * Shared booking-resolution + ownership re-check, reused by both this
 * file's own resolveBookingVerification() and by
 * paymentVerification.service.js.
 *
 * Ownership is re-derived fresh here (defense in depth — never just
 * trusts the creation-time check alone) ONLY for requesterType USER,
 * where Booking.userRef is directly comparable to the ticket's own
 * requesterRef and BookingReadService.js already returns it, at zero
 * extra query cost. For requesterType SALON_OWNER, the booking's
 * userRef is the CUSTOMER who booked — not the owner — so no direct
 * field comparison is possible without an additional Salon lookup
 * that is out of scope for H.2b (disclosed in the H.2b final report,
 * not silently skipped). The SALON_OWNER case still relies on the
 * creation-time ownership verification, exactly as Step 5 of the H.2b
 * instructions frames relatedBookingRef: "already ownership-verified."
 *
 * @returns {Promise<{ok:true, booking:object} | {ok:false, state:string, reason:string}>}
 */
export async function resolveBookingContext({ ticket, actor }) {
  if (!ticket?.relatedBookingRef) {
    return { ok: false, state: "CANNOT_VERIFY", reason: "BOOKING_REFERENCE_MISSING" };
  }

  const booking = await getBookingWithTransaction(String(ticket.relatedBookingRef));
  if (!booking) {
    return { ok: false, state: "CANNOT_VERIFY", reason: "BOOKING_NOT_FOUND" };
  }

  if (ticket.requesterType === REQUESTER_TYPE.USER) {
    const ownerId = booking.user ? String(booking.user.id) : null;
    if (!ownerId || ownerId !== String(ticket.requesterRef)) {
      return { ok: false, state: "CANNOT_VERIFY", reason: "OWNERSHIP_MISMATCH" };
    }
  }
  // requesterType SALON_OWNER: see function comment above.

  return { ok: true, booking };
}

/**
 * The Booking-domain public resolver. Returns verified facts only —
 * never a refund/action decision (Step 7 of the H.2b instructions).
 *
 * @returns {Promise<{state, domain, reason, entity, facts, allowedActions}>}
 */
export async function resolveBookingVerification({ ticket, actor }) {
  const context = await resolveBookingContext({ ticket, actor });

  if (!context.ok) {
    return {
      state: context.state,
      domain: "BOOKING",
      reason: context.reason,
      entity: null,
      facts: null,
      allowedActions: [],
    };
  }

  const { booking } = context;

  return {
    state: "VERIFIED_NO_ACTION_ALLOWED",
    domain: "BOOKING",
    reason: "BOOKING_VERIFIED",
    entity: { type: "Booking", id: booking.id },
    facts: {
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      cancelReason: booking.cancelReason,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      salon: booking.salon ? { id: booking.salon.id, shopName: booking.salon.shopName } : null,
      services: booking.services.map((s) => ({ id: s.id, name: s.name })),
      hasLinkedTransaction: !!booking.transaction,
    },
    allowedActions: [],
  };
}
