/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/RevenueSplitIntegrationService.js
 *
 * STEP 8.2 — Pricing Engine Unification. Booking is now the ONLY pricing
 * source of truth. This file previously recalculated the customer's
 * price a second time from a separate, independently-admin-authored
 * RevenueSettings document (via RevenueCalculationService) — that
 * recalculation could silently disagree with what the customer was
 * actually charged (booking.controller.js's own lockSlot(), which prices
 * against AreaPlatformFeePolicy + GstPolicyVersion, not RevenueSettings)
 * whenever the two configs held different values. Confirmed live during
 * the ZEMISH — FINAL END-TO-END VERIFICATION run: the same booking
 * produced a real ₹141.60 charge but a recorded ₹123.60 RevenueSplit.
 *
 * FIXED FLOW — no calculation happens here anymore, only a direct field
 * mapping off the already-priced, already-immutable Booking snapshot
 * (STEP 8.1 audit, "Source of Truth diagram"):
 *   Booking.serviceAmountInPaise    -> RevenueSplit.serviceAmountInPaise
 *   Booking.commissionAmountInPaise -> RevenueSplit.platformFeeInPaise
 *   Booking.gstRatePercent          -> RevenueSplit.gstRatePercent
 *   Booking.gstAmountInPaise        -> RevenueSplit.gstAmountInPaise
 *   Booking.totalAmountInPaise      -> RevenueSplit.customerPaidInPaise
 *   Derived (LOCKED split, unchanged): salonCreditInPaise =
 *     Booking.serviceAmountInPaise; zemishRevenueInPaise =
 *     Booking.commissionAmountInPaise.
 *   Booking.platformFeePolicyRef   -> RevenueSplit.platformFeePolicyRef
 *   Booking.gstPolicyVersionRef    -> RevenueSplit.gstPolicyVersionRef
 * RevenueSettings, RevenueCalculationService and revenue.dto.js's
 * toRevenueSplitDocumentDTO are no longer read/called from this file —
 * left in place, unused by this path, per STEP 8.1's "files that must
 * remain untouched" (a later, separate deprecation decision, not this
 * one).
 *
 * REVIEWED (STEP 8.2 follow-up) — policyVersion is kept REQUIRED on
 * both RevenueSplit and GSTLedger (reverted from an earlier, now-
 * superseded nullable version of this change). Since neither
 * AreaPlatformFeePolicy nor GstPolicyVersion carries a numeric
 * "version" the way RevenueSettings did, policyVersion is now a fixed
 * engine-generation constant (REVENUE_SPLIT_ENGINE_GENERATION, below —
 * not copied from Booking, never incremented) instead of a real
 * version count; genuine per-booking policy traceability moved to the
 * two new *Ref fields above, which ARE copied verbatim from Booking.
 * Booking.platformFeePolicyRef/gstPolicyVersionRef and
 * RevenueSplit.platformFeePolicyRef/gstPolicyVersionRef are the only
 * other files/fields this follow-up touches (plus mirroring
 * GSTLedger.policyVersion back to required — GSTLedgerService.js
 * itself stays unmodified, per instruction).
 *
 * Still called from exactly one place: booking.controller.js's existing
 * runBookingConfirmedEffects() (shared by both confirmed-payment paths —
 * the client's own POST /bookings/user/confirm and the Razorpay
 * webhook's confirmBookingFromWebhook). booking.controller.js itself is
 * NOT modified by STEP 8.2 — this file's exported signature
 * (`createRevenueSplitForBooking({ booking })`) is unchanged, so that
 * call site needs no edit.
 *
 * SCOPE (LOCKED — "Integrate into the existing RAZORPAY booking flow"):
 * only Razorpay-paid bookings get a RevenueSplit. A WALLET-paid booking
 * is skipped (gated on booking.razorpayOrderId, which P0-A only ever sets
 * for a Razorpay-funded booking — never for a wallet-funded one). This
 * gate is unchanged by STEP 8.2 — orthogonal to the recalculate-vs-read
 * fix (per STEP 8.1's audit).
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
 * Previously this was a silent no-op whenever no RevenueSettings had
 * ever been PUBLISHED (true of every fresh environment) — that failure
 * mode is now structurally impossible, since this file no longer depends
 * on RevenueSettings at all; the only remaining skip condition is the
 * booking itself missing its own priced amount (defensive — should never
 * happen for a booking that reached payment confirmation, since
 * totalAmountInPaise is set at lockSlot time).
 *
 * IDEMPOTENT ("One RevenueSplit per booking. Never recalculate an
 * existing split."): a pre-check by bookingId short-circuits a repeat
 * call, and RevenueSplit's own unique index on bookingId (Step 1) is the
 * real, race-safe backstop — a concurrent duplicate create (e.g. the
 * webhook and the client both reaching this function for the same
 * booking) hits E11000 and this function returns the ALREADY-EXISTING
 * document rather than erroring or creating a second one. Historical
 * rows created under the old RevenueSettings-driven engine (if any exist
 * outside this Dev environment) are read-only here and are never
 * touched, overwritten, or recalculated by this change.
 */

import RevenueSplit from "../models/RevenueSplit.js";
import logger from "../../../utils/logger.js";
import { createSaleLedger } from "./GSTLedgerService.js"; // P0 Revenue Calculation Engine — Step 4.1 — UNCHANGED by STEP 8.2
import { createTerritoryRevenueSplitForBooking } from "./TerritoryRevenueService.js"; // STEP 5.3 — Territory Revenue Distribution Engine — UNCHANGED by STEP 8.2

const DUPLICATE_KEY_ERROR_CODE = 11000;

// STEP 8.2 (reviewed) — RevenueSplit.policyVersion is kept required
// (GSTLedger.policyVersion too, copied verbatim from it), but neither
// AreaPlatformFeePolicy nor GstPolicyVersion carries a numeric
// "version" to put there instead of the old RevenueSettings.version.
// This is a fixed, explicit marker — NOT a real version count, never
// incremented — distinguishing every split this (Booking-sourced)
// engine creates from any historical row a past RevenueSettings-driven
// split may have left behind. Real per-booking policy traceability
// lives in platformFeePolicyRef/gstPolicyVersionRef below, copied
// verbatim from Booking.
const REVENUE_SPLIT_ENGINE_GENERATION = 1;

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
    // this just avoids a redundant repeat call, e.g. a retried webhook
    // delivery.
    const existing = await RevenueSplit.findOne({ bookingId: booking._id }).lean();
    if (existing) return existing;

    // STEP 8.2 — Booking is the ONLY pricing source of truth. No lookup,
    // no calculation: every value below is read directly off the
    // already-priced, already-immutable Booking snapshot (set once, at
    // lockSlot time, by booking.controller.js — never touched here).
    // Defensive completeness check only — should never be false for a
    // booking that reached payment confirmation, since totalAmountInPaise
    // is required at lockSlot time; kept so a malformed/legacy booking
    // fails safe (skip + log) instead of throwing.
    if (
      !Number.isInteger(booking.serviceAmountInPaise) ||
      !Number.isInteger(booking.commissionAmountInPaise) ||
      !Number.isInteger(booking.totalAmountInPaise)
    ) {
      logger.warn("[RevenueSplitIntegration] booking is missing its own priced amount — skipping split (booking confirmation is unaffected)", { bookingId: String(booking._id) });
      return null;
    }

    // Create the immutable snapshot. Do NOT recalculate GST — gstRatePercent/
    // gstAmountInPaise are copied verbatim from the booking, including
    // remaining null when the booking itself was priced with no GST
    // policy published (Booking's own null-vs-zero convention — see
    // models/Booking.js). platformFeePolicyRef/gstPolicyVersionRef are
    // likewise copied verbatim from Booking — never independently
    // resolved here, never from a RevenueSettings lookup. policyVersion
    // is the fixed engine-generation marker above, not copied from
    // Booking (Booking has no numeric equivalent to copy).
    const split = await RevenueSplit.create({
      bookingId: booking._id,
      serviceAmountInPaise: booking.serviceAmountInPaise,
      platformFeeInPaise: booking.commissionAmountInPaise,
      gstRatePercent: booking.gstRatePercent,
      gstAmountInPaise: booking.gstAmountInPaise,
      customerPaidInPaise: booking.totalAmountInPaise,
      // Derived — LOCKED split, unchanged: the salon is owed exactly the
      // service amount, Zemish's revenue is exactly the platform fee.
      salonCreditInPaise: booking.serviceAmountInPaise,
      zemishRevenueInPaise: booking.commissionAmountInPaise,
      platformFeePolicyRef: booking.platformFeePolicyRef ?? null,
      gstPolicyVersionRef: booking.gstPolicyVersionRef ?? null,
      policyVersion: REVENUE_SPLIT_ENGINE_GENERATION,
    });
    logger.info("[RevenueSplitIntegration] RevenueSplit created", { bookingId: String(booking._id), customerPaidInPaise: split.customerPaidInPaise });

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
