/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminFinanceExport.controller.js
 *
 * STEP 7.4 — Finance Export Engine. Fetches via FinanceExportDataService
 * (read-only), shapes into {title, columns, rows, summaryLines} for
 * display (paise -> rupees, same one-way conversion convention as
 * every other admin-facing DTO in this codebase), then renders via
 * FinanceExportRenderService for the requested format. JSON is the one
 * exception — it returns the RAW paise data untouched, for programmatic
 * consumers, never the display-shaped version.
 */

import {
  getRevenueReport,
  getGstReport,
  getSalonPayoutReport,
  getAgentPayoutReport,
  getFinanceSummaryReport,
} from "../services/FinanceExportDataService.js";
import { renderExcelBuffer, renderCsvString, renderPdfBuffer } from "../services/FinanceExportRenderService.js";
import { successResponse } from "../../../utils/response.js";

const p2r = (paise) => Math.round((paise ?? 0)) / 100;
const rupeeStr = (paise) => `₹${p2r(paise).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sendFile = async (res, { format, title, columns, rows, summaryLines, filenameBase }) => {
  const fmt = String(format || "JSON").toUpperCase();
  if (fmt === "XLSX") {
    const buffer = await renderExcelBuffer({ title, columns, rows, summaryLines });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(Buffer.from(buffer));
  }
  if (fmt === "CSV") {
    const csv = renderCsvString({ columns, rows });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
    return res.send(csv);
  }
  if (fmt === "PDF") {
    const buffer = await renderPdfBuffer({ title, columns, rows, summaryLines });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
    return res.send(buffer);
  }
  return null; // JSON handled by the caller with the raw (non-display) data
};

const REVENUE_COLUMNS = [
  { header: "Booking ID", key: "bookingId" },
  { header: "Date", key: "date" },
  { header: "Service Amount", key: "serviceAmount" },
  { header: "Platform Fee", key: "platformFee" },
  { header: "GST Rate %", key: "gstRatePercent" },
  { header: "GST Amount", key: "gstAmount" },
  { header: "Customer Paid", key: "customerPaid" },
  { header: "Salon Credit", key: "salonCredit" },
  { header: "Zemish Revenue", key: "zemishRevenue" },
  { header: "Policy Version", key: "policyVersion" },
];

export const exportRevenueReportHandler = async (req, res, next) => {
  try {
    const { from, to, format } = req.query;
    const report = await getRevenueReport({ from, to });
    if (String(format || "").toUpperCase() === "JSON" || !format) {
      return successResponse(res, { message: "Revenue report fetched", data: report });
    }
    const rows = report.rows.map((r) => ({
      bookingId: String(r.bookingId), date: r.createdAt?.toISOString().slice(0, 10),
      serviceAmount: rupeeStr(r.serviceAmountInPaise), platformFee: rupeeStr(r.platformFeeInPaise),
      gstRatePercent: r.gstRatePercent, gstAmount: rupeeStr(r.gstAmountInPaise),
      customerPaid: rupeeStr(r.customerPaidInPaise), salonCredit: rupeeStr(r.salonCreditInPaise),
      zemishRevenue: rupeeStr(r.zemishRevenueInPaise), policyVersion: r.policyVersion,
    }));
    const summaryLines = [
      `Total Customer Paid: ${rupeeStr(report.summary.customerPaidInPaise)}`,
      `Total Zemish Revenue: ${rupeeStr(report.summary.zemishRevenueInPaise)}`,
      `Total Salon Credit: ${rupeeStr(report.summary.salonCreditInPaise)}`,
      `Total GST: ${rupeeStr(report.summary.gstAmountInPaise)}`,
    ];
    return sendFile(res, { format, title: "Revenue Report", columns: REVENUE_COLUMNS, rows, summaryLines, filenameBase: "revenue-report" });
  } catch (err) {
    return next(err);
  }
};

const GST_COLUMNS = [
  { header: "Booking ID", key: "bookingId" },
  { header: "Type", key: "ledgerType" },
  { header: "Status", key: "status" },
  { header: "Taxable Value", key: "taxableValue" },
  { header: "GST Rate %", key: "gstRate" },
  { header: "GST Amount", key: "gstAmount" },
  { header: "Invoice Date", key: "invoiceDate" },
  { header: "Refund ID", key: "refundId" },
];

export const exportGstReportHandler = async (req, res, next) => {
  try {
    const { from, to, format } = req.query;
    const report = await getGstReport({ from, to });
    if (String(format || "").toUpperCase() === "JSON" || !format) {
      return successResponse(res, { message: "GST report fetched", data: report });
    }
    const rows = report.rows.map((r) => ({
      bookingId: String(r.bookingId), ledgerType: r.ledgerType, status: r.status,
      taxableValue: rupeeStr(r.taxableValueInPaise), gstRate: r.gstRate, gstAmount: rupeeStr(r.gstAmountInPaise),
      invoiceDate: r.invoiceDate?.toISOString().slice(0, 10), refundId: r.refundId || "",
    }));
    const summaryLines = [
      `GST Collected: ${rupeeStr(report.summary.gstCollectedInPaise)}`,
      `GST Reversed: ${rupeeStr(report.summary.gstReversedInPaise)}`,
      `Net GST Liability: ${rupeeStr(report.summary.netGstInPaise)}`,
    ];
    return sendFile(res, { format, title: "GST Report", columns: GST_COLUMNS, rows, summaryLines, filenameBase: "gst-report" });
  } catch (err) {
    return next(err);
  }
};

const SALON_PAYOUT_COLUMNS = [
  { header: "Source", key: "source" },
  { header: "Salon ID", key: "salonId" },
  { header: "Amount", key: "amount" },
  { header: "Status", key: "status" },
  { header: "Provider", key: "provider" },
  { header: "UTR", key: "utr" },
  { header: "Paid At", key: "paidAt" },
];

export const exportSalonPayoutReportHandler = async (req, res, next) => {
  try {
    const { from, to, format } = req.query;
    const report = await getSalonPayoutReport({ from, to });
    if (String(format || "").toUpperCase() === "JSON" || !format) {
      return successResponse(res, { message: "Salon payout report fetched", data: report });
    }
    const rows = report.rows.map((r) => ({
      source: r.source, salonId: String(r.salonId), amount: rupeeStr(r.amountInPaise), status: r.status,
      provider: r.provider, utr: r.utr || "", paidAt: r.paidAt?.toISOString().slice(0, 10),
    }));
    const summaryLines = [`Total Paid: ${rupeeStr(report.summary.totalPaidInPaise)}`, `Count: ${report.summary.count}`];
    return sendFile(res, { format, title: "Salon Payout Report", columns: SALON_PAYOUT_COLUMNS, rows, summaryLines, filenameBase: "salon-payout-report" });
  } catch (err) {
    return next(err);
  }
};

const AGENT_PAYOUT_COLUMNS = [
  { header: "Source", key: "source" },
  { header: "Field Agent ID", key: "fieldAgentRef" },
  { header: "Commercial Path", key: "commercialPath" },
  { header: "Amount", key: "amount" },
  { header: "Status", key: "status" },
  { header: "Provider", key: "provider" },
  { header: "UTR", key: "utr" },
  { header: "Paid At", key: "paidAt" },
];

export const exportAgentPayoutReportHandler = async (req, res, next) => {
  try {
    const { from, to, format } = req.query;
    const report = await getAgentPayoutReport({ from, to });
    if (String(format || "").toUpperCase() === "JSON" || !format) {
      return successResponse(res, { message: "Agent payout report fetched", data: report });
    }
    const rows = report.rows.map((r) => ({
      source: r.source, fieldAgentRef: String(r.fieldAgentRef), commercialPath: r.commercialPath,
      amount: rupeeStr(r.amountInPaise), status: r.status, provider: r.provider, utr: r.utr || "",
      paidAt: r.paidAt?.toISOString().slice(0, 10),
    }));
    const summaryLines = [
      `Acquisition Total: ${rupeeStr(report.summary.acquisitionTotalInPaise)}`,
      `Territory Total: ${rupeeStr(report.summary.territoryTotalInPaise)}`,
      `Grand Total: ${rupeeStr(report.summary.totalPaidInPaise)}`,
      `Count: ${report.summary.count}`,
    ];
    return sendFile(res, { format, title: "Agent Payout Report", columns: AGENT_PAYOUT_COLUMNS, rows, summaryLines, filenameBase: "agent-payout-report" });
  } catch (err) {
    return next(err);
  }
};

const SUMMARY_COLUMNS = [
  { header: "Metric", key: "metric" },
  { header: "Value", key: "value" },
];

export const exportFinanceSummaryHandler = async (req, res, next) => {
  try {
    const { from, to, format } = req.query;
    const report = await getFinanceSummaryReport({ from, to });
    if (String(format || "").toUpperCase() === "JSON" || !format) {
      return successResponse(res, { message: "Finance summary report fetched", data: report });
    }
    const rows = [
      { metric: "Zemish Holding (current)", value: rupeeStr(report.currentKpis.zemishHolding.holdingInPaise) },
      { metric: "Salon Liability (current)", value: rupeeStr(report.currentKpis.salonLiability.totalInPaise) },
      { metric: "Agent Liability (current)", value: rupeeStr(report.currentKpis.agentLiability.totalInPaise) },
      { metric: "GST Liability (current)", value: rupeeStr(report.currentKpis.gstLiability.netInPaise) },
      { metric: "Processing Payouts (current)", value: rupeeStr(report.currentKpis.processingPayoutsInPaise) },
      { metric: "Refund Exposure (current)", value: rupeeStr(report.currentKpis.refundExposure.totalInPaise) },
      { metric: "— Period Totals —", value: "" },
      { metric: "Revenue (Customer Paid)", value: rupeeStr(report.periodTotals.revenue.customerPaidInPaise) },
      { metric: "Zemish Revenue", value: rupeeStr(report.periodTotals.revenue.zemishRevenueInPaise) },
      { metric: "GST Net", value: rupeeStr(report.periodTotals.gst.netGstInPaise) },
      { metric: "Salon Paid", value: rupeeStr(report.periodTotals.salonPayout.totalPaidInPaise) },
      { metric: "Agent Paid", value: rupeeStr(report.periodTotals.agentPayout.totalPaidInPaise) },
    ];
    return sendFile(res, { format, title: "Finance Summary Report", columns: SUMMARY_COLUMNS, rows, summaryLines: [], filenameBase: "finance-summary-report" });
  } catch (err) {
    return next(err);
  }
};
