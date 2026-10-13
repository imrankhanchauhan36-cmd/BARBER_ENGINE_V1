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
 * Rules (FIXED, Phase 3 review, 2026-10-12 — see GSTLedger.js's own
 * header for the full taxableValueInPaise correction this accompanies):
 *   - a row is created whenever EITHER service GST OR platform-fee GST
 *     was actually collected — not only when the (now-corrected)
 *     service-GST amount is positive. Previously this function only
 *     checked revenueSplit.gstAmountInPaise, which would have silently
 *     DROPPED a real, legitimately-collected platform-fee-GST amount
 *     for any booking whose service GST happens to be 0 (an
 *     unregistered salon, for example) — exactly the "fee-GST-only
 *     case" this phase's own requirements call out.
 *   - both GST components absent/zero → return null (nothing collected
 *     at all for this booking — no row).
 *   - idempotent: a second call for the same RevenueSplit returns the
 *     EXISTING row, never a second one.
 *   - never throws on a duplicate-key race — returns the winner's row.
 *   - snapshot only: every field is copied from `revenueSplit`, nothing
 *     is recomputed.
 *
 * @param {{ revenueSplit: object }} params - a RevenueSplit document
 *   (mongoose doc or plain object) with at least _id, bookingId,
 *   serviceAmountInPaise, platformFeeInPaise, gstRatePercent,
 *   gstAmountInPaise, platformFeeGstRatePercent,
 *   platformFeeGstAmountInPaise, policyVersion.
 * @returns {Promise<object|null>}
 */
export const createSaleLedger = async ({ revenueSplit }) => {
  if (!revenueSplit?._id) return null;

  const gstAmountInPaise = revenueSplit.gstAmountInPaise;
  const platformFeeGstAmountInPaise = revenueSplit.platformFeeGstAmountInPaise;
  const hasServiceGst = Number.isInteger(gstAmountInPaise) && gstAmountInPaise > 0;
  const hasPlatformFeeGst = Number.isInteger(platformFeeGstAmountInPaise) && platformFeeGstAmountInPaise > 0;
  if (!hasServiceGst && !hasPlatformFeeGst) return null; // nothing collected on either component

  const existing = await GSTLedger.findOne({ revenueSplitId: revenueSplit._id, ledgerType: GST_LEDGER_TYPE.SALE }).lean();
  if (existing) return existing;

  try {
    return await GSTLedger.create({
      bookingId: revenueSplit.bookingId,
      revenueSplitId: revenueSplit._id,
      ledgerType: GST_LEDGER_TYPE.SALE,
      status: GST_LEDGER_STATUS.COLLECTED,
      // FIXED: taxableValueInPaise is the base THIS row's OWN
      // gstAmountInPaise was actually computed on — the service
      // amount, never the platform fee (see GSTLedger.js's header).
      taxableValueInPaise: revenueSplit.serviceAmountInPaise,
      gstRate: revenueSplit.gstRatePercent,
      gstAmountInPaise: revenueSplit.gstAmountInPaise,
      platformFeeInPaise: revenueSplit.platformFeeInPaise,
      // Platform-fee GST — its own, separate taxable base (the
      // platform fee itself), rate, and amount. Only populated when
      // it was actually computed for this booking (never a fabricated
      // value for a historical booking that predates this feature).
      platformFeeTaxableValueInPaise: hasPlatformFeeGst ? revenueSplit.platformFeeInPaise : null,
      platformFeeGstRate: hasPlatformFeeGst ? revenueSplit.platformFeeGstRatePercent : null,
      platformFeeGstAmountInPaise: revenueSplit.platformFeeGstAmountInPaise,
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

  // Apportion EACH GST component independently and null-safely — a
  // SALE row can now have either component null (never collected for
  // this booking) per GSTLedger.js's corrected, nullable schema.
  const reversalGstAmountInPaise = Number.isInteger(saleLedger.gstAmountInPaise)
    ? Math.round(saleLedger.gstAmountInPaise * refundFraction)
    : null;
  const reversalTaxableValueInPaise = Number.isInteger(saleLedger.taxableValueInPaise)
    ? Math.round(saleLedger.taxableValueInPaise * refundFraction)
    : null;
  // Platform-fee GST (additive, Phase 3) — same apportionment pattern,
  // own component, so a fee-GST-only SALE row (service GST was 0/null)
  // still reverses correctly rather than being silently dropped.
  const reversalPlatformFeeGstAmountInPaise = Number.isInteger(saleLedger.platformFeeGstAmountInPaise)
    ? Math.round(saleLedger.platformFeeGstAmountInPaise * refundFraction)
    : null;
  const reversalPlatformFeeTaxableValueInPaise = Number.isInteger(saleLedger.platformFeeTaxableValueInPaise)
    ? Math.round(saleLedger.platformFeeTaxableValueInPaise * refundFraction)
    : null;

  const hasServiceReversal = Number.isInteger(reversalGstAmountInPaise) && reversalGstAmountInPaise > 0;
  const hasPlatformFeeReversal = Number.isInteger(reversalPlatformFeeGstAmountInPaise) && reversalPlatformFeeGstAmountInPaise > 0;
  if (!hasServiceReversal && !hasPlatformFeeReversal) return null; // rounds to nothing to reverse on EITHER component

  try {
    return await GSTLedger.create({
      bookingId: saleLedger.bookingId,
      revenueSplitId: saleLedger.revenueSplitId,
      ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL,
      status: GST_LEDGER_STATUS.REVERSED,
      taxableValueInPaise: reversalTaxableValueInPaise,
      gstRate: saleLedger.gstRate, // verbatim from SALE — never recomputed
      gstAmountInPaise: reversalGstAmountInPaise,
      platformFeeInPaise: Math.round(saleLedger.platformFeeInPaise * refundFraction),
      platformFeeTaxableValueInPaise: reversalPlatformFeeTaxableValueInPaise,
      platformFeeGstRate: saleLedger.platformFeeGstRate, // verbatim from SALE — never recomputed
      platformFeeGstAmountInPaise: reversalPlatformFeeGstAmountInPaise,
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
