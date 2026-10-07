/**
 * BARBER ENGINE V1
 * backend/modules/finance/constants/refundPolicy.constants.js
 *
 * Global Refund & Cancellation Policy — this module's own vocabulary.
 * Same DRAFT -> PUBLISHED -> RETIRED lifecycle already proven by
 * GstPolicyVersion / AreaPlatformFeePolicy / TerritoryRevenueSettings.
 * At most one PUBLISHED version exists at a time — enforced via a
 * partial unique index on RefundPolicyVersion (see the model), never
 * here.
 *
 * Isolated bounded context: does not import or extend
 * CommercialPolicyVersion / AreaPlatformFeePolicy / GstPolicyVersion —
 * this is a standalone RefundPolicyVersion model per the locked
 * requirement that it never be merged into any of those.
 */

export const REFUND_POLICY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Structural validation bounds only — never business policy. The
// actual minMinutes/maxMinutes/cancellationPercent values of each
// rule are always admin-configured. cancellationPercent is the
// CANCELLATION/RETENTION percentage, NOT the customer refund
// percentage — see RefundPolicyVersion.js's own header.
export const CANCELLATION_PERCENT_MIN = 0;
export const CANCELLATION_PERCENT_MAX = 100;
export const REFUND_POLICY_MAX_RULES = 20;
