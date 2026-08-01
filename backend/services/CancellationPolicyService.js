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

import { BOOKING_STATUS, BOOKING_TRANSITIONS } from "../utils/bookingState.machine.js";

// Derived, not hardcoded a second time — the set of statuses from
// which CANCELLED is reachable, read directly from the state
// machine's own transition table. Stays in sync automatically if
// that table ever changes, instead of risking a second, drifting
// copy of the same rule (the exact class of duplication flagged
// elsewhere in this codebase's admin controllers).
const CANCELLABLE_STATUSES = Object.entries(BOOKING_TRANSITIONS)
  .filter(([, nextStates]) => nextStates.includes(BOOKING_STATUS.CANCELLED))
  .map(([status]) => status);

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

// Allows the existing "missing/null defaults to 0" behavior through
// unchanged — only rejects a present-but-invalid value (negative,
// non-numeric, non-finite), which was never valid data to begin with.
const isValidOptionalAmount = (v) =>
  v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

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
   * @throws {Error & {status:400}} if `now`, `booking.startTime`, or
   *   any of the three amount fields is missing/invalid — previously
   *   this silently produced NaN comparisons that always fell through
   *   to NO_REFUND, a wrong answer with no error at all.
   * @throws {Error & {status:500}} if `booking.status` is not one of
   *   the statuses CANCELLED is actually reachable from today (HOLD,
   *   CONFIRMED, CHECKED_IN) — this function is never legitimately
   *   called with anything else; a caller bug should fail loudly
   *   rather than return a nonsense policy for an already-terminal
   *   booking.
   */
  evaluate: ({ booking, now }) => {
    if (!booking || typeof booking !== "object") {
      throw Object.assign(new Error("CancellationPolicyService.evaluate requires a booking object"), { status: 400 });
    }
    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
      throw Object.assign(
        new Error(`CancellationPolicyService.evaluate called with a non-cancellable booking status: ${booking.status}`),
        { status: 500 }
      );
    }
    if (!isValidDate(now)) {
      throw Object.assign(new Error("CancellationPolicyService.evaluate requires a valid `now` Date"), { status: 400 });
    }
    const startTime = new Date(booking.startTime);
    if (!isValidDate(startTime)) {
      throw Object.assign(new Error("CancellationPolicyService.evaluate requires a valid booking.startTime"), { status: 400 });
    }
    if (
      !isValidOptionalAmount(booking.totalAmountInPaise) ||
      !isValidOptionalAmount(booking.serviceAmountInPaise) ||
      !isValidOptionalAmount(booking.commissionAmountInPaise)
    ) {
      throw Object.assign(
        new Error("CancellationPolicyService.evaluate requires non-negative numeric amount fields"),
        { status: 400 }
      );
    }

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
