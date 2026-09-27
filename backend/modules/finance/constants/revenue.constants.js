/**
 * BARBER ENGINE V1
 * backend/modules/finance/constants/revenue.constants.js
 *
 * P0 Revenue Calculation Engine — Step 1. This module's own vocabulary.
 * Deliberately a NEW, standalone bounded context — not an extension of
 * modules/fieldAgent's commercialPolicy.constants.js (that governs
 * acquisition/territory commercial terms, a different domain) and not of
 * models/GstPolicyVersion.js / models/AreaPlatformFeePolicy.js (the
 * existing, still-untouched booking-lockSlot GST/fee config this engine
 * does not read from or write to in this step).
 *
 * LOCKED architecture rule (see RevenueCalculationService.js's own header):
 * the Calculation Engine never touches Wallet/Ledger; the Settlement Engine
 * (a later step) never calculates a formula. This file only defines shared
 * vocabulary for that calculation layer.
 */

// DRAFT -> PUBLISHED -> RETIRED, the same lifecycle already proven by
// GstPolicyVersion / AreaPlatformFeePolicy / CommercialPolicyVersion.
// Published/retired are immutable (enforced in the future
// RevenueSettingsService, never here). At most one PUBLISHED version
// exists at a time — enforced via a partial unique index on
// RevenueSettings (see the model).
export const REVENUE_SETTINGS_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Structural validation bounds — never business policy (the actual
// platformFeeInPaise / gstRate values are always admin-configured, per
// the LOCKED "config-driven, not hardcoded" rule). Mirrors the exact
// bounds discipline commercialPolicy.constants.js already documents for
// itself.
export const PLATFORM_FEE_MIN_PAISE = 0;
export const GST_RATE_MIN_PERCENT = 0;
export const GST_RATE_MAX_PERCENT = 100;
export const MINIMUM_PAYOUT_MIN_PAISE = 0;

// FIRST-RUN DEFAULT ONLY — used exactly once, the very first time a
// RevenueSettings version is ever created and no prior version exists to
// carry values forward from. Every subsequent version is either an
// explicit admin value or the prior PUBLISHED version's own value —
// never silently reset to this constant again. Mirrors
// commercialPolicy.constants.js's own FIRST_RUN_DEFAULTS precedent
// (revenueConfig.service.js) for the identical reason: a real, config-
// driven number has to start somewhere, and "somewhere" must be
// documented, not buried in a service function.
export const FIRST_RUN_DEFAULT_MINIMUM_PAYOUT_PAISE = 50000; // ₹500 — matches the LOCKED example value
