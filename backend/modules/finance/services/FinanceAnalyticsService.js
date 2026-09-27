/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/FinanceAnalyticsService.js
 *
 * STEP 7.2 — Finance Analytics Engine. READ-ONLY, aggregation only —
 * mirrors FinanceDashboardKPIService.js's own discipline exactly: every
 * export here is a plain `.aggregate()` read; nothing in this file ever
 * writes to Razorpay, the Refund Engine, WalletBalanceService,
 * RevenueSplit, GSTLedger, or the Booking flow — none of those are
 * imported for writing, only read.
 *
 * ═══ AUDIT FINDING (STEP 7.2's own audit, load-bearing for chart 6) ═══
 * "Territory Earnings Trend" MUST read from
 * modules/finance/models/TerritoryRevenueLedger.js (STEP 5.3), NEVER
 * from modules/fieldAgent/models/FieldAgentEarningLedger.js's own
 * entitlementType:TERRITORY_PARTNER rows. STEP 6.1's own Territory
 * Decision Gate retired that old generation path — no NEW
 * TERRITORY_PARTNER row has been written to FieldAgentEarningLedger
 * since that migration, so a trend chart reading it would silently go
 * flat/dead after the cutover date, misrepresenting current Territory
 * Partner activity as zero. TerritoryRevenueLedger is the sole
 * authoritative source going forward, per that migration's own
 * decision — this file reuses that same conclusion, not a new one.
 *
 * "Acquisition Earnings Trend", by contrast, correctly DOES read
 * FieldAgentEarningLedger (entitlementType:ACQUISITION) — that path was
 * explicitly, deliberately left unchanged by STEP 6.1 and remains the
 * one and only Acquisition earning source today.
 *
 * "Salon Payout Trend" reads BOTH models/PayoutRequest.js (legacy) AND
 * modules/payout/models/GenericPayoutRequest.js (STEP 6.3/6.4), exactly
 * mirroring FinanceDashboardKPIService.js's own "Salon Paid" reasoning
 * — both are live systems for the same salon-payout concept, so both
 * must be counted, not just one. Grouped by `updatedAt` — a documented
 * APPROXIMATION for "when this payout was confirmed PAID", since
 * neither model has a dedicated paidAt/confirmedAt timestamp; this
 * matches this codebase's own precedent of accepting updatedAt as an
 * event-time proxy where no dedicated field exists, and is flagged
 * here exactly as it should be flagged for anyone tightening it later.
 */

import RevenueSplit from "../models/RevenueSplit.js";
import GSTLedger from "../models/GSTLedger.js";
import PayoutRequest from "../../../models/PayoutRequest.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import FieldAgentEarningLedger from "../../fieldAgent/models/FieldAgentEarningLedger.js";
import TerritoryRevenueLedger from "../models/TerritoryRevenueLedger.js";
import { GST_LEDGER_TYPE } from "../constants/gstLedger.constants.js";
import { PAYOUT_ENTITY_TYPE } from "../../payout/constants/genericPayoutRequest.constants.js";
import { EARNING_ENTITLEMENT_TYPE, EARNING_CREDIT_OUTCOME } from "../../fieldAgent/constants/fieldAgentEarning.constants.js";
import { TERRITORY_REVENUE_LEDGER_TYPE } from "../constants/territoryRevenueDistribution.constants.js";

// ── Date-bucket helpers (UTC calendar days/months, zero-filled — never
// omit a period just because it had no activity, same discipline as
// GSTReportService.js's own getMonthlyTotals) ───────────────────────

const pad2 = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const monthKey = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;

/** Last `days` calendar days, oldest first, INCLUDING today. */
const buildDailySkeleton = (days) => {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 24 * 3600 * 1000);
    return { key: dayKey(d), date: dayKey(d) };
  });
};

/** Last `months` calendar months, oldest first, INCLUDING the current month. */
const buildMonthlySkeleton = (months) => {
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
    return { key: monthKey(d), month: monthKey(d) };
  });
};

const rangeStartFor = (granularity, { days, months }) => {
  const now = new Date();
  if (granularity === "daily") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
};

const dateFormatFor = (granularity) => (granularity === "daily" ? "%Y-%m-%d" : "%Y-%m");

const buildSkeleton = (granularity, { days, months }) =>
  granularity === "daily" ? buildDailySkeleton(days) : buildMonthlySkeleton(months);

// ═══════════════════════════════════════════════════════════════════
// CHART 1/2 — Daily / Monthly Revenue, from RevenueSplit (the LOCKED,
// immutable, per-booking finance record — read-only here, exactly as
// every other reader of this collection in this codebase treats it).
// ═══════════════════════════════════════════════════════════════════
const revenueTrend = async (granularity, opts) => {
  const start = rangeStartFor(granularity, opts);
  const rows = await RevenueSplit.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: {
        _id: { $dateToString: { format: dateFormatFor(granularity), date: "$createdAt" } },
        customerPaidInPaise: { $sum: "$customerPaidInPaise" },
        zemishRevenueInPaise: { $sum: "$zemishRevenueInPaise" },
        salonCreditInPaise: { $sum: "$salonCreditInPaise" },
        bookingCount: { $sum: 1 },
    } },
  ]);
  const byKey = new Map(rows.map((r) => [r._id, r]));
  return buildSkeleton(granularity, opts).map((bucket) => {
    const r = byKey.get(bucket.key);
    return {
      ...bucket,
      customerPaidInPaise: r?.customerPaidInPaise || 0,
      zemishRevenueInPaise: r?.zemishRevenueInPaise || 0,
      salonCreditInPaise: r?.salonCreditInPaise || 0,
      bookingCount: r?.bookingCount || 0,
    };
  });
};

/** Chart 1 — Daily Revenue (30 days, default). */
export const getDailyRevenueTrend = ({ days = 30 } = {}) => revenueTrend("daily", { days });

/** Chart 2 — Monthly Revenue (12 months, default). */
export const getMonthlyRevenueTrend = ({ months = 12 } = {}) => revenueTrend("monthly", { months });

// ═══════════════════════════════════════════════════════════════════
// CHART 3 — GST Collected Trend, from GSTLedger. Net per period =
// SALE − REFUND_REVERSAL, mirroring GSTReportService.js's own
// aggregation shape exactly, generalized to daily OR monthly (that
// existing service only ever does monthly/quarterly/yearly — this is a
// new, independent read, GSTReportService.js itself is not modified).
// ═══════════════════════════════════════════════════════════════════
export const getGstCollectedTrend = async ({ granularity = "monthly", days = 30, months = 12 } = {}) => {
  const start = rangeStartFor(granularity, { days, months });
  const rows = await GSTLedger.aggregate([
    { $match: { invoiceDate: { $gte: start } } },
    { $group: {
        _id: { period: { $dateToString: { format: dateFormatFor(granularity), date: "$invoiceDate" } }, ledgerType: "$ledgerType" },
        gstAmountInPaise: { $sum: "$gstAmountInPaise" },
    } },
  ]);
  const collectedByKey = new Map(rows.filter((r) => r._id.ledgerType === GST_LEDGER_TYPE.SALE).map((r) => [r._id.period, r.gstAmountInPaise]));
  const reversedByKey = new Map(rows.filter((r) => r._id.ledgerType === GST_LEDGER_TYPE.REFUND_REVERSAL).map((r) => [r._id.period, r.gstAmountInPaise]));
  return buildSkeleton(granularity, { days, months }).map((bucket) => {
    const collected = collectedByKey.get(bucket.key) || 0;
    const reversed = reversedByKey.get(bucket.key) || 0;
    return { ...bucket, gstCollectedInPaise: collected, gstReversedInPaise: reversed, netGstInPaise: collected - reversed };
  });
};

// ═══════════════════════════════════════════════════════════════════
// CHARTS 4/5/6 — bundled under one endpoint (/payouts): Salon Payout
// Trend, Acquisition Earnings Trend, Territory Earnings Trend.
// ═══════════════════════════════════════════════════════════════════

/** Chart 4 — Salon Payout Trend. See file header for the updatedAt-as-proxy caveat. */
const salonPayoutTrend = async (granularity, opts) => {
  const start = rangeStartFor(granularity, opts);
  const fmt = dateFormatFor(granularity);

  const [legacyRows, genericRows] = await Promise.all([
    PayoutRequest.aggregate([
      { $match: { status: "PAID", updatedAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: fmt, date: "$updatedAt" } }, total: { $sum: "$amountInPaise" } } },
    ]),
    GenericPayoutRequest.aggregate([
      { $match: { status: "PAID", entityType: PAYOUT_ENTITY_TYPE.SALON, updatedAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: fmt, date: "$updatedAt" } }, total: { $sum: "$amountInPaise" } } },
    ]),
  ]);
  const merged = new Map();
  for (const r of [...legacyRows, ...genericRows]) merged.set(r._id, (merged.get(r._id) || 0) + r.total);
  return buildSkeleton(granularity, opts).map((bucket) => ({ ...bucket, salonPaidInPaise: merged.get(bucket.key) || 0 }));
};

/** Chart 5 — Acquisition Earnings Trend. FieldAgentEarningLedger, UNCHANGED source (see file header). */
const acquisitionEarningsTrend = async (granularity, opts) => {
  const start = rangeStartFor(granularity, opts);
  const rows = await FieldAgentEarningLedger.aggregate([
    { $match: { entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION, creditOutcome: EARNING_CREDIT_OUTCOME.CREDITED, bookingCompletedAt: { $gte: start } } },
    { $group: { _id: { $dateToString: { format: dateFormatFor(granularity), date: "$bookingCompletedAt" } }, total: { $sum: "$creditedAmountInPaise" } } },
  ]);
  const byKey = new Map(rows.map((r) => [r._id, r.total]));
  return buildSkeleton(granularity, opts).map((bucket) => ({ ...bucket, acquisitionEarningsInPaise: byKey.get(bucket.key) || 0 }));
};

/** Chart 6 — Territory Earnings Trend. TerritoryRevenueLedger, the NEW authoritative source (see file header — NOT FieldAgentEarningLedger). */
const territoryEarningsTrend = async (granularity, opts) => {
  const start = rangeStartFor(granularity, opts);
  const fmt = dateFormatFor(granularity);
  const rows = await TerritoryRevenueLedger.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: { _id: { period: { $dateToString: { format: fmt, date: "$createdAt" } }, ledgerType: "$ledgerType" }, total: { $sum: "$amountInPaise" } } },
  ]);
  const saleByKey = new Map(rows.filter((r) => r._id.ledgerType === TERRITORY_REVENUE_LEDGER_TYPE.SALE).map((r) => [r._id.period, r.total]));
  const reversalByKey = new Map(rows.filter((r) => r._id.ledgerType === TERRITORY_REVENUE_LEDGER_TYPE.REFUND_REVERSAL).map((r) => [r._id.period, r.total]));
  return buildSkeleton(granularity, opts).map((bucket) => {
    const sale = saleByKey.get(bucket.key) || 0;
    const reversal = reversalByKey.get(bucket.key) || 0;
    return { ...bucket, territoryEarningsInPaise: sale - reversal };
  });
};

export const getPayoutTrends = async ({ granularity = "monthly", days = 30, months = 12 } = {}) => {
  const opts = { days, months };
  const [salon, acquisition, territory] = await Promise.all([
    salonPayoutTrend(granularity, opts),
    acquisitionEarningsTrend(granularity, opts),
    territoryEarningsTrend(granularity, opts),
  ]);
  return { salonPayoutTrend: salon, acquisitionEarningsTrend: acquisition, territoryEarningsTrend: territory };
};
