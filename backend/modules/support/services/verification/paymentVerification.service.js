/**
 * BARBER ENGINE V1
 * backend/modules/support/services/verification/paymentVerification.service.js
 *
 * Phase H Step 5 (H.2b) — the Payment domain's read-only verification
 * adapter. Composes on bookingVerification.service.js's
 * resolveBookingContext() rather than duplicating the booking lookup
 * or ownership check (Step 8 of the H.2b instructions).
 *
 * The linked Transaction is read from BookingReadService.getBookingWithTransaction()'s
 * own embedded `transaction` sub-object (id/amount/status/paymentId/
 * type/createdAt) rather than issuing a second query via
 * TransactionReadService.getTransactionById() — that subset is already
 * the "minimum safe facts" this file needs (Step 8: "do not duplicate
 * the full Transaction document into the response").
 *
 * ── The refund-tracking fact this file is built around ─────────────
 * Confirmed independently, twice, by fresh reads of the live code
 * (Phase H Step 2 and Step 4): after CancellationPolicyService-driven
 * refund inside cancelBooking(), Booking.paymentStatus is NEVER
 * reassigned away from "PAID" (booking.controller.js:940 is the only
 * assignment site in the whole backend, and it only ever sets "PAID"),
 * and Transaction.status is NEVER updated after creation anywhere in
 * the codebase (zero Transaction.findOneAndUpdate/updateOne call
 * sites exist; TRANSACTION_TYPE.REFUND is defined but never used).
 * The ONLY reliable record that a refund actually happened is a
 * WalletTransaction row — created by cancelBooking() with exactly
 * { bookingId, type: REFUND, direction: CREDIT, status: SUCCESS } —
 * so that is the sole signal this file trusts for "already refunded."
 * Neither Transaction.status nor Booking.paymentStatus is ever used
 * for that determination. This coupling is deliberate, not an
 * oversight — if that bug is ever fixed independently, this file's
 * refund-detection query should be revisited (flagged again here,
 * not fixed — out of scope for H.2b).
 *
 * Zero writes. Zero mutation. No req/res. No client-supplied
 * booking/transaction id is ever accepted.
 */

import WalletTransaction, {
  WALLET_TXN_TYPE,
  WALLET_TXN_DIRECTION,
  WALLET_TXN_STATUS,
} from "../../../../models/WalletTransaction.js";
import { TRANSACTION_STATUS } from "../../../../models/Transaction.js";
import { BOOKING_STATUS } from "../../../../models/Booking.js";
import { resolveBookingContext } from "./bookingVerification.service.js";

/**
 * @returns {Promise<{state, domain, reason, entity, facts, allowedActions}>}
 */
export async function resolvePaymentVerification({ ticket, actor }) {
  const context = await resolveBookingContext({ ticket, actor });

  if (!context.ok) {
    return {
      state: context.state,
      domain: "PAYMENT",
      // Booking-reference gaps get a PAYMENT-specific reason code —
      // everything else (not-found / ownership) is domain-neutral and
      // reused verbatim from the shared booking context.
      reason: context.reason === "BOOKING_REFERENCE_MISSING" ? "PAYMENT_REFERENCE_MISSING" : context.reason,
      entity: null,
      facts: null,
      allowedActions: [],
    };
  }

  const { booking } = context;
  const transaction = booking.transaction; // embedded subset from getBookingWithTransaction

  if (!transaction) {
    return {
      state: "VERIFIED_NO_ACTION_ALLOWED",
      domain: "PAYMENT",
      reason: "TRANSACTION_NOT_FOUND",
      entity: { type: "Booking", id: booking.id },
      facts: { bookingStatus: booking.status, hasTransaction: false },
      allowedActions: [],
    };
  }

  const baseFacts = {
    bookingStatus: booking.status,
    transactionStatus: transaction.status,
    amountPaise: transaction.amountPaise,
    amountRupees: transaction.amountRupees,
    paymentId: transaction.paymentId,
    createdAt: transaction.createdAt,
  };
  const entity = { type: "Transaction", id: transaction.id };

  if (transaction.status === TRANSACTION_STATUS.PENDING) {
    return { state: "VERIFIED_NO_ACTION_ALLOWED", domain: "PAYMENT", reason: "PAYMENT_PENDING", entity, facts: baseFacts, allowedActions: [] };
  }

  if (transaction.status === TRANSACTION_STATUS.FAILED) {
    return { state: "VERIFIED_NO_ACTION_ALLOWED", domain: "PAYMENT", reason: "PAYMENT_FAILED", entity, facts: baseFacts, allowedActions: [] };
  }

  if (transaction.status === TRANSACTION_STATUS.PAID) {
    // The one authoritative source for "already refunded" — see file
    // header. Never Transaction.status, never Booking.paymentStatus.
    const refundRow = await WalletTransaction.findOne({
      bookingId: booking.id,
      type: WALLET_TXN_TYPE.REFUND,
      direction: WALLET_TXN_DIRECTION.CREDIT,
      status: WALLET_TXN_STATUS.SUCCESS,
    }).lean();

    if (refundRow) {
      return {
        state: "VERIFIED_NO_ACTION_ALLOWED",
        domain: "PAYMENT",
        reason: "PAYMENT_ALREADY_REFUNDED",
        entity,
        facts: { ...baseFacts, refundedAmountPaise: refundRow.amountInPaise, refundedAt: refundRow.createdAt },
        allowedActions: [],
      };
    }

    if (booking.status === BOOKING_STATUS.CANCELLED) {
      // Phase H Step 7 (H.4) — a real refund action now exists
      // (RefundExecutionService.issueRefundForCancelledBooking), so
      // this branch is the one place VERIFIED_ACTION_ALLOWED becomes
      // reachable, exactly as anticipated since the H.2 design.
      //
      // BUT: only when a refund amount was actually decided at
      // cancellation time. cancelBooking() (the customer-facing path)
      // always sets booking.cancellationPolicy/refundAmountInPaise,
      // even when the policy is NO_REFUND (0). adminCancelBooking()
      // (confirmed fresh, adminBooking.controller.js:352-410) never
      // computes or sets either field at all — it has no refund logic
      // whatsoever. For that second case there is no safely
      // determinable refund amount (re-running CancellationPolicyService
      // now would be wrong — see RefundExecutionService.js's header —
      // and it would throw outright on a CANCELLED booking anyway), so
      // this must NOT be offered as an action. Distinguished from the
      // genuinely-eligible case by a separate, honest reason code
      // rather than silently treating "no policy recorded" the same
      // as "eligible."
      if (!booking.cancellationPolicy) {
        return {
          state: "VERIFIED_NO_ACTION_ALLOWED",
          domain: "PAYMENT",
          reason: "PAYMENT_REFUND_UNDETERMINED",
          entity,
          facts: baseFacts,
          allowedActions: [],
        };
      }

      if (!booking.refundAmountInPaise || booking.refundAmountInPaise <= 0) {
        // A policy WAS recorded, and it was NO_REFUND (or an
        // otherwise-zero amount) — genuinely nothing is owed back.
        return { state: "VERIFIED_NO_ACTION_ALLOWED", domain: "PAYMENT", reason: "PAYMENT_SUCCEEDED", entity, facts: baseFacts, allowedActions: [] };
      }

      return {
        state: "VERIFIED_ACTION_ALLOWED",
        domain: "PAYMENT",
        reason: "PAYMENT_REFUND_ELIGIBLE",
        entity,
        facts: { ...baseFacts, cancellationPolicy: booking.cancellationPolicy, refundAmountInPaise: booking.refundAmountInPaise },
        allowedActions: ["ISSUE_REFUND"],
      };
    }

    return { state: "VERIFIED_NO_ACTION_ALLOWED", domain: "PAYMENT", reason: "PAYMENT_SUCCEEDED", entity, facts: baseFacts, allowedActions: [] };
  }

  // Defensive fallback — a Transaction.status value that matches none
  // of the four enum members actually used in this codebase (PENDING/
  // PAID/FAILED handled above; REFUNDED is defined but never set by
  // any code path, confirmed in the file header). Never guessed.
  return {
    state: "CANNOT_VERIFY",
    domain: "PAYMENT",
    reason: "PAYMENT_STATE_UNSUPPORTED",
    entity,
    facts: null,
    allowedActions: [],
  };
}
