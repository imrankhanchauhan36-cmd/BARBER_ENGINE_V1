/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/RefundReversalService.js
 *
 * Global Refund & Cancellation Policy — proportional reversal of every
 * applicable FROZEN financial component recorded for a booking, beyond
 * the customer-facing money movement (wallet credit / salon clawback,
 * unchanged, still owned by booking.controller.js /
 * RefundExecutionService.js / RazorpayRefundService.js via
 * refundComponentSplitter.js).
 *
 * WHY THIS FILE EXISTS (read fresh before writing a line of it):
 * GSTLedgerService.js#createRefundReversalLedger and
 * TerritoryRevenueService.js#createTerritoryRevenueReversal both exist
 * already, but BOTH are hard-wired to a real gateway Refund document
 * (`Refund.findOne({ razorpayRefundId })`, `refundFraction =
 * refundDoc.amountInPaise / refundDoc.paymentAmountInPaise`) — they are
 * only ever called from RazorpayRefundService.js#completeRefund, the
 * SOURCE/gateway-refund completion path. The default, far more common
 * cancellation path (cancelBooking/ownerCancelBooking) credits the
 * customer's in-app WALLET directly and never creates a Refund
 * document at all — so neither existing reversal ever ran for a wallet
 * refund. That is the exact "Wallet and Razorpay cancellation paths
 * must produce equivalent financial reversals" gap this file closes.
 *
 * This file does NOT modify GSTLedgerService.js or
 * TerritoryRevenueService.js (GST/Territory business rules stay
 * byte-for-byte unchanged, per scope) — it adds a parallel,
 * FRACTION-DRIVEN entry point that both the wallet path and the
 * gateway path can now call with the one, already-computed
 * refundFractionApplied (CancellationPolicyService's own output),
 * instead of re-deriving a fraction from a Refund document. Writing
 * directly to the existing GSTLedger collection/REFUND_REVERSAL type
 * (not a second, parallel GST-reversal collection) — "do not invent a
 * second revenue system."
 *
 * Real financial components that actually exist on a booking's frozen
 * snapshot, confirmed by direct read of RevenueSplitIntegrationService.js
 * (never assumed): serviceAmountInPaise (customer refund + salon
 * clawback — already handled, untouched, by refundComponentSplitter.js),
 * platformFeeInPaise === Zemish's own revenue (NEW reversal here), and
 * ONE gstAmountInPaise field, copied verbatim from Booking onto both
 * RevenueSplit and the GSTLedger SALE row — computed on the salon's
 * service amount (booking.controller.js's own "SALON GST — taxable
 * base is the SALON SERVICE AMOUNT ONLY" comment). There is no second,
 * separate "platform GST" field anywhere in this codebase today — GST
 * is reversed exactly once, via the existing GSTLedger mechanism this
 * file now also drives from a fraction.
 *
 * RevenueSplit only exists for a booking that was Razorpay-paid AND
 * reached CONFIRMED (RevenueSplitIntegrationService.js's own LOCKED
 * SCOPE — wallet-funded bookings are skipped by that file, not this
 * one). For any booking with no RevenueSplit (wallet-paid at origin,
 * or cancelled before the post-confirm hook ran), both reversals below
 * correctly no-op — there is nothing to reverse, and this file never
 * invents a row for a component that was never recorded.
 *
 * Isolated in its own try/catch per call site (never blocks the
 * refund itself) — exact same discipline RazorpayRefundService.js's
 * own completeRefund already uses for the two existing reversal calls.
 */

import RevenueSplit from "../models/RevenueSplit.js";
import GSTLedger from "../models/GSTLedger.js";
import { GST_LEDGER_TYPE, GST_LEDGER_STATUS } from "../constants/gstLedger.constants.js";
import ZemishRevenueReversalLedger from "../models/ZemishRevenueReversalLedger.js";
import logger from "../../../utils/logger.js";

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Fraction-driven GST reversal — structurally parallel to
 * GSTLedgerService.js#createRefundReversalLedger (same SALE-ledger
 * apportionment formula, same immutable-row/idempotent-by-key
 * discipline, same collection/type), but takes refundFraction directly
 * instead of looking up a gateway Refund document. Additive-only: does
 * not alter the existing Refund-document-driven function or its
 * callers in any way.
 *
 * @returns {Promise<object|null>} the new or pre-existing
 *   REFUND_REVERSAL row, or null if there was no SALE row to reverse
 *   or the apportioned amount rounds to 0.
 */
const createGstReversalForFraction = async ({ revenueSplit, refundFraction, reversalKey }) => {
  if (!revenueSplit?._id || !reversalKey || !refundFraction || refundFraction <= 0) return null;

  const existingReversal = await GSTLedger.findOne({ refundId: reversalKey, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
  if (existingReversal) return existingReversal;

  const saleLedger = await GSTLedger.findOne({ revenueSplitId: revenueSplit._id, ledgerType: GST_LEDGER_TYPE.SALE }).lean();
  if (!saleLedger) return null; // GST was never collected for this booking — nothing to reverse

  const clampedFraction = Math.min(1, refundFraction);
  const reversalGstAmountInPaise = Math.round(saleLedger.gstAmountInPaise * clampedFraction);
  if (reversalGstAmountInPaise <= 0) return null;

  try {
    return await GSTLedger.create({
      bookingId: saleLedger.bookingId,
      revenueSplitId: saleLedger.revenueSplitId,
      ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL,
      status: GST_LEDGER_STATUS.REVERSED,
      taxableValueInPaise: Math.round(saleLedger.taxableValueInPaise * clampedFraction),
      gstRate: saleLedger.gstRate, // verbatim from SALE — never recomputed
      gstAmountInPaise: reversalGstAmountInPaise,
      platformFeeInPaise: Math.round(saleLedger.platformFeeInPaise * clampedFraction),
      invoiceDate: new Date(),
      policyVersion: saleLedger.policyVersion, // verbatim from SALE
      refundId: reversalKey,
    });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      return GSTLedger.findOne({ refundId: reversalKey, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    }
    throw err;
  }
};

/**
 * Zemish Platform Fee revenue reversal — the new mechanism this
 * feature adds. Apportions RevenueSplit.zemishRevenueInPaise by
 * refundFraction; never recalculates, never touches the original
 * (immutable) RevenueSplit.
 *
 * @returns {Promise<object|null>} the new or pre-existing row, or null
 *   if the apportioned amount rounds to 0.
 */
const createZemishRevenueReversalForFraction = async ({ revenueSplit, refundFraction, reversalKey }) => {
  if (!revenueSplit?._id || !reversalKey || !refundFraction || refundFraction <= 0) return null;

  const existingReversal = await ZemishRevenueReversalLedger.findOne({ revenueSplitId: revenueSplit._id }).lean();
  if (existingReversal) return existingReversal;

  const clampedFraction = Math.min(1, refundFraction);
  const reversedAmountInPaise = Math.round(revenueSplit.zemishRevenueInPaise * clampedFraction);
  if (reversedAmountInPaise <= 0) return null;

  try {
    return await ZemishRevenueReversalLedger.create({
      bookingId: revenueSplit.bookingId,
      revenueSplitId: revenueSplit._id,
      refundFraction: clampedFraction,
      reversedAmountInPaise,
      reversalKey,
    });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      return ZemishRevenueReversalLedger.findOne({ revenueSplitId: revenueSplit._id }).lean();
    }
    throw err;
  }
};

/**
 * Single entry point — called once per cancelled booking, from
 * cancelBooking / ownerCancelBooking (wallet path, post-commit) AND
 * from RazorpayRefundService.js#completeRefund (SOURCE path, alongside
 * its existing GST/Territory reversal calls) AND from
 * RefundExecutionService.js (Support-triggered wallet-refund
 * completion, as a best-effort retry) — so all three execution paths
 * converge on the exact same reversal ledger rows, never drifting.
 *
 * `reversalKey` MUST be stable and unique per booking so a booking
 * that could somehow be reached from more than one of those three call
 * sites reverses exactly once (idempotent by the ledgers' own unique
 * indexes) — callers pass `cancel:<bookingId>` for the wallet-origin
 * path or the real Razorpay refund id for the gateway path; the two
 * are structurally distinct strings and can never collide.
 *
 * NEVER THROWS — a finance-recording defect must never block or roll
 * back a refund that has already been decided/executed. Each
 * sub-reversal is isolated in its own try/catch and logged on failure.
 */
export const reverseRevenueForCancelledBooking = async ({ bookingId, refundFraction, reversalKey }) => {
  if (!bookingId || !reversalKey || !refundFraction || refundFraction <= 0) {
    return { gstReversal: null, zemishReversal: null };
  }

  let revenueSplit;
  try {
    revenueSplit = await RevenueSplit.findOne({ bookingId }).lean();
  } catch (err) {
    logger.error("[RefundReversalService] failed to read RevenueSplit (refund itself unaffected)", { bookingId: String(bookingId), message: err?.message });
    return { gstReversal: null, zemishReversal: null };
  }

  if (!revenueSplit) {
    // Wallet-paid at origin, or cancelled before the post-confirm
    // RevenueSplit hook ran — nothing was ever recorded to reverse.
    return { gstReversal: null, zemishReversal: null };
  }

  let gstReversal = null;
  try {
    gstReversal = await createGstReversalForFraction({ revenueSplit, refundFraction, reversalKey });
  } catch (err) {
    logger.error("[RefundReversalService] GST reversal creation failed (refund itself succeeded; unaffected)", { bookingId: String(bookingId), revenueSplitId: String(revenueSplit._id), message: err?.message });
  }

  let zemishReversal = null;
  try {
    zemishReversal = await createZemishRevenueReversalForFraction({ revenueSplit, refundFraction, reversalKey });
  } catch (err) {
    logger.error("[RefundReversalService] Zemish revenue reversal creation failed (refund itself succeeded; unaffected)", { bookingId: String(bookingId), revenueSplitId: String(revenueSplit._id), message: err?.message });
  }

  return { gstReversal, zemishReversal };
};
