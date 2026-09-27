/**
 * BARBER ENGINE V1
 * backend/modules/finance/constants/territoryRevenueDistribution.constants.js
 *
 * STEP 5.3 — Territory Revenue Distribution Engine. This module's own
 * vocabulary — a NEW, standalone bounded context inside modules/finance,
 * additive only. Mirrors gstLedger.constants.js's own SALE/
 * REFUND_REVERSAL vocabulary exactly (same "reuse existing finance
 * architecture" instruction), applied to Territory Partner commission
 * instead of GST. Does not modify revenue.constants.js, gstLedger.
 * constants.js, or territoryRevenue.constants.js (STEP 5.1) in any way.
 */

// A ledger row's kind. SALE is created once per TerritoryRevenueSplit
// (right after the booking's RevenueSplit is created). REFUND_REVERSAL
// is a proportional reversal row created when a refund on that same
// booking is PROCESSED — see TerritoryRevenueService.js.
export const TERRITORY_REVENUE_LEDGER_TYPE = Object.freeze({
  SALE: "SALE",
  REFUND_REVERSAL: "REFUND_REVERSAL",
});

// A ledger row's status is set ONCE, at creation, and never changes
// (the row itself is immutable). CREDITED is what a SALE row is created
// as — money Zemish now owes this Territory Partner, held internally
// until a (future, out-of-scope-for-this-engine) payout request; no
// automatic bank transfer ever happens here. REVERSED is what a
// REFUND_REVERSAL row is created as.
export const TERRITORY_REVENUE_LEDGER_STATUS = Object.freeze({
  CREDITED: "CREDITED",
  REVERSED: "REVERSED",
});
