/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/FinanceExportDataService.js
 *
 * STEP 7.4 — Finance Export Engine. READ-ONLY, aggregation/query only —
 * same discipline as FinanceDashboardKPIService.js (STEP 7.1) and
 * FinanceAnalyticsService.js (STEP 7.2): every export here is a plain
 * `.find()`/`.aggregate()` read. Nothing in this file writes to
 * Razorpay, the Refund Engine, WalletBalanceService, RevenueSplit,
 * GSTLedger, or the Booking flow.
 *
 * "Do NOT modify Finance Analytics" (this step's own explicit rule) —
 * FinanceAnalyticsService.js and FinanceDashboardKPIService.js are
 * NEITHER imported for writing NOR edited anywhere in this file. The
 * one exception, exactly as the ticket asks ("Use only existing APIs
 * and read-only services"): the Finance Summary report REUSES
 * getFinanceDashboardKPIs() (STEP 7.1) verbatim, unmodified, as a
 * plain read-only function call — not a re-derivation of its logic.
 *
 * Row-level Revenue/GST/Salon-Payout/Agent-Payout data does not exist
 * in either STEP 7.1 or 7.2 (both are bucketed trend/aggregate-only) —
 * this file adds NEW, independent, arbitrary-date-range queries
 * against the same underlying collections those steps already read,
 * following the exact same "which collection is authoritative" audit
 * conclusions STEP 7.2 already established (see the Agent Payout /
 * Territory-source notes below) without re-deriving them differently.
 */

import RevenueSplit from "../models/RevenueSplit.js";
import GSTLedger from "../models/GSTLedger.js";
import PayoutRequest from "../../../models/PayoutRequest.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import FieldAgentPayoutRequest from "../../fieldAgent/models/FieldAgentPayoutRequest.js";
import { GST_LEDGER_TYPE } from "../constants/gstLedger.constants.js";
import { PAYOUT_ENTITY_TYPE } from "../../payout/constants/genericPayoutRequest.constants.js";
import { COMMERCIAL_PATH } from "../../fieldAgent/constants/fieldAgent.constants.js";
import { getFinanceDashboardKPIs } from "./FinanceDashboardKPIService.js"; // STEP 7.1 — reused, unmodified

/** Inclusive [from, to] range — `to` extended to end-of-day so a caller passing only a date (no time) still gets that whole day. */
export const resolveDateRange = ({ from, to }) => {
  const fromDate = from ? new Date(from) : new Date(0);
  const toDate = to ? new Date(to) : new Date();
  // Extend `to` to the end of that calendar day when it looks like a
  // bare date (00:00:00 UTC) — the common case for a "From/To" date
  // picker — without silently overriding a caller who already passed a
  // precise timestamp.
  const toEndOfDay = toDate.getUTCHours() === 0 && toDate.getUTCMinutes() === 0 && toDate.getUTCSeconds() === 0
    ? new Date(toDate.getTime() + 24 * 3600 * 1000 - 1)
    : toDate;
  return { fromDate, toDate: toEndOfDay };
};

// ═══════════════════════════════════════════════════════════════════
// 1 — REVENUE REPORT (RevenueSplit, the LOCKED per-booking finance
// record — read-only, exactly as every other reader treats it).
// ═══════════════════════════════════════════════════════════════════
export const getRevenueReport = async ({ from, to }) => {
  const { fromDate, toDate } = resolveDateRange({ from, to });
  const rows = await RevenueSplit.find({ createdAt: { $gte: fromDate, $lte: toDate } })
    .select("bookingId createdAt serviceAmountInPaise platformFeeInPaise gstRatePercent gstAmountInPaise customerPaidInPaise salonCreditInPaise zemishRevenueInPaise policyVersion")
    .sort({ createdAt: 1 })
    .lean();

  const summary = rows.reduce((acc, r) => ({
    serviceAmountInPaise: acc.serviceAmountInPaise + r.serviceAmountInPaise,
    platformFeeInPaise: acc.platformFeeInPaise + r.platformFeeInPaise,
    gstAmountInPaise: acc.gstAmountInPaise + r.gstAmountInPaise,
    customerPaidInPaise: acc.customerPaidInPaise + r.customerPaidInPaise,
    salonCreditInPaise: acc.salonCreditInPaise + r.salonCreditInPaise,
    zemishRevenueInPaise: acc.zemishRevenueInPaise + r.zemishRevenueInPaise,
  }), { serviceAmountInPaise: 0, platformFeeInPaise: 0, gstAmountInPaise: 0, customerPaidInPaise: 0, salonCreditInPaise: 0, zemishRevenueInPaise: 0 });

  return { from: fromDate, to: toDate, rowCount: rows.length, summary, rows };
};

// ═══════════════════════════════════════════════════════════════════
// 2 — GST REPORT (GSTLedger, net = SALE − REFUND_REVERSAL). No
// modification to GSTReportService.js/GSTLedger.js — an independent
// read against the same collection.
// ═══════════════════════════════════════════════════════════════════
export const getGstReport = async ({ from, to }) => {
  const { fromDate, toDate } = resolveDateRange({ from, to });
  const rows = await GSTLedger.find({ invoiceDate: { $gte: fromDate, $lte: toDate } })
    .select("bookingId ledgerType status taxableValueInPaise gstRate gstAmountInPaise platformFeeInPaise invoiceDate policyVersion refundId")
    .sort({ invoiceDate: 1 })
    .lean();

  const collected = rows.filter((r) => r.ledgerType === GST_LEDGER_TYPE.SALE).reduce((s, r) => s + r.gstAmountInPaise, 0);
  const reversed = rows.filter((r) => r.ledgerType === GST_LEDGER_TYPE.REFUND_REVERSAL).reduce((s, r) => s + r.gstAmountInPaise, 0);

  return { from: fromDate, to: toDate, rowCount: rows.length, summary: { gstCollectedInPaise: collected, gstReversedInPaise: reversed, netGstInPaise: collected - reversed }, rows };
};

// ═══════════════════════════════════════════════════════════════════
// 3 — SALON PAYOUT REPORT. Sums PAID rows across BOTH coexisting
// systems (legacy PayoutRequest + GenericPayoutRequest[SALON]) —
// mirrors FinanceDashboardKPIService.js's own "Salon Paid" reasoning
// (STEP 7.1), reused as a conclusion, not by importing that file.
// Grouped by `updatedAt` as the paid-date proxy — same documented
// approximation as STEP 7.2's Salon Payout Trend, for the same reason
// (neither model has a dedicated paidAt field).
// ═══════════════════════════════════════════════════════════════════
export const getSalonPayoutReport = async ({ from, to }) => {
  const { fromDate, toDate } = resolveDateRange({ from, to });
  const match = { status: "PAID", updatedAt: { $gte: fromDate, $lte: toDate } };

  const [legacyRows, genericRows] = await Promise.all([
    PayoutRequest.find(match).select("salonId amountInPaise status payoutProvider utr updatedAt createdAt").sort({ updatedAt: 1 }).lean(),
    GenericPayoutRequest.find({ ...match, entityType: PAYOUT_ENTITY_TYPE.SALON }).select("entityId amountInPaise status payoutProvider utr updatedAt createdAt").sort({ updatedAt: 1 }).lean(),
  ]);

  const rows = [
    ...legacyRows.map((r) => ({ source: "PAYOUT_REQUEST", salonId: r.salonId, amountInPaise: r.amountInPaise, status: r.status, provider: r.payoutProvider, utr: r.utr, paidAt: r.updatedAt, createdAt: r.createdAt })),
    ...genericRows.map((r) => ({ source: "GENERIC_PAYOUT_REQUEST", salonId: r.entityId, amountInPaise: r.amountInPaise, status: r.status, provider: r.payoutProvider, utr: r.utr, paidAt: r.updatedAt, createdAt: r.createdAt })),
  ].sort((a, b) => a.paidAt - b.paidAt);

  const summary = { totalPaidInPaise: rows.reduce((s, r) => s + r.amountInPaise, 0), count: rows.length };
  return { from: fromDate, to: toDate, rowCount: rows.length, summary, rows };
};

// ═══════════════════════════════════════════════════════════════════
// 4 — AGENT PAYOUT REPORT. FieldAgentPayoutRequest (joined to
// FieldAgent.commercialPath, exactly as STEP 7.1's own "Acquisition
// Paid"/"Territory Paid" split does) + GenericPayoutRequest[ACQUISITION_
// AGENT|TERRITORY_PARTNER] — same dual-system reasoning as the Salon
// report above.
// ═══════════════════════════════════════════════════════════════════
export const getAgentPayoutReport = async ({ from, to }) => {
  const { fromDate, toDate } = resolveDateRange({ from, to });

  const legacyRows = await FieldAgentPayoutRequest.aggregate([
    { $match: { status: "PAID", updatedAt: { $gte: fromDate, $lte: toDate } } },
    { $lookup: { from: "fieldagents", localField: "fieldAgentRef", foreignField: "_id", as: "agent" } },
    { $unwind: "$agent" },
    { $project: { fieldAgentRef: 1, amountInPaise: 1, status: 1, payoutProvider: 1, utr: 1, updatedAt: 1, createdAt: 1, commercialPath: "$agent.commercialPath" } },
  ]);

  const genericRows = await GenericPayoutRequest.find({
    status: "PAID",
    updatedAt: { $gte: fromDate, $lte: toDate },
    entityType: { $in: [PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER] },
  }).select("entityId entityType amountInPaise status payoutProvider utr updatedAt createdAt").lean();

  const rows = [
    ...legacyRows.map((r) => ({ source: "FIELD_AGENT_PAYOUT_REQUEST", fieldAgentRef: r.fieldAgentRef, commercialPath: r.commercialPath, amountInPaise: r.amountInPaise, status: r.status, provider: r.payoutProvider, utr: r.utr, paidAt: r.updatedAt, createdAt: r.createdAt })),
    ...genericRows.map((r) => ({ source: "GENERIC_PAYOUT_REQUEST", fieldAgentRef: r.entityId, commercialPath: r.entityType, amountInPaise: r.amountInPaise, status: r.status, provider: r.payoutProvider, utr: r.utr, paidAt: r.updatedAt, createdAt: r.createdAt })),
  ].sort((a, b) => a.paidAt - b.paidAt);

  const acquisitionTotalInPaise = rows.filter((r) => r.commercialPath === COMMERCIAL_PATH.ACQUISITION_AGENT).reduce((s, r) => s + r.amountInPaise, 0);
  const territoryTotalInPaise = rows.filter((r) => r.commercialPath === COMMERCIAL_PATH.TERRITORY_PARTNER).reduce((s, r) => s + r.amountInPaise, 0);

  return {
    from: fromDate, to: toDate, rowCount: rows.length,
    summary: { acquisitionTotalInPaise, territoryTotalInPaise, totalPaidInPaise: acquisitionTotalInPaise + territoryTotalInPaise, count: rows.length },
    rows,
  };
};

// ═══════════════════════════════════════════════════════════════════
// 5 — FINANCE SUMMARY. Current-snapshot KPIs (reused verbatim from
// STEP 7.1, unmodified) + date-ranged totals for the requested window
// (reusing the four report functions above, summary-only — row lists
// are not duplicated into this report).
// ═══════════════════════════════════════════════════════════════════
export const getFinanceSummaryReport = async ({ from, to }) => {
  const [kpis, revenue, gst, salonPayout, agentPayout] = await Promise.all([
    getFinanceDashboardKPIs(), // STEP 7.1 — unmodified, read-only call
    getRevenueReport({ from, to }),
    getGstReport({ from, to }),
    getSalonPayoutReport({ from, to }),
    getAgentPayoutReport({ from, to }),
  ]);

  return {
    from: revenue.from,
    to: revenue.to,
    currentKpis: kpis,
    periodTotals: {
      revenue: revenue.summary,
      gst: gst.summary,
      salonPayout: salonPayout.summary,
      agentPayout: agentPayout.summary,
    },
  };
};
