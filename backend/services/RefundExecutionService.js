/**
 * BARBER ENGINE V1
 * backend/services/RefundExecutionService.js
 *
 * Phase H Step 7 (H.4) — the one authoritative execution path for
 * completing a refund on a booking that is ALREADY CANCELLED, paid,
 * and never had its refund actually issued. This is deliberately NOT
 * a rewrite of cancelBooking()'s refund logic — it is that exact same
 * sequence (WalletBalanceService.debitPending, then a user-wallet
 * credit, then a WalletTransaction row), reusing the identical
 * idempotency keys, extracted into a standalone, session-managed
 * function that a booking already in CANCELLED status can safely call
 * into. cancelBooking() itself (booking.controller.js) is untouched —
 * it remains the only path that transitions a booking TO cancelled;
 * this file only ever completes a refund for a booking that already
 * made that transition.
 *
 * WHY THIS FILE EXISTS AT ALL (read fresh, confirmed before writing
 * a line of this): neither cancelBooking() nor adminCancelBooking()
 * can be re-invoked on an already-CANCELLED booking — both explicitly
 * require a pre-cancellation status (booking.controller.js:1623,
 * adminBooking.controller.js:378-386), and CancellationPolicyService.
 * evaluate() itself throws a 500 if called with a non-cancellable
 * status (services/CancellationPolicyService.js:78-83) — it is not
 * safe to re-run at execution time anyway, since its 120/30-minute
 * thresholds are computed against `now`, and `now` has moved on since
 * the booking's original appointment time.
 *
 * WHERE THE REFUND AMOUNT COMES FROM: never re-derived from
 * CancellationPolicyService (see above). booking.cancellationPolicy
 * (FULL_REFUND/HALF_REFUND/NO_REFUND) is the frozen, already-decided
 * outcome from whenever the booking was actually cancelled — the
 * refundFraction table below is a static 1:1 restatement of that
 * enum's own meaning, not a re-derivation of policy. serviceAmountInPaise/
 * commissionAmountInPaise are the "locked in at lockSlot time" stored
 * amounts (confirmed in CancellationPolicyService.js's own header
 * comment), so applying the frozen fraction to them reproduces the
 * exact split cancelBooking() itself would have produced, without any
 * time-dependence. The result is cross-checked against
 * booking.refundAmountInPaise (also stored at cancellation time) as a
 * defense-in-depth consistency check before anything is written.
 *
 * A booking cancelled via adminCancelBooking() never has
 * cancellationPolicy set at all (that path never computes one) — this
 * function refuses to execute for such a booking rather than guess;
 * the caller (paymentVerification.service.js) is responsible for
 * never routing that case here in the first place.
 */

import mongoose from "mongoose";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import User from "../models/User.js";
import WalletTransaction, {
  WALLET_TXN_DIRECTION,
  WALLET_TXN_TYPE,
  WALLET_TXN_STATUS,
  WALLET_TXN_SOURCE,
} from "../models/WalletTransaction.js";
import WalletBalanceService from "./WalletBalanceService.js";

// Static restatement of CancellationPolicyService's own refundFraction
// meaning (FULL_REFUND=100%, HALF_REFUND=50%, NO_REFUND/NO_PAYMENT=0%)
// — never a call into that service, which would throw on an
// already-cancelled booking and would be time-drifted even if it
// didn't. Kept intentionally tiny and inline rather than exported
// from CancellationPolicyService.js itself, to avoid modifying that
// file's documented "PURE CALCULATION ONLY" contract for a single
// constant lookup.
const REFUND_FRACTION_BY_POLICY = {
  FULL_REFUND: 1,
  HALF_REFUND: 0.5,
  NO_REFUND: 0,
  NO_PAYMENT: 0,
};

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * @param {object} params
 * @param {string} params.bookingId
 * @param {"ADMIN"} params.triggeredBy - matches WalletLedger's own
 *   triggeredBy enum (SYSTEM|ADMIN|OWNER); a Support agent/admin
 *   action is always "ADMIN" here, with triggeredById identifying
 *   exactly who.
 * @param {string} params.triggeredById
 * @returns {Promise<{alreadyIssued: boolean, refundPaise: number, walletTransactionId: string|null}>}
 * @throws on: booking not found, booking not CANCELLED, no
 *   cancellationPolicy recorded, computed amount disagreeing with
 *   booking.refundAmountInPaise
 */
export async function issueRefundForCancelledBooking({ bookingId, triggeredBy, triggeredById }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }

    if (booking.status !== BOOKING_STATUS.CANCELLED) {
      throw Object.assign(
        new Error(`issueRefundForCancelledBooking requires a CANCELLED booking, got ${booking.status}`),
        { status: 409 }
      );
    }

    if (!booking.cancellationPolicy) {
      throw Object.assign(
        new Error("No cancellation policy was recorded for this booking — refund amount cannot be safely determined"),
        { status: 409 }
      );
    }

    // Idempotency pre-check — the authoritative guarantee is the
    // unique index on WalletTransaction.requestId below, but this
    // check lets a repeat call return cleanly instead of always
    // hitting a duplicate-key exception path.
    const existing = await WalletTransaction.findOne({
      bookingId: booking._id,
      type: WALLET_TXN_TYPE.REFUND,
      direction: WALLET_TXN_DIRECTION.CREDIT,
      status: WALLET_TXN_STATUS.SUCCESS,
    }).session(session);

    if (existing) {
      await session.abortTransaction();
      session.endSession();
      return { alreadyIssued: true, refundPaise: existing.amountInPaise, walletTransactionId: existing._id };
    }

    const refundFraction = REFUND_FRACTION_BY_POLICY[booking.cancellationPolicy];
    if (refundFraction === undefined) {
      throw Object.assign(new Error(`Unrecognized cancellationPolicy: ${booking.cancellationPolicy}`), { status: 500 });
    }

    const serviceRefundPaise = Math.round((booking.serviceAmountInPaise || 0) * refundFraction);
    const commissionRefundPaise = Math.round((booking.commissionAmountInPaise || 0) * refundFraction);
    const refundPaise = serviceRefundPaise + commissionRefundPaise;

    if (
      booking.refundAmountInPaise !== null &&
      booking.refundAmountInPaise !== undefined &&
      booking.refundAmountInPaise !== refundPaise
    ) {
      throw Object.assign(
        new Error(
          `Computed refund (${refundPaise} paise) does not match the amount recorded at cancellation time ` +
          `(${booking.refundAmountInPaise} paise) — refusing to execute an inconsistent refund`
        ),
        { status: 409 }
      );
    }

    if (refundPaise <= 0) {
      await session.abortTransaction();
      session.endSession();
      return { alreadyIssued: false, refundPaise: 0, walletTransactionId: null };
    }

    if (serviceRefundPaise > 0) {
      await WalletBalanceService.debitPending({
        salonId: booking.salonRef,
        amountInPaise: serviceRefundPaise,
        action: "REFUND",
        entityType: "BOOKING",
        entityId: booking._id,
        idempotencyKey: `booking:refund:${booking._id}`,
        session,
        triggeredBy,
        triggeredById,
        remarks: "Support-verified post-cancellation refund completion",
      });
    }

    const userBefore = await User.findOne({ _id: booking.userRef, isDeleted: false })
      .select("walletBalance")
      .session(session);

    const refundRupees = refundPaise / 100;
    const balanceBeforeInPaise = Math.round((userBefore?.walletBalance || 0) * 100);

    const updatedUser = await User.findOneAndUpdate(
      { _id: booking.userRef, isDeleted: false },
      { $inc: { walletBalance: refundRupees } },
      { new: true, session }
    ).select("walletBalance");

    const [walletTxn] = await WalletTransaction.create(
      [{
        userId: booking.userRef,
        bookingId: booking._id,
        direction: WALLET_TXN_DIRECTION.CREDIT,
        type: WALLET_TXN_TYPE.REFUND,
        status: WALLET_TXN_STATUS.SUCCESS,
        source: WALLET_TXN_SOURCE.BOOKING,
        amountInPaise: refundPaise,
        requestId: `refund:${booking._id}`,
        balanceBeforeInPaise,
        balanceAfterInPaise: Math.round((updatedUser?.walletBalance || 0) * 100),
        metadata: { refundPolicy: booking.cancellationPolicy, bookingId: booking._id.toString(), executedVia: "SUPPORT_VERIFIED_ACTION" },
      }],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return { alreadyIssued: false, refundPaise, walletTransactionId: walletTxn._id };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    // A concurrent duplicate call can lose the pre-check race and hit
    // the unique index on WalletTransaction.requestId instead — the
    // real, atomic backstop. Treated the same as the pre-check finding
    // an existing row: a clean "already issued", not an error.
    if (err.code === DUPLICATE_KEY_ERROR_CODE) {
      const existing = await WalletTransaction.findOne({
        bookingId,
        type: WALLET_TXN_TYPE.REFUND,
        direction: WALLET_TXN_DIRECTION.CREDIT,
        status: WALLET_TXN_STATUS.SUCCESS,
      });
      if (existing) {
        return { alreadyIssued: true, refundPaise: existing.amountInPaise, walletTransactionId: existing._id };
      }
    }

    throw err;
  }
}
