/**
 * BARBER ENGINE V1
 * backend/modules/finance/dto/gstLedger.dto.js
 *
 * P0 Revenue Calculation Engine — Step 4.1. Shapes a GSTLedger document
 * for display/reporting (paise -> rupees), same one-way conversion
 * convention already used by modules/finance/dto/revenue.dto.js. Pure
 * mapping only — no DB access, no calculation.
 */

const paiseToRupees = (paise) => (paise == null ? null : Math.round(paise) / 100);

export const toGSTLedgerDTO = (ledger) => {
  if (!ledger) return null;
  return {
    id: ledger._id,
    bookingId: ledger.bookingId,
    revenueSplitId: ledger.revenueSplitId,
    ledgerType: ledger.ledgerType,
    status: ledger.status,
    taxableValue: paiseToRupees(ledger.taxableValueInPaise),
    gstRate: ledger.gstRate,
    gstAmount: paiseToRupees(ledger.gstAmountInPaise),
    platformFee: paiseToRupees(ledger.platformFeeInPaise),
    invoiceDate: ledger.invoiceDate ?? null,
    policyVersion: ledger.policyVersion,
    createdAt: ledger.createdAt ?? null,
  };
};

export const toGSTLedgerListDTO = (ledgers) => ledgers.map(toGSTLedgerDTO);
