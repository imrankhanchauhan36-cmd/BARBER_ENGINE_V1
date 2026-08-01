//////////////////////////////////////////////////////////////
// 🔥 CANCELLATION POLICY SERVICE — single source of truth for
// booking cancellation refund policy.
//
// PURE CALCULATION ONLY — no database writes, no wallet updates,
// no booking saves, no notifications, no side effects of any
// kind. Callers (currently: cancelBooking in booking.controller.js)
// remain responsible for executing the workflow using the values
// this returns — session handling, wallet adjustments, status
// transition, cache invalidation, socket emit, notification, and
// the HTTP response are all unchanged and untouched by this module.
//
// Extracted verbatim from booking.controller.js's cancelBooking —
// same 120/30-minute thresholds, same refund fractions, same
// proportional service/commission split. No behavior change.
//
// Refund % is applied identically to BOTH components (service +
// commission) — the user gets back the same fraction of each, not
// a blended figure derived from the combined total. This is what
// makes the 3-way split exact: user gets refundFraction of
// (service+commission), salon keeps (1-refundFraction) of service,
// platform keeps (1-refundFraction) of commission.
//////////////////////////////////////////////////////////////

import { BOOKING_STATUS } from "../utils/bookingState.machine.js";

const CancellationPolicyService = {
  /**
   * Evaluates the cancellation refund policy for a booking at a
   * given point in time. Pure function — no I/O, no mutation.
   * @param {object} params
   * @param {object} params.booking — booking document/lean object
   *   with status, startTime, totalAmountInPaise, serviceAmountInPaise,
   *   commissionAmountInPaise.
   * @param {Date} params.now — current time (injected, not read
   *   internally, so this stays a pure function).
   * @returns {{
   *   refundPolicy: "NO_PAYMENT"|"FULL_REFUND"|"HALF_REFUND"|"NO_REFUND",
   *   refundFraction: number,
   *   serviceRefundPaise: number,
   *   commissionRefundPaise: number,
   *   refundPaise: number,
   *   penaltyPaise: number,
   * }}
   */
  evaluate: ({ booking, now }) => {
    const startTime  = new Date(booking.startTime);
    const minsUntil  = (startTime - now) / (1000 * 60);
    const totalPaise = booking.totalAmountInPaise || 0;

    let refundFraction = 0;
    let refundPolicy   = "";

    if (booking.status === BOOKING_STATUS.HOLD) {
      // HOLD — no payment captured yet, no refund needed
      refundFraction = 0;
      refundPolicy   = "NO_PAYMENT";
    } else if (minsUntil >= 120) {
      // 2+ hours before → 100% refund
      refundFraction = 1;
      refundPolicy   = "FULL_REFUND";
    } else if (minsUntil >= 30) {
      // 30min - 2hr before → 50% refund
      refundFraction = 0.5;
      refundPolicy   = "HALF_REFUND";
    } else {
      // Less than 30 min → 0% refund
      refundFraction = 0;
      refundPolicy   = "NO_REFUND";
    }

    // Split refund proportionally across service + commission —
    // stored per-booking amounts (locked in at lockSlot time), not
    // re-derived from the current commission rate.
    const serviceRefundPaise    = Math.round((booking.serviceAmountInPaise || 0) * refundFraction);
    const commissionRefundPaise = Math.round((booking.commissionAmountInPaise || 0) * refundFraction);
    const refundPaise           = serviceRefundPaise + commissionRefundPaise;
    const penaltyPaise          = totalPaise - refundPaise;

    return {
      refundPolicy,
      refundFraction,
      serviceRefundPaise,
      commissionRefundPaise,
      refundPaise,
      penaltyPaise,
    };
  },
};

export default Object.freeze(CancellationPolicyService);
