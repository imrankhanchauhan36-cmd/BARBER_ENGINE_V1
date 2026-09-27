/**
 * BARBER ENGINE V1
 * backend/modules/finance/constants/financeExport.constants.js
 *
 * STEP 7.4 — Finance Export Engine. This module's own vocabulary — a
 * NEW, standalone bounded context inside modules/finance, additive
 * only. Does not modify revenue.constants.js, gstLedger.constants.js,
 * or any other existing constants file.
 */

export const EXPORT_FORMAT = Object.freeze({
  XLSX: "XLSX",
  CSV: "CSV",
  PDF: "PDF",
  JSON: "JSON",
});

export const EXPORT_REPORT_TYPE = Object.freeze({
  REVENUE: "REVENUE",
  GST: "GST",
  SALON_PAYOUT: "SALON_PAYOUT",
  AGENT_PAYOUT: "AGENT_PAYOUT",
  SUMMARY: "SUMMARY",
});
