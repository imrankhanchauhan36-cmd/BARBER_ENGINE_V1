/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/RevenueSplitIntegrationService.js
 *
 * P0 Revenue Calculation Engine — Step 3. The ONLY file that connects the
 * Calculation Engine (Step 1) and the Revenue Settings admin authoring
 * (Step 2) to a real booking. Everything else in modules/finance stays
 * exactly as it was — this file adds ONE new capability:
 * createRevenueSplitForBooking(), called from booking.controller.js's
 * existing runBookingConfirmedEffects() (the one function already shared
 * by BOTH confirmed-payment paths: the client's own
 * POST /bookings/user/confirm AND the Razorpay webhook's
 * confirmBookingFromWebhook — see razorpayWebhook.service.js). No new
 * call site was added anywhere else.
 *
 * REQUIRED FLOW (ticket's own wording), implemented in this exact order:
 *   1. Load current PUBLISHED RevenueSettings
 *   2. Run RevenueCalculationService
 *   3. Create immutable RevenueSplit snapshot
 *   4. Credit only Service Amount into Salon Hold Wallet — ALREADY TRUE,
 *      unmodified: WalletBalanceService.creditPending's amountInPaise is
 *      already `booking.serviceAmountInPaise` (booking.controller.js's own
 *      `payoutAmount`), confirmed by read-only audit before writing this
 *      file. Nothing here touches WalletBalanceService/WalletLedger/
 *      Transaction — see the header note below.
 *   5. GST + Platform Fee preserved inside RevenueSplit — RevenueSplit's
 *      own fields (Step 1), untouched here.
 *   6. policyVersion snapshotted — RevenueSplit.policyVersion (Step 1),
 *      untouched here.
 *
 * SCOPE (LOCKED — "Integrate into the existing RAZORPAY booking flow"):
 * only Razorpay-paid bookings get a RevenueSplit. A WALLET-paid booking
 * is skipped (gated on booking.razorpayOrderId, which P0-A only ever sets
 * for a Razorpay-funded booking — never for a wallet-funded one). Wallet
 * payments were explicitly out of this ticket's stated objective; the
 * gate is here, not scattered across the caller.
 *
 * SAFETY (why this runs where it runs, and why it can never throw):
 * called strictly AFTER the booking-confirmation transaction has already
 * committed (post-commit, inside runBookingConfirmedEffects — the exact
 * same place NotificationService sends already run, which that function's
 * own comment already documents as "non-blocking, after commit"). A
 * RevenueSplit is a finance/audit record, not a condition of payment
 * success — this function NEVER throws; every failure path is caught,
 * logged, and returns null. A finance-recording defect must never turn
 * into a failed booking confirmation for a customer who has already paid.
 * If no RevenueSettings has ever been PUBLISHED yet (true of every fresh
 * environment before Step 2 is used), this is a silent, logged no-op —
 * NOT an error — so booking confirmation keeps working exactly as it did
 * before this engine existed.
 *
 * IDEMPOTENT ("One RevenueSplit per booking. Never recalculate an
 * existing split."): a pre-check by bookingId short-circuits a repeat
 * call, and RevenueSplit's own unique index on bookingId (Step 1) is the
 * real, race-safe backstop — a concurrent duplicate create (e.g. the
 * webhook and the client both reaching this function for the same
 * booking) hits E11000 and this function returns the ALREADY-EXISTING
 * document rather than erroring or creating a second one.
 */

import RevenueSettings from "../models/RevenueSettings.js";
import RevenueSplit from "../models/RevenueSplit.js";
import { calculateRevenue } from "./RevenueCalculationService.js";
import { toRevenueSplitDocumentDTO } from "../dto/revenue.dto.js";
import { REVENUE_SETTINGS_STATUS } from "../constants/revenue.constants.js";
import logger from "../../../utils/logger.js";
import { createSaleLedger } from "./GSTLedgerService.js"; // P0 Revenue Calculation Engine — Step 4.1
import { createTerritoryRevenueSplitForBooking } from "./TerritoryRevenueService.js"; // STEP 5.3 — Territory Revenue Distribution Engine

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * @param {{ booking: import("mongoose").Document }} params - the CONFIRMED
 *   booking document (already saved; this function makes no writes to it)
 * @returns {Promise<object|null>} the RevenueSplit (new or pre-existing),
 *   or null when nothing was created (no split, but also no error).
 */
export const createRevenueSplitForBooking = async ({ booking }) => {
  try {
    if (!booking?._id) return null;

    // LOCKED SCOPE — Razorpay bookings only (see file header). Wallet-funded
    // bookings never have a razorpayOrderId (P0-A).
    if (!booking.razorpayOrderId) return null;

    // Idempotency pre-check — the unique index on RevenueSplit.bookingId
    // (Step 1) is the real backstop against a concurrent duplicate;
    // this just avoids a redundant calculation on the common
    // (non-racing) repeat call, e.g. a retried webhook delivery.
    const existing = await RevenueSplit.findOne({ bookingId: booking._id }).lean();
    if (existing) return existing;

    // 1. Load current PUBLISHED RevenueSettings.
    const published = await RevenueSettings.findOne({ status: REVENUE_SETTINGS_STATUS.PUBLISHED }).lean();
    if (!published) {
      logger.warn("[RevenueSplitIntegration] no PUBLISHED RevenueSettings — skipping split (booking confirmation is unaffected)", { bookingId: String(booking._id) });
      return null;
    }

    // 2. Run RevenueCalculationService — pure, no DB writes inside it.
    const calc = calculateRevenue({
      serviceAmountInPaise: booking.serviceAmountInPaise,
      revenueSettings: {
        platformFeeInPaise: published.platformFeeInPaise,
        gstRate: published.gstRate,
        gstEnabled: published.gstEnabled,
        version: published.version,
      },
    });

    // 3, 5, 6. Create the immutable snapshot (GST, Platform Fee and
    // policyVersion are all fields on this document already — see
    // RevenueSplit.js / revenue.dto.js, Step 1).
    const split = await RevenueSplit.create({ bookingId: booking._id, ...toRevenueSplitDocumentDTO(calc) });
    logger.info("[RevenueSplitIntegration] RevenueSplit created", { bookingId: String(booking._id), policyVersion: split.policyVersion, customerPaidInPaise: split.customerPaidInPaise });

    // Step 4.1 — GST Ledger Engine. Isolated in its own try/catch: the
    // RevenueSplit above has already succeeded and must be returned
    // regardless of whether the GST ledger snapshot succeeds. Reads only
    // from `split`, writes only its own new collection — no Wallet, no
    // Razorpay, no Booking write.
    try {
      await createSaleLedger({ revenueSplit: split });
    } catch (gstErr) {
      logger.error("[RevenueSplitIntegration] GST ledger creation failed (RevenueSplit itself succeeded; booking confirmation is unaffected)", { bookingId: String(booking._id), revenueSplitId: String(split._id), message: gstErr?.message });
    }

    // STEP 5.3 — Territory Revenue Distribution Engine. Isolated in its
    // own try/catch, same pattern as the GST Ledger block above: the
    // RevenueSplit has already succeeded and must be returned regardless
    // of whether this succeeds. Reads only from `split` plus its own
    // read-only STEP 5.1/5.2 dependencies; writes only its own new
    // TerritoryRevenueSplit/TerritoryRevenueLedger collections — no
    // Wallet, no Razorpay, no GST, no Booking write.
    try {
      await createTerritoryRevenueSplitForBooking({ revenueSplit: split });
    } catch (territoryErr) {
      logger.error("[RevenueSplitIntegration] Territory revenue split creation failed (RevenueSplit itself succeeded; booking confirmation is unaffected)", { bookingId: String(booking._id), revenueSplitId: String(split._id), message: territoryErr?.message });
    }

    return split;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      // Lost a real race against another call for the same booking (e.g.
      // the webhook and the client both confirming around the same
      // moment) — the unique index did its job; return the winner's row
      // rather than treating this as a failure.
      return RevenueSplit.findOne({ bookingId: booking._id }).lean();
    }
    // Never let a finance-recording defect surface as a booking-confirmation
    // failure — the customer has already paid and the booking is already
    // confirmed by the time this function runs (see file header).
    logger.error("[RevenueSplitIntegration] failed to create RevenueSplit (booking confirmation is unaffected)", { bookingId: String(booking?._id), message: err?.message });
    return null;
  }
};
