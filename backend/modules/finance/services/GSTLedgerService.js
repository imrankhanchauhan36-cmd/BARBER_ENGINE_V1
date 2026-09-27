/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/GSTLedgerService.js
 *
 * P0 Revenue Calculation Engine — Step 4.1 (GST Ledger Engine).
 *
 * LOCKED rule: "Do NOT recalculate anything. Read values ONLY from
 * RevenueSplit." This file performs zero calculation — every value on a
 * created GSTLedger row is copied verbatim off an already-created
 * RevenueSplit document (Step 1/3). No Wallet, no WalletLedger, no
 * Razorpay, no Cashfree, no Refund, no Booking write — this file imports
 * none of them.
 *
 * Step 4.2 (GST Reversal Engine) adds ONE more function here:
 * createRefundReversalLedger(). It reads the SALE ledger's own numbers
 * verbatim (rate, taxable value, GST, platform fee — "Do NOT recalculate
 * GST. Read values ONLY from SALE ledger.") and apportions them by the
 * ACTUAL refund amount. The only new dependency is a read-only lookup of
 * the existing, untouched Refund record (models/Refund.js, P0-C) to
 * learn that one number — no refund math, wallet, Razorpay call, or
 * booking write happens here; see that function's own header for the
 * full rationale.
 */

import GSTLedger from "../models/GSTLedger.js";
import Refund, { REFUND_STATUS } from "../../../models/Refund.js";
import { GST_LEDGER_TYPE, GST_LEDGER_STATUS } from "../constants/gstLedger.constants.js";

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Creates the one SALE GSTLedger row for a RevenueSplit — a pure
 * snapshot, no recalculation.
 *
 * Rules (ticket's own wording):
 *   - GST disabled OR gstAmount == 0 → return null (RevenueCalculationService
 *     already forces gstAmountInPaise to 0 whenever GST was disabled at
 *     calculation time — see RevenueCalculationService.js — so checking
 *     gstAmountInPaise covers both cases without this file needing to
 *     know about a separate "gstEnabled" flag).
 *   - idempotent: a second call for the same RevenueSplit returns the
 *     EXISTING row, never a second one.
 *   - never throws on a duplicate-key race — returns the winner's row.
 *   - snapshot only: every field is copied from `revenueSplit`, nothing
 *     is recomputed.
 *
 * @param {{ revenueSplit: object }} params - a RevenueSplit document
 *   (mongoose doc or plain object) with at least _id, bookingId,
 *   platformFeeInPaise, gstRatePercent, gstAmountInPaise, policyVersion.
 * @returns {Promise<object|null>}
 */
export const createSaleLedger = async ({ revenueSplit }) => {
  if (!revenueSplit?._id) return null;

  const gstAmountInPaise = revenueSplit.gstAmountInPaise;
  if (!gstAmountInPaise || gstAmountInPaise <= 0) return null; // GST disabled OR gstAmount == 0

  const existing = await GSTLedger.findOne({ revenueSplitId: revenueSplit._id, ledgerType: GST_LEDGER_TYPE.SALE }).lean();
  if (existing) return existing;

  try {
    return await GSTLedger.create({
      bookingId: revenueSplit.bookingId,
      revenueSplitId: revenueSplit._id,
      ledgerType: GST_LEDGER_TYPE.SALE,
      status: GST_LEDGER_STATUS.COLLECTED,
      // LOCKED rule: GST applies only to the Platform Fee — the taxable
      // value is therefore the platform fee itself, read verbatim from
      // RevenueSplit, never re-derived.
      taxableValueInPaise: revenueSplit.platformFeeInPaise,
      gstRate: revenueSplit.gstRatePercent,
      gstAmountInPaise: revenueSplit.gstAmountInPaise,
      platformFeeInPaise: revenueSplit.platformFeeInPaise,
      invoiceDate: new Date(),
      policyVersion: revenueSplit.policyVersion,
    });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      // Lost a real race against another call for the same RevenueSplit
      // — the unique partial index on {revenueSplitId, ledgerType:SALE}
      // did its job; return the winner's row rather than throwing.
      return GSTLedger.findOne({ revenueSplitId: revenueSplit._id, ledgerType: GST_LEDGER_TYPE.SALE }).lean();
    }
    throw err;
  }
};

/**
 * P0 Revenue Calculation Engine — Step 4.2 (GST Reversal Engine).
 *
 * Creates the REFUND_REVERSAL GSTLedger row for one specific, confirmed
 * (PROCESSED) Razorpay refund — a proportional credit against the
 * booking's SALE row. The SALE row is NEVER updated (immutable, per
 * Step 4.1); this always creates a NEW, separate row instead, so
 * net GST liability for a booking = SUM(SALE) − SUM(REFUND_REVERSAL).
 *
 * PROPORTIONALITY (LOCKED example: ₹20 fee / ₹3.60 GST, a 50% refund →
 * reversal ₹1.80): the fraction is `refund.amountInPaise /
 * refund.paymentAmountInPaise` — the REAL Razorpay payment this refund
 * was drawn from, read from the existing Refund record (P0-C), NEVER
 * revenueSplit.customerPaidInPaise. Those two totals can legitimately
 * differ (this engine's own price can diverge from the booking's
 * historical Razorpay-charged total — see RevenueSplitIntegrationService.js's
 * own Step 3 disclosure), and only the REAL payment total tells you what
 * fraction of the actual money was returned. That fraction is then
 * applied to the SALE row's own gstAmountInPaise/taxableValueInPaise/
 * platformFeeInPaise — a proportional APPORTIONMENT of an already-fixed
 * tax amount, not a recalculation of GST (the rate itself is copied
 * verbatim from the SALE row, never re-derived from RevenueSettings).
 *
 * Two independent refunds against the same payment (e.g. a 50% refund,
 * then later the remaining 50%) each get their OWN reversal row, each
 * computed independently from the SAME real payment total — so they
 * naturally sum to exactly the full SALE amount once the payment is
 * 100% refunded, without this function needing to track "how much GST
 * is still outstanding" as separate state ("full refund after partial
 * creates [the correct] remaining balance").
 *
 * Rules:
 *   - idempotent: one reversal per refundId (DB-enforced — see
 *     GSTLedger.js's partial unique index on {refundId, ledgerType}).
 *   - no SALE ledger for this RevenueSplit (GST was disabled/zero) →
 *     nothing to reverse → null.
 *   - the refund isn't found, or isn't PROCESSED yet → null (a PENDING
 *     or FAILED refund never reverses GST).
 *   - the apportioned amount rounds to 0 → null (no zero-value row).
 *   - never throws on a duplicate-key race — returns the winner's row.
 *
 * No Wallet, no WalletLedger, no Razorpay call, no Cashfree, no Booking
 * write — Refund is read-only here (one findOne, no write).
 *
 * @param {{ revenueSplit: object, refundId: string }} params -
 *   revenueSplit: a RevenueSplit document (needs at least _id);
 *   refundId: the Razorpay gateway refund id (Refund.razorpayRefundId).
 * @returns {Promise<object|null>}
 */
export const createRefundReversalLedger = async ({ revenueSplit, refundId }) => {
  if (!revenueSplit?._id || !refundId) return null;

  // Idempotent pre-check — refundId is globally unique for a REFUND_REVERSAL row.
  const existingReversal = await GSTLedger.findOne({ refundId, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
  if (existingReversal) return existingReversal;

  // 1. Find SALE ledger — read values ONLY from it (rate, taxable value,
  // GST, platform fee); never recomputed.
  const saleLedger = await GSTLedger.findOne({ revenueSplitId: revenueSplit._id, ledgerType: GST_LEDGER_TYPE.SALE }).lean();
  if (!saleLedger) return null; // GST was never collected for this booking — nothing to reverse

  // Read-only lookup of the refund's OWN real amount and the REAL payment
  // total it was drawn from (see this function's header for why the
  // payment total, not revenueSplit.customerPaidInPaise, is authoritative).
  const refundDoc = await Refund.findOne({ razorpayRefundId: refundId }).select("amountInPaise paymentAmountInPaise refundStatus").lean();
  if (!refundDoc || refundDoc.refundStatus !== REFUND_STATUS.PROCESSED) return null;
  if (!refundDoc.paymentAmountInPaise) return null; // defensive — schema requires it, but never divide by 0

  const refundFraction = Math.min(1, refundDoc.amountInPaise / refundDoc.paymentAmountInPaise);
  const reversalGstAmountInPaise = Math.round(saleLedger.gstAmountInPaise * refundFraction);
  if (reversalGstAmountInPaise <= 0) return null; // rounds to nothing to reverse

  try {
    return await GSTLedger.create({
      bookingId: saleLedger.bookingId,
      revenueSplitId: saleLedger.revenueSplitId,
      ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL,
      status: GST_LEDGER_STATUS.REVERSED,
      taxableValueInPaise: Math.round(saleLedger.taxableValueInPaise * refundFraction),
      gstRate: saleLedger.gstRate, // verbatim from SALE — never recomputed
      gstAmountInPaise: reversalGstAmountInPaise,
      platformFeeInPaise: Math.round(saleLedger.platformFeeInPaise * refundFraction),
      invoiceDate: new Date(),
      policyVersion: saleLedger.policyVersion, // verbatim from SALE
      refundId,
    });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      // Lost a real race against another call for the same refundId —
      // the unique partial index on {refundId, ledgerType:REFUND_REVERSAL}
      // did its job; return the winner's row rather than throwing.
      return GSTLedger.findOne({ refundId, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    }
    throw err;
  }
};
