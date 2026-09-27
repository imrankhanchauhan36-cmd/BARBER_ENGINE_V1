/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/TerritoryRevenueService.js
 *
 * STEP 5.3 — Territory Revenue Distribution Engine.
 *
 * WHAT THIS DOES: right after a booking's RevenueSplit is created,
 * resolves whether that booking's salon currently has an ACTIVE
 * Territory Partner (STEP 5.2 — SalonTerritoryAssignment) and whether a
 * TerritoryRevenueSettings commission rate is currently PUBLISHED
 * (STEP 5.1). If both hold, creates one immutable TerritoryRevenueSplit
 * snapshot plus its SALE TerritoryRevenueLedger row — mirroring
 * GSTLedgerService.js's createSaleLedger exactly ("reuse existing
 * finance architecture"). If either is missing, this is a SAFE NO-OP —
 * most bookings will have no Territory Partner yet, and that is normal,
 * not an error.
 *
 * READ-ONLY DEPENDENCIES (LOCKED, per the ticket — none of these are
 * ever written to by this file):
 *   - RevenueSplit (Step 1/3) — read-only, passed in by the caller
 *   - Booking — one findById().select() to learn salonRef, nothing else
 *   - modules/territoryAutoAssignment (STEP 5.2) — getTerritoryLinkForSalon,
 *     a plain .lean() read
 *   - modules/finance TerritoryRevenueSettingsService (STEP 5.1) —
 *     getPublishedTerritoryRevenueSettings, a plain .lean() read
 *   - Refund (models/Refund.js) — one findOne().select(), exactly the
 *     same read GSTLedgerService.js#createRefundReversalLedger already
 *     performs
 * NEVER imported or touched anywhere in this file: Wallet, WalletLedger,
 * Razorpay (the gateway calls), Cashfree, GST models/services,
 * CommercialPolicyVersion/CommercialPolicyOverride, AcquisitionClaim.
 *
 * IDEMPOTENT, same idiom as every other engine in this session:
 *   - createTerritoryRevenueSplitForBooking: a pre-check by revenueSplitId
 *     short-circuits a repeat call; TerritoryRevenueSplit's own unique
 *     index on revenueSplitId is the real, race-safe backstop (E11000 →
 *     return the existing document, never a duplicate).
 *   - createTerritoryRevenueReversal: a pre-check by refundId, backed by
 *     TerritoryRevenueLedger's own partial unique index on
 *     {refundId, ledgerType: REFUND_REVERSAL}.
 *
 * PROPORTIONAL REVERSAL ("full refund must create proportional
 * reversal"): mirrors GSTLedgerService's createRefundReversalLedger
 * fraction-of-real-payment formula EXACTLY —
 * refund.amountInPaise / refund.paymentAmountInPaise — applied to the
 * SPLIT's own territoryShareInPaise (never recomputed from
 * RevenueSettings/TerritoryRevenueSettings). A full refund naturally
 * produces fraction = 1 (a complete reversal); a partial refund produces
 * the same proportional apportionment GST already uses, so the two
 * ledgers never disagree about what fraction of a booking was refunded.
 *
 * NEVER throws for an expected no-op (no link, no published settings, no
 * SALE row to reverse, a non-PROCESSED refund, a zero-value reversal) —
 * every caller (RevenueSplitIntegrationService, RazorpayRefundService)
 * additionally wraps these calls in their own try/catch, exactly like
 * they already do for the GST Ledger Engine, so a defect here can NEVER
 * affect a booking confirmation or a refund's own success.
 */

import mongoose from "mongoose";
import Booking from "../../../models/Booking.js";
import Refund, { REFUND_STATUS } from "../../../models/Refund.js";
import TerritoryRevenueSplit from "../models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../models/TerritoryRevenueLedger.js";
import { getTerritoryLinkForSalon } from "../../territoryAutoAssignment/services/TerritoryAutoAssignmentService.js";
import { getPublishedTerritoryRevenueSettings } from "./TerritoryRevenueSettingsService.js";
import { TERRITORY_REVENUE_LEDGER_TYPE, TERRITORY_REVENUE_LEDGER_STATUS } from "../constants/territoryRevenueDistribution.constants.js";

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Creates the TerritoryRevenueSplit + SALE TerritoryRevenueLedger row
 * for one RevenueSplit, if (and only if) the booking's salon currently
 * has an ACTIVE Territory Partner and a commission rate is PUBLISHED.
 *
 * @param {{ revenueSplit: object }} params - an already-created
 *   RevenueSplit document (needs at least _id, bookingId,
 *   zemishRevenueInPaise).
 * @returns {Promise<object|null>} the TerritoryRevenueSplit (new or
 *   pre-existing), or null when nothing was created.
 */
export const createTerritoryRevenueSplitForBooking = async ({ revenueSplit }) => {
  if (!revenueSplit?._id || !revenueSplit?.bookingId) return null;

  // Idempotency pre-check — the unique index on
  // TerritoryRevenueSplit.revenueSplitId is the real backstop.
  const existing = await TerritoryRevenueSplit.findOne({ revenueSplitId: revenueSplit._id }).lean();
  if (existing) return existing;

  // Resolve the booking's salon — RevenueSplit itself carries no
  // salonRef (read-only, single field selected).
  const booking = await Booking.findById(revenueSplit.bookingId).select("salonRef").lean();
  if (!booking?.salonRef) return null;

  // STEP 5.2 — read-only. No link yet (most salons, most of the time)
  // is expected and normal, not an error.
  const link = await getTerritoryLinkForSalon(booking.salonRef);
  if (!link) return null;

  // STEP 5.1 — read-only. No PUBLISHED commission rate yet is expected
  // and normal in a fresh environment, same precedent as
  // RevenueSplitIntegrationService's own "no PUBLISHED RevenueSettings" gate.
  const publishedSettings = await getPublishedTerritoryRevenueSettings();
  if (!publishedSettings) return null;

  const baseAmountInPaise = revenueSplit.zemishRevenueInPaise;
  if (!Number.isInteger(baseAmountInPaise) || baseAmountInPaise <= 0) return null; // nothing to share

  const territoryShareInPaise = Math.round((baseAmountInPaise * publishedSettings.territoryCommissionPercent) / 100);
  if (territoryShareInPaise <= 0) return null; // rounds to nothing — no zero-value row

  try {
    const split = await TerritoryRevenueSplit.create({
      bookingId: revenueSplit.bookingId,
      revenueSplitId: revenueSplit._id,
      salonId: booking.salonRef,
      territoryPartnerRef: link.fieldAgentRef,
      territoryRef: link.territoryRef,
      baseAmountInPaise,
      territoryCommissionPercent: publishedSettings.territoryCommissionPercent,
      territoryRevenueSettingsVersion: publishedSettings.version,
      territoryShareInPaise,
    });

    await TerritoryRevenueLedger.create({
      bookingId: revenueSplit.bookingId,
      territoryRevenueSplitId: split._id,
      territoryPartnerRef: link.fieldAgentRef,
      ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.SALE,
      status: TERRITORY_REVENUE_LEDGER_STATUS.CREDITED,
      amountInPaise: territoryShareInPaise,
    });

    return split;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      // Lost a real race against another call for the same RevenueSplit
      // — the unique index did its job; return the winner's row.
      return TerritoryRevenueSplit.findOne({ revenueSplitId: revenueSplit._id }).lean();
    }
    throw err;
  }
};

/**
 * "Full refund must create proportional reversal" — creates the
 * REFUND_REVERSAL TerritoryRevenueLedger row for one specific, confirmed
 * (PROCESSED) Razorpay refund. Mirrors
 * GSTLedgerService#createRefundReversalLedger's proportionality formula
 * exactly (see this file's own header). The SPLIT itself is NEVER
 * updated (immutable) — this always creates a NEW, separate ledger row,
 * so a Territory Partner's outstanding balance for a booking =
 * SUM(SALE) − SUM(REFUND_REVERSAL).
 *
 * @param {{ revenueSplit: object, refundId: string }} params -
 *   revenueSplit: needs at least _id (used to find the SALE-side split);
 *   refundId: the Razorpay gateway refund id (Refund.razorpayRefundId).
 * @returns {Promise<object|null>}
 */
export const createTerritoryRevenueReversal = async ({ revenueSplit, refundId }) => {
  if (!revenueSplit?._id || !refundId) return null;

  // Idempotent pre-check — refundId is globally unique for a
  // REFUND_REVERSAL row.
  const existingReversal = await TerritoryRevenueLedger.findOne({ refundId, ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.REFUND_REVERSAL }).lean();
  if (existingReversal) return existingReversal;

  // Find the SPLIT (and its SALE row) — nothing to reverse if this
  // booking never had a Territory Partner / never earned a share.
  const split = await TerritoryRevenueSplit.findOne({ revenueSplitId: revenueSplit._id }).lean();
  if (!split) return null;

  const saleLedger = await TerritoryRevenueLedger.findOne({ territoryRevenueSplitId: split._id, ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.SALE }).lean();
  if (!saleLedger) return null;

  // Read-only lookup of the refund's own real amount and the real
  // payment total it was drawn from — same read GSTLedgerService.js
  // already performs, same reasoning (see that file's own header for
  // why the real payment total, never revenueSplit.customerPaidInPaise,
  // is authoritative).
  const refundDoc = await Refund.findOne({ razorpayRefundId: refundId }).select("amountInPaise paymentAmountInPaise refundStatus").lean();
  if (!refundDoc || refundDoc.refundStatus !== REFUND_STATUS.PROCESSED) return null;
  if (!refundDoc.paymentAmountInPaise) return null; // defensive — never divide by 0

  const refundFraction = Math.min(1, refundDoc.amountInPaise / refundDoc.paymentAmountInPaise);
  const reversalAmountInPaise = Math.round(saleLedger.amountInPaise * refundFraction);
  if (reversalAmountInPaise <= 0) return null; // rounds to nothing to reverse

  try {
    return await TerritoryRevenueLedger.create({
      bookingId: saleLedger.bookingId,
      territoryRevenueSplitId: split._id,
      territoryPartnerRef: saleLedger.territoryPartnerRef,
      ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.REFUND_REVERSAL,
      status: TERRITORY_REVENUE_LEDGER_STATUS.REVERSED,
      amountInPaise: reversalAmountInPaise,
      refundId,
    });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      // Lost a real race for the same refundId — return the winner's row.
      return TerritoryRevenueLedger.findOne({ refundId, ledgerType: TERRITORY_REVENUE_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    }
    throw err;
  }
};

/**
 * Read-only. A Territory Partner's current outstanding balance —
 * SUM(SALE) − SUM(REFUND_REVERSAL) — the money "held in Zemish until
 * payout request." No payout/withdrawal mechanism is built or wired by
 * this engine; this is purely a reporting aggregate for a future step.
 */
export const getTerritoryPartnerBalance = async (territoryPartnerRef) => {
  const partnerObjectId = typeof territoryPartnerRef === "string" ? new mongoose.Types.ObjectId(territoryPartnerRef) : territoryPartnerRef;
  const rows = await TerritoryRevenueLedger.aggregate([
    { $match: { territoryPartnerRef: partnerObjectId } },
    { $group: { _id: "$ledgerType", total: { $sum: "$amountInPaise" } } },
  ]);
  const bySale = rows.find((r) => r._id === TERRITORY_REVENUE_LEDGER_TYPE.SALE)?.total || 0;
  const byReversal = rows.find((r) => r._id === TERRITORY_REVENUE_LEDGER_TYPE.REFUND_REVERSAL)?.total || 0;
  return { creditedInPaise: bySale, reversedInPaise: byReversal, balanceInPaise: bySale - byReversal };
};
