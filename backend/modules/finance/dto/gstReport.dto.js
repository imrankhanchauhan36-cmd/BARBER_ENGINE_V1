/**
 * BARBER ENGINE V1
 * backend/modules/finance/dto/gstReport.dto.js
 *
 * P0 Revenue Calculation Engine — Step 4.3. Shapes GSTReportService.js's
 * paise-based results into each of the three admin endpoints' own exact
 * field-name spec — the ticket gives /summary and /monthly two
 * DIFFERENT naming schemes for the same underlying numbers, so this file
 * keeps them as two distinct mappers rather than forcing one shared
 * shape. Amounts convert paise -> rupees for display, the same one-way
 * convention already used by revenue.dto.js / gstLedger.dto.js. Pure
 * mapping only — no DB access, no calculation (the arithmetic, e.g. net
 * = collected − reversed, already happened in GSTReportService.js).
 */

const paiseToRupees = (paise) => Math.round(paise || 0) / 100;

// GET /summary — { grossTaxableValue, gstCollected, gstReversed, netGSTLiability, bookingCount, refundCount }
export const toSummaryPeriodDTO = (period) => ({
  grossTaxableValue: paiseToRupees(period.grossTaxableValueInPaise),
  gstCollected: paiseToRupees(period.gstCollectedInPaise),
  gstReversed: paiseToRupees(period.gstReversedInPaise),
  netGSTLiability: paiseToRupees(period.netGSTLiabilityInPaise),
  bookingCount: period.bookingCount,
  refundCount: period.refundCount,
});

export const toSummaryReportDTO = ({ currentMonth, currentQuarter, currentYear }) => ({
  currentMonth: { year: currentMonth.year, month: currentMonth.month, monthName: currentMonth.monthName, ...toSummaryPeriodDTO(currentMonth) },
  currentQuarter: { year: currentQuarter.year, quarter: currentQuarter.quarter, ...toSummaryPeriodDTO(currentQuarter) },
  currentYear: { year: currentYear.year, ...toSummaryPeriodDTO(currentYear) },
});

// GET /monthly?year= — each month: { taxable, collected, reversed, net, bookings, refunds }
export const toMonthlyRowDTO = (m) => ({
  month: m.month,
  monthName: m.monthName,
  taxable: paiseToRupees(m.grossTaxableValueInPaise),
  collected: paiseToRupees(m.gstCollectedInPaise),
  reversed: paiseToRupees(m.gstReversedInPaise),
  net: paiseToRupees(m.netGSTLiabilityInPaise),
  bookings: m.bookingCount,
  refunds: m.refundCount,
});

export const toMonthlyReportDTO = ({ year, months, quarters, yearTotal }) => ({
  year,
  months: months.map(toMonthlyRowDTO),
  quarters: quarters.map((q) => ({ quarter: q.quarter, ...toMonthlyRowDTO(q) })),
  yearTotal: toMonthlyRowDTO(yearTotal),
});

// GET /export?month=&year= — export-ready structure (JSON only, no PDF/CSV)
const toLineItemDTO = (row) => ({
  id: row._id,
  bookingId: row.bookingId,
  revenueSplitId: row.revenueSplitId,
  ledgerType: row.ledgerType,
  status: row.status,
  taxableValue: paiseToRupees(row.taxableValueInPaise),
  gstRate: row.gstRate,
  gstAmount: paiseToRupees(row.gstAmountInPaise),
  platformFee: paiseToRupees(row.platformFeeInPaise),
  invoiceDate: row.invoiceDate,
  policyVersion: row.policyVersion,
  refundId: row.refundId ?? null,
});

export const toExportReportDTO = ({ period, generatedAt, summary, lineItems }) => ({
  period,
  generatedAt,
  summary: toMonthlyRowDTO(summary),
  lineItems: lineItems.map(toLineItemDTO),
});
