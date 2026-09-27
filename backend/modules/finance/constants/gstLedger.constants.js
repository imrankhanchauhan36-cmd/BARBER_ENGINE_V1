/**
 * BARBER ENGINE V1
 * backend/modules/finance/constants/gstLedger.constants.js
 *
 * P0 Revenue Calculation Engine — Step 4.1 (GST Ledger Engine). This
 * module's own vocabulary — a NEW, standalone bounded context inside
 * modules/finance, additive only. Does not modify
 * revenue.constants.js (Step 1) in any way.
 */

// A GST ledger row's kind. SALE is created once per RevenueSplit
// (Step 4.1, this file's own service). REFUND_REVERSAL is a SEPARATE,
// later row type — reserved here so the schema/enum already has a home
// for it, but THIS step creates SALE rows only (see
// GSTLedgerService.js's own header: "No Refund").
export const GST_LEDGER_TYPE = Object.freeze({
  SALE: "SALE",
  REFUND_REVERSAL: "REFUND_REVERSAL",
});

// A ledger row's status is set ONCE, at creation, and never changes
// (the row itself is immutable — see GSTLedger.js). COLLECTED is what a
// SALE row is created as; REVERSED is what a (future) REFUND_REVERSAL
// row would be created as. Never a transition on an existing row.
export const GST_LEDGER_STATUS = Object.freeze({
  COLLECTED: "COLLECTED",
  REVERSED: "REVERSED",
});
