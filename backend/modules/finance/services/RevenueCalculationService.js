/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/RevenueCalculationService.js
 *
 * P0 Revenue Calculation Engine — Step 1.
 *
 * LOCKED architecture rule: "Calculation Engine kabhi wallet ko touch
 * nahi karega. Settlement Engine kabhi formula calculate nahi karega."
 * This file is the Calculation Engine half of that split — it is a PURE
 * function module:
 *   - no Mongoose model imports, no DB reads, no DB writes
 *   - no Wallet/WalletLedger/WalletBalanceService reference
 *   - no Razorpay/Cashfree reference
 *   - no Booking-lifecycle side effects
 * It does not even fetch RevenueSettings itself — the caller resolves and
 * passes one in, so this module has zero knowledge of "how a policy
 * becomes PUBLISHED" (that belongs to a future RevenueSettingsService,
 * mirroring gstPolicy.service.js's existing publish/retire discipline).
 *
 * LOCKED business formula:
 *   Customer Pay = Service Amount + Platform Fee + GST
 *   GST applies ONLY to the Platform Fee (never to the service amount).
 *
 * Example (from the spec): service ₹100 + platform fee ₹20 + GST 18% of
 * ₹20 (₹3.60) = customer pays ₹123.60. Split: salon ₹100, Zemish ₹20,
 * GST liability ₹3.60.
 *
 * Every amount is an integer number of paise in and out — this service
 * never handles rupees, and never performs floating-point rupee math.
 * Rounding: gstAmountInPaise = Math.round(platformFeeInPaise * gstRate /
 * 100) — the same project-wide convention already used by
 * booking.controller.js's own (unrelated) GST calculation and by
 * refundComponentSplitter.js.
 */

import { Errors } from "../../../utils/response.js";

/**
 * @typedef {Object} RevenueSettingsInput
 * @property {number} platformFeeInPaise - non-negative integer
 * @property {number} gstRate - percentage, 0-100 (e.g. 18 = 18%)
 * @property {boolean} [gstEnabled=true] - when false, GST is always 0 regardless of gstRate
 * @property {number} version - the policyVersion snapshotted onto the result (RevenueSettings.version)
 */

/**
 * @typedef {Object} RevenueCalculationResult
 * @property {number} serviceAmountInPaise
 * @property {number} platformFeeInPaise
 * @property {number} gstRatePercent - the rate actually applied (0 when GST is disabled)
 * @property {number} gstAmountInPaise
 * @property {number} customerPaidInPaise - serviceAmountInPaise + platformFeeInPaise + gstAmountInPaise
 * @property {number} salonCreditInPaise - === serviceAmountInPaise (LOCKED split)
 * @property {number} zemishRevenueInPaise - === platformFeeInPaise (LOCKED split)
 * @property {number} policyVersion - RevenueSettingsInput.version, snapshotted verbatim
 */

const isNonNegativeInteger = (n) => Number.isInteger(n) && n >= 0;

const assertValidInput = ({ serviceAmountInPaise, revenueSettings }) => {
  if (!isNonNegativeInteger(serviceAmountInPaise)) {
    throw Errors.badRequest("serviceAmountInPaise must be a non-negative whole number (paise, not rupees)");
  }
  if (!revenueSettings || typeof revenueSettings !== "object") {
    throw Errors.badRequest("revenueSettings is required");
  }
  const { platformFeeInPaise, gstRate, version } = revenueSettings;
  if (!isNonNegativeInteger(platformFeeInPaise)) {
    throw Errors.badRequest("revenueSettings.platformFeeInPaise must be a non-negative whole number (paise, not rupees)");
  }
  if (typeof gstRate !== "number" || Number.isNaN(gstRate) || gstRate < 0 || gstRate > 100) {
    throw Errors.badRequest("revenueSettings.gstRate must be a number between 0 and 100");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw Errors.badRequest("revenueSettings.version must be a positive whole number");
  }
};

/**
 * Pure calculation — same inputs always produce the same outputs, no
 * matter when or how many times it is called. No DB writes inside this
 * service (LOCKED rule). Never mutates `revenueSettings`.
 *
 * @param {Object} params
 * @param {number} params.serviceAmountInPaise
 * @param {RevenueSettingsInput} params.revenueSettings
 * @returns {RevenueCalculationResult}
 */
export const calculateRevenue = ({ serviceAmountInPaise, revenueSettings }) => {
  assertValidInput({ serviceAmountInPaise, revenueSettings });

  const platformFeeInPaise = revenueSettings.platformFeeInPaise;
  // gstEnabled defaults to true when omitted — RevenueSettings.js itself
  // defaults the field the same way; a caller passing a plain object
  // without it (e.g. a test fixture) gets the LOCKED "GST applies" default,
  // not a silently-zeroed GST.
  const gstEnabled = revenueSettings.gstEnabled !== false;
  const gstRatePercent = gstEnabled ? revenueSettings.gstRate : 0;

  // LOCKED: GST applies ONLY to the platform fee, never to the service amount.
  const gstAmountInPaise = gstEnabled
    ? Math.round((platformFeeInPaise * revenueSettings.gstRate) / 100)
    : 0;

  const customerPaidInPaise = serviceAmountInPaise + platformFeeInPaise + gstAmountInPaise;

  return Object.freeze({
    serviceAmountInPaise,
    platformFeeInPaise,
    gstRatePercent,
    gstAmountInPaise,
    customerPaidInPaise,

    // LOCKED split — the formula has nowhere else for the money to go:
    // the salon is owed exactly the service amount, Zemish's revenue is
    // exactly the platform fee, and GST is a separate government
    // liability (never Zemish revenue, never salon credit).
    salonCreditInPaise: serviceAmountInPaise,
    zemishRevenueInPaise: platformFeeInPaise,

    policyVersion: revenueSettings.version,
  });
};

export default { calculateRevenue };
