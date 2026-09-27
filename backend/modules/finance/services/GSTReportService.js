/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/GSTReportService.js
 *
 * P0 Revenue Calculation Engine — Step 4.3 (GST Reports & Liability
 * Engine). Read-only reporting only — this file never writes anything.
 *
 * LOCKED rules:
 *   - Use ONLY GSTLedger. Never read Booking. Never read RevenueSplit.
 *     (Confirmed: the only model imported here is GSTLedger.)
 *   - Aggregate by invoiceDate — a REFUND_REVERSAL row's own invoiceDate
 *     is the date the reversal was created (GSTLedgerService.js, Step
 *     4.2), i.e. the date the refund was confirmed — so a refund in a
 *     LATER period correctly reduces THAT period's liability, never
 *     retroactively edits the original sale's period. Standard GST
 *     credit-note filing behaviour, not something this file has to
 *     special-case.
 *   - Net GST = collected − reversed. SALE is the positive (collected)
 *     side, REFUND_REVERSAL is the negative (reversed) side — both are
 *     stored as positive magnitudes on GSTLedger (Step 4.1/4.2's own
 *     convention, mirroring WalletLedger's direction-based design
 *     instead of signed amounts); this file is where the subtraction
 *     actually happens.
 *   - Calendar year/quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec) — not
 *     an April-starting fiscal year; matches the ticket's own "Jan Feb
 *     Mar..." month ordering.
 *
 * All amounts returned by this file are in PAISE (the project-wide raw
 * unit) — gstReport.dto.js converts to rupees for the three admin
 * endpoints, each in the exact field-name shape that endpoint's own
 * ticket spec lists.
 *
 * bookingCount = the number of DISTINCT bookings with a SALE ledger row
 * invoiced in the period (a booking has at most one SALE row, ever —
 * Step 4.1 — so simple monthly counts sum cleanly into quarter/year
 * totals with no double-counting risk).
 * refundCount = the number of REFUND_REVERSAL rows (one per confirmed
 * refund event, Step 4.2) invoiced in the period.
 */

import GSTLedger from "../models/GSTLedger.js";
import { GST_LEDGER_TYPE } from "../constants/gstLedger.constants.js";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const emptyTotals = () => ({
  grossTaxableValueInPaise: 0,
  gstCollectedInPaise: 0,
  gstReversedInPaise: 0,
  netGSTLiabilityInPaise: 0,
  bookingCount: 0,
  refundCount: 0,
});

const addTotals = (a, b) => ({
  grossTaxableValueInPaise: a.grossTaxableValueInPaise + b.grossTaxableValueInPaise,
  gstCollectedInPaise: a.gstCollectedInPaise + b.gstCollectedInPaise,
  gstReversedInPaise: a.gstReversedInPaise + b.gstReversedInPaise,
  netGSTLiabilityInPaise: a.netGSTLiabilityInPaise + b.netGSTLiabilityInPaise,
  bookingCount: a.bookingCount + b.bookingCount,
  refundCount: a.refundCount + b.refundCount,
});

/**
 * The 12 calendar-month totals for one year, aggregated directly from
 * GSTLedger — one aggregation query for the whole year, grouped by
 * {month, ledgerType}. Months with no ledger activity come back as
 * all-zero totals (never omitted, never an error).
 *
 * @param {number} year - e.g. 2026
 * @returns {Promise<Array<{month:number, monthName:string, ...totals}>>} 12 entries, Jan..Dec
 */
export const getMonthlyTotals = async (year) => {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));

  const rows = await GSTLedger.aggregate([
    { $match: { invoiceDate: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { month: { $month: "$invoiceDate" }, ledgerType: "$ledgerType" },
        taxableValueInPaise: { $sum: "$taxableValueInPaise" },
        gstAmountInPaise: { $sum: "$gstAmountInPaise" },
        rowCount: { $sum: 1 },
        bookingIds: { $addToSet: "$bookingId" },
      },
    },
  ]);

  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, monthName: MONTH_NAMES[i], ...emptyTotals() }));

  for (const row of rows) {
    const bucket = months[row._id.month - 1];
    if (row._id.ledgerType === GST_LEDGER_TYPE.SALE) {
      bucket.grossTaxableValueInPaise += row.taxableValueInPaise;
      bucket.gstCollectedInPaise += row.gstAmountInPaise;
      bucket.bookingCount += row.bookingIds.length; // distinct within this one SALE bucket — safe, see file header
    } else if (row._id.ledgerType === GST_LEDGER_TYPE.REFUND_REVERSAL) {
      bucket.gstReversedInPaise += row.gstAmountInPaise;
      bucket.refundCount += row.rowCount;
    }
  }
  for (const bucket of months) {
    bucket.netGSTLiabilityInPaise = bucket.gstCollectedInPaise - bucket.gstReversedInPaise;
  }
  return months;
};

/** Sums a contiguous, 1-indexed, inclusive month range (e.g. Q1 = 1..3) out of an already-fetched 12-month array. */
const sumMonthRange = (months, fromMonth, toMonth) =>
  months.slice(fromMonth - 1, toMonth).reduce((acc, m) => addTotals(acc, m), emptyTotals());

const QUARTER_RANGES = { 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] };
const quarterOf = (month) => Math.ceil(month / 3);

/**
 * currentMonth / currentQuarter / currentYear totals, all as of `now`.
 * Fetches only the ONE year's worth of monthly data each period needs
 * (currentYear and currentQuarter/currentMonth always share the same
 * calendar year, so this is a single query).
 */
export const getSummaryReport = async (now = new Date()) => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const months = await getMonthlyTotals(year);
  const [qFrom, qTo] = QUARTER_RANGES[quarterOf(month)];

  return {
    currentMonth: { year, month, monthName: MONTH_NAMES[month - 1], ...sumMonthRange(months, month, month) },
    currentQuarter: { year, quarter: quarterOf(month), ...sumMonthRange(months, qFrom, qTo) },
    currentYear: { year, ...sumMonthRange(months, 1, 12) },
  };
};

/** All 12 months for a given year, plus each calendar quarter's roll-up and the full-year total. */
export const getMonthlyReport = async (year) => {
  const months = await getMonthlyTotals(year);
  const quarters = [1, 2, 3, 4].map((q) => {
    const [from, to] = QUARTER_RANGES[q];
    return { year, quarter: q, ...sumMonthRange(months, from, to) };
  });
  return { year, months, quarters, yearTotal: { year, ...sumMonthRange(months, 1, 12) } };
};

/**
 * Export-ready structure for ONE month: the same totals as
 * getMonthlyTotals() would give that month, plus the itemized GSTLedger
 * rows (still GSTLedger only — no Booking/RevenueSplit lookups), sorted
 * by invoiceDate, for a future CSV/PDF exporter to consume. This
 * function itself returns JSON only, per the LOCKED rule.
 */
export const getExportReport = async ({ month, year }) => {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const [months, lineItems] = await Promise.all([
    getMonthlyTotals(year),
    GSTLedger.find({ invoiceDate: { $gte: start, $lt: end } }).sort({ invoiceDate: 1 }).lean(),
  ]);

  return {
    period: { year, month, monthName: MONTH_NAMES[month - 1] },
    generatedAt: new Date(),
    summary: months[month - 1],
    lineItems,
  };
};
