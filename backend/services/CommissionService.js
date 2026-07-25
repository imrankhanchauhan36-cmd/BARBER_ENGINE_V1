import AppSetting, { APP_SETTING_KEYS } from "../models/AppSetting.js";
import logger from "../utils/logger.js";

//////////////////////////////////////////////////////////////
// 🔥 COMMISSION SERVICE — single source of truth for commission
//
// Resolution order:
//   1. Salon.business.commissionRate (admin override, per-salon)
//   2. AppSetting.DEFAULT_COMMISSION_RATE (global default)
//   3. FALLBACK_RATE_PERCENT — EMERGENCY FALLBACK ONLY. Production
//      should always have DEFAULT_COMMISSION_RATE configured in
//      AppSetting; this constant exists purely so a booking never
//      crashes if that document is somehow missing. Its use is
//      logged as a warning (see getGlobalDefaultRate) precisely so
//      this is never mistaken for normal configuration.
//
// Rates are stored as PERCENTAGES (10 = 10%), matching
// Salon.business.commissionRate's existing schema (min:0, max:50)
// and AppSetting's documented convention — converted to a fraction
// only at the point of calculation.
//
// ROUNDING POLICY (project-wide standard — follow this everywhere
// money is split, not just here): Math.round(), i.e. round-half-up
// to the nearest paisa. Applied consistently in confirmBooking,
// cancelBooking, and here so commission + payout always sum back
// to exactly the original amount with no stray paisa.
//
// Short-lived in-memory cache: commission rate changes are rare and
// non-urgent, so caching the global default for a few minutes avoids
// a DB read on every single booking confirm/cancel. Call
// CommissionService.clearCache() immediately after an admin updates
// DEFAULT_COMMISSION_RATE so the new rate applies right away instead
// of waiting out the TTL.
//////////////////////////////////////////////////////////////

const FALLBACK_RATE_PERCENT = 10; // EMERGENCY FALLBACK ONLY — see header note
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = {
  rate: null,
  expiresAt: 0,
};

const isValidPercent = (val) =>
  typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= 100;

/**
 * Reads AppSetting.DEFAULT_COMMISSION_RATE, with a short in-memory
 * cache. Falls back to FALLBACK_RATE_PERCENT (with a warning log)
 * if the setting is missing or holds an invalid value — validated
 * here since the schema itself (Mixed type) can't enforce this.
 */
const getGlobalDefaultRate = async () => {
  const now = Date.now();
  if (cache.rate !== null && now < cache.expiresAt) {
    return cache.rate;
  }

  const setting = await AppSetting.findOne({
    key: APP_SETTING_KEYS.DEFAULT_COMMISSION_RATE,
  }).lean();

  let rate;
  if (isValidPercent(setting?.value)) {
    rate = setting.value;
  } else {
    rate = FALLBACK_RATE_PERCENT;
    logger.warn("COMMISSION SERVICE: DEFAULT_COMMISSION_RATE missing or invalid in AppSetting — using emergency fallback", {
      fallbackRatePercent: FALLBACK_RATE_PERCENT,
      foundValue: setting?.value ?? null,
    });
  }

  cache.rate = rate;
  cache.expiresAt = now + CACHE_TTL_MS;
  return rate;
};

const CommissionService = {
  /**
   * Resolves the commission rate (as a PERCENTAGE, e.g. 10) for a
   * given salon: its own override if valid, otherwise the global
   * default from AppSetting.
   * @param {object} salon — a Salon document (or lean object) with
   *   business.commissionRate, or null/undefined.
   * @returns {Promise<number>} commission rate as a percentage (0-100)
   */
  getRatePercent: async (salon) => {
    const override = salon?.business?.commissionRate;
    // NOTE: 0 is treated as "not set" here, not as "salon has 0%
    // commission" — Salon.business.commissionRate defaults to 0 in
    // the schema for every salon, so treating 0 as a real override
    // would make every salon that has never explicitly configured a
    // rate silently pay 0% commission. A genuine 0%-commission
    // promotional salon would need an explicit flag (e.g.
    // hasCommissionOverride) to be distinguishable from "unset" —
    // not implemented yet since no salon currently needs 0%.
    if (isValidPercent(override) && override > 0) {
      return override;
    }
    return getGlobalDefaultRate();
  },

  /**
   * Full commission breakdown for a booking amount.
   * Rounding: Math.round() (round-half-up to nearest paisa) — see
   * ROUNDING POLICY note above. commissionInPaise + payoutInPaise
   * always equals amountInPaise exactly.
   * @param {object} params
   * @param {number} params.amountInPaise — total booking amount
   * @param {object} params.salon — Salon document/lean object
   * @returns {Promise<{ ratePercent: number, commissionInPaise: number, payoutInPaise: number }>}
   */
  calculate: async ({ amountInPaise, salon }) => {
    const ratePercent = await CommissionService.getRatePercent(salon);
    const commissionInPaise = Math.round(amountInPaise * (ratePercent / 100));
    const payoutInPaise = amountInPaise - commissionInPaise;
    return { ratePercent, commissionInPaise, payoutInPaise };
  },

  /**
   * Refund-specific commission breakdown — same rate resolution as
   * calculate(), applied to a refund amount rather than the full
   * booking amount. Used by cancelBooking to determine how much of
   * a refund's value should be clawed back from the salon's pending
   * balance (the commission portion was never the salon's to begin
   * with, so only the net-of-commission amount is deducted).
   * @param {object} params
   * @param {number} params.refundInPaise — refund amount for this cancellation
   * @param {object} params.salon
   * @returns {Promise<{ ratePercent: number, commissionInPaise: number, salonDeductionInPaise: number }>}
   */
  calculateRefund: async ({ refundInPaise, salon }) => {
    const ratePercent = await CommissionService.getRatePercent(salon);
    const commissionInPaise = Math.round(refundInPaise * (ratePercent / 100));
    const salonDeductionInPaise = refundInPaise - commissionInPaise;
    return { ratePercent, commissionInPaise, salonDeductionInPaise };
  },

  /**
   * Clears the in-memory default-rate cache — call after an admin
   * updates AppSetting.DEFAULT_COMMISSION_RATE so the new rate takes
   * effect immediately rather than waiting out the TTL.
   */
  clearCache: () => {
    cache.rate = null;
    cache.expiresAt = 0;
  },
};

export default Object.freeze(CommissionService);