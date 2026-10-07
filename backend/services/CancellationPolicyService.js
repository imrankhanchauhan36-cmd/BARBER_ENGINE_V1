//////////////////////////////////////////////////////////////
// 🔥 CANCELLATION POLICY SERVICE — single source of truth for
// booking cancellation refund policy.
//
// PURE CALCULATION ONLY — no database writes, no wallet updates,
// no booking saves, no notifications, no side effects of any
// kind. Callers (cancelBooking/ownerCancelBooking in
// booking.controller.js) remain responsible for executing the
// workflow using the values this returns — session handling, wallet
// adjustments, status transition, cache invalidation, socket emit,
// notification, and the HTTP response are all unchanged and untouched
// by this module. Also responsible for fetching the published
// RefundPolicyVersion themselves (this file stays pure/no I/O) and
// passing it in as `refundPolicy`.
//
// Global Refund & Cancellation Policy — thresholds are now read from
// the currently-PUBLISHED RefundPolicyVersion's own `rules` (admin-
// configurable), not hardcoded literals. ONE global policy applies
// identically to BOTH customer-initiated and salon-initiated
// cancellation — this remains the single evaluation entry point for
// both; there is no fault-based override. FAILS CLOSED: throws if no
// policy is published, rather than silently falling back to the old
// hardcoded 120/30-minute thresholds or guessing a default.
//
// ⚠️ FIELD SEMANTICS (LOCKED, corrected 2026-10 — read before touching
// this file): each published rule's own value is a
// CANCELLATION/RETENTION percentage — the share of each component
// FORFEITED (kept by its original owner: salon/Zemish/GST) — NOT the
// customer's refund percentage. The customer's actual refund fraction
// is always `1 - cancellationPercent/100`, computed below. A
// configured 25% means a 25% cancellation hit: the customer gets back
// 75%, and the salon/Zemish/GST ledger each retain 25% of their own
// applicable component. An earlier version of this file treated the
// configured value AS the refund percentage directly (the opposite
// meaning) — that was a genuine business-semantics bug, corrected
// before any real policy was ever published.
//
// Refund % is applied identically to EVERY refund-eligible component
// (service, Platform Fee, GST — see refundComponentSplitter.js) — the
// user gets back the same fraction of each, not a blended figure
// derived from the combined total.
//////////////////////////////////////////////////////////////

import { BOOKING_STATUS, BOOKING_TRANSITIONS } from "../utils/bookingState.machine.js";
import { resolveCancellationPercentForMinutes } from "../modules/finance/services/RefundPolicyService.js";

// Historical-reproduction labels — CancellationPolicyService.evaluate()
// always returns one of these five (never a raw number) in
// `refundPolicy`, so every existing display/metadata consumer
// (WalletTransaction.metadata.refundPolicy, Booking.cancellationPolicy,
// admin booking detail) keeps working unchanged. refundFraction (0-1,
// exact) is the authoritative numeric value for any dollar
// calculation — these labels are a human-readable bucket only.
const REFUND_POLICY_LABEL = {
  NO_PAYMENT: "NO_PAYMENT",
  NO_REFUND: "NO_REFUND",
  HALF_REFUND: "HALF_REFUND",
  FULL_REFUND: "FULL_REFUND",
  PARTIAL_REFUND: "PARTIAL_REFUND",
};

const labelForPercent = (refundPercent) => {
  if (refundPercent === 0) return REFUND_POLICY_LABEL.NO_REFUND;
  if (refundPercent === 100) return REFUND_POLICY_LABEL.FULL_REFUND;
  if (refundPercent === 50) return REFUND_POLICY_LABEL.HALF_REFUND;
  return REFUND_POLICY_LABEL.PARTIAL_REFUND;
};

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
   * given point in time. Pure function — no I/O, no mutation; the
   * caller fetches the published RefundPolicyVersion (one findOne)
   * and passes it in as `refundPolicy`.
   * @param {object} params
   * @param {object} params.booking — booking document/lean object
   *   with status, startTime, totalAmountInPaise, serviceAmountInPaise,
   *   commissionAmountInPaise.
   * @param {Date} params.now — current time (injected, not read
   *   internally, so this stays a pure function).
   * @param {{rules: Array<{minMinutes:number,maxMinutes:number|null,cancellationPercent:number}>}} params.refundPolicy
   *   — the currently-PUBLISHED RefundPolicyVersion (or any object
   *   carrying the same `rules` shape — cancellationPercent is the
   *   CANCELLATION/RETENTION percentage, NOT the refund percentage).
   *   Required whenever a refund percentage must actually be resolved
   *   (i.e. the booking is not HOLD) — see the fail-closed throw below.
   * @returns {{
   *   refundPolicy: "NO_PAYMENT"|"FULL_REFUND"|"HALF_REFUND"|"PARTIAL_REFUND"|"NO_REFUND",
   *   refundFraction: number,
   *   refundPercent: number,
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
   * @throws {Error & {status:503}} if the booking is NOT in HOLD (i.e.
   *   a refund percentage must actually be resolved) and no
   *   `refundPolicy` with a non-empty `rules` array was provided —
   *   FAIL CLOSED, never a silent 0%/old-hardcoded-rules/guessed
   *   default. Mirrors the "GST/Platform Fee never silently charge an
   *   unconfigured amount" precedent already established elsewhere in
   *   this codebase.
   */
  evaluate: ({ booking, now, refundPolicy }) => {
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

    let refundPercent;
    let refundLabel;

    if (booking.status === BOOKING_STATUS.HOLD) {
      // HOLD — no payment captured yet, no refund needed. Does not
      // depend on refundPolicy at all — a booking with no payment
      // never needs a configured percentage to produce 0%.
      refundPercent = 0;
      refundLabel   = REFUND_POLICY_LABEL.NO_PAYMENT;
    } else {
      // FAIL CLOSED — no silent 0%/old-hardcoded-rules/guessed
      // default when no policy is published.
      if (!refundPolicy || !Array.isArray(refundPolicy.rules) || refundPolicy.rules.length === 0) {
        throw Object.assign(
          new Error("No Refund & Cancellation Policy is currently published — cancellation cannot be evaluated"),
          { status: 503 }
        );
      }
      // cancellationPercent is what the admin configures (the
      // retention/penalty share) — the customer's refund percentage
      // is always its complement.
      const cancellationPercent = resolveCancellationPercentForMinutes(refundPolicy, minsUntil);
      refundPercent = 100 - cancellationPercent;
      refundLabel   = labelForPercent(refundPercent);
    }

    const refundFraction = refundPercent / 100;

    // Split refund proportionally across service + commission —
    // stored per-booking amounts (locked in at lockSlot time), not
    // re-derived from the current commission rate.
    const serviceRefundPaise    = Math.round((booking.serviceAmountInPaise || 0) * refundFraction);
    const commissionRefundPaise = Math.round((booking.commissionAmountInPaise || 0) * refundFraction);
    const refundPaise           = serviceRefundPaise + commissionRefundPaise;
    const penaltyPaise          = totalPaise - refundPaise;

    return {
      refundPolicy: refundLabel,
      refundFraction,
      refundPercent,
      serviceRefundPaise,
      commissionRefundPaise,
      refundPaise,
      penaltyPaise,
    };
  },
};

export default Object.freeze(CancellationPolicyService);
