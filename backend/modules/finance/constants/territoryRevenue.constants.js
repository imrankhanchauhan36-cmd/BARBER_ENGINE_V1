/**
 * BARBER ENGINE V1
 * backend/modules/finance/constants/territoryRevenue.constants.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine. This module's own
 * vocabulary. Deliberately a NEW, standalone bounded context inside
 * modules/finance — NOT an extension of modules/finance/constants/
 * revenue.constants.js (the PAN-India customer-pricing engine, a
 * different concept) and NOT of
 * modules/fieldAgent/constants/commercialPolicy.constants.js (which
 * already owns a live territoryPartnerCommissionPercent field on
 * CommercialPolicyVersion — see the STEP 5.1 read-only audit's
 * "Architectural Blockers" section for the full disclosure of that
 * conceptual overlap). This ticket explicitly asked for a completely
 * isolated module, so this file defines its own vocabulary rather than
 * importing either of those.
 *
 * DRAFT -> PUBLISHED -> RETIRED, the same lifecycle already proven by
 * GstPolicyVersion / AreaPlatformFeePolicy / CommercialPolicyVersion /
 * modules/finance/models/RevenueSettings.js. At most one PUBLISHED
 * version exists at a time — enforced via a partial unique index on
 * TerritoryRevenueSettings (see the model), never here.
 */

export const TERRITORY_REVENUE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Structural validation bounds only — never business policy. The actual
// territoryCommissionPercent / minimumPayoutInPaise values are always
// admin-configured (config-driven, not hardcoded), matching
// revenue.constants.js's own discipline.
export const TERRITORY_COMMISSION_MIN_PERCENT = 0;
export const TERRITORY_COMMISSION_MAX_PERCENT = 100;
export const TERRITORY_MINIMUM_PAYOUT_MIN_PAISE = 0;
