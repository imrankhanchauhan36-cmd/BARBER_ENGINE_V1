/**
 * BARBER ENGINE V1
 * backend/services/refundComponentSplitter.js
 *
 * Shared pure helper — applies ONE cancellation-timing refund fraction
 * (produced exclusively by CancellationPolicyService.evaluate(), which
 * remains byte-for-byte unchanged) across every refund-eligible booking
 * component: Service, Platform Fee (booking.commissionAmountInPaise),
 * and GST.
 *
 * PURE CALCULATION ONLY — no DB access, no session, no policy logic, no
 * awareness of cancellation timing. Takes already-resolved snapshot
 * amounts and a fraction; returns four numbers. Used identically by
 * all three refund paths (cancelBooking, ownerCancelBooking,
 * RefundExecutionService.issueRefundForCancelledBooking) so they can
 * never drift apart.
 *
 * Rounding: Math.round() per component — same project-wide convention
 * CancellationPolicyService itself already uses for
 * serviceRefundPaise/commissionRefundPaise. Independently rounding each
 * component (rather than rounding one combined total) can differ from
 * Math.round(totalAmountInPaise * fraction) by a small, bounded amount
 * when fraction === 0.5 (at most ~0.5 paise per component) — this is
 * the exact same characteristic the existing 2-component split already
 * has today; not a new rounding system, not "fixed" here, since doing
 * so would introduce a second, inconsistent rounding policy for only
 * the new component.
 *
 * Null-guarded: a legacy booking with gstAmountInPaise === null
 * contributes 0 to the GST refund, never throws.
 */

// Static restatement of CancellationPolicyService's own refundFraction
// meaning (FULL_REFUND=100%, HALF_REFUND=50%, NO_REFUND/NO_PAYMENT=0%)
// — never a call into that service, which throws on an already-terminal
// booking and would be time-drifted even if it didn't (see
// RefundExecutionService.js's own header for the original rationale).
// Exported from here (not duplicated) so every consumer that needs to
// re-derive a refund fraction from an already-decided
// booking.cancellationPolicy — RefundExecutionService and the admin
// booking-detail view — shares one definition.
export const REFUND_FRACTION_BY_POLICY = Object.freeze({
  FULL_REFUND: 1,
  HALF_REFUND: 0.5,
  NO_REFUND: 0,
  NO_PAYMENT: 0,
});

const toPaise = (amountInPaise, refundFraction) =>
  Math.round((amountInPaise || 0) * refundFraction);

/**
 * @param {object} params
 * @param {number} params.refundFraction — 0, 0.5, or 1 today (whatever
 *   CancellationPolicyService.evaluate() returns — this helper makes no
 *   assumption about which discrete values are possible).
 * @param {number} params.serviceAmountInPaise
 * @param {number} params.commissionAmountInPaise — the one customer-facing
 *   Platform Fee amount (field name unchanged, per the locked business rule).
 * @param {number|null} [params.gstAmountInPaise] — null for legacy
 *   bookings created before GST existed.
 * @returns {{ serviceRefundPaise:number, commissionRefundPaise:number,
 *   gstRefundPaise:number, totalRefundPaise:number }}
 */
export const splitRefundComponents = ({
  refundFraction,
  serviceAmountInPaise,
  commissionAmountInPaise,
  gstAmountInPaise,
}) => {
  const serviceRefundPaise = toPaise(serviceAmountInPaise, refundFraction);
  const commissionRefundPaise = toPaise(commissionAmountInPaise, refundFraction);
  const gstRefundPaise = toPaise(gstAmountInPaise, refundFraction);
  const totalRefundPaise = serviceRefundPaise + commissionRefundPaise + gstRefundPaise;

  return { serviceRefundPaise, commissionRefundPaise, gstRefundPaise, totalRefundPaise };
};
