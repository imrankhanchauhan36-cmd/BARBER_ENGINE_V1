/**
 * BARBER_ENGINE_V1
 * backend/services/adminSalonAnalytics.service.js
 *
 * ADMIN PANEL MUST-DO-NOW #2 — canonical per-salon analytics.
 * Replaces the hardcoded ANALYTICS_DB that used to back
 * admin-panel's SalonAnalyticsPage.jsx. Read-only. Reuses the exact
 * data sources already proven live by the platform-wide Salon
 * Analytics Dashboard (Transaction, for revenue — see
 * controllers/adminFinance.controller.js#getFinanceSummary/
 * getRevenueTrend/getTopSalons, unmodified by this ticket) plus
 * Booking (for booking-lifecycle metrics, which the platform-wide
 * dashboard never needed) and the already-live, already-complete
 * Rating & Review Engine (RatingAggregate, type SALON) for rating
 * data — never the legacy RevenueSettings/RevenueCalculationService/
 * AreaPlatformFeePolicy path, which stays untouched and unreferenced
 * here exactly as before.
 *
 * Every metric below is either a real aggregation or explicitly
 * returned as null with a documented reason — nothing is fabricated.
 * See this ticket's own audit report §6/§7 for why each "not
 * available" metric is not available.
 *
 * ── METRIC CORRECTNESS PASS — single analytics time semantic ──────
 * ANALYTICS PERIOD IS BASED ON Booking.startTime (the appointment/
 * service date) FOR EVERY METRIC ON THIS PAGE, INCLUDING REVENUE.
 * Transaction.createdAt (when the payment/booking was MADE, which can
 * be days before the appointment itself) is never used as a period
 * filter or bucket key — Transaction documents are only ever reached
 * by joining on bookingId from a booking set already selected by its
 * own startTime. See the revenue block below for the full reasoning
 * (Transaction.bookingId is schema-unique, amount is copied verbatim
 * from the booking at confirm time, and net revenue correctly nets
 * out any already-executed refund via Transaction.refundAmount).
 */

import mongoose from "mongoose";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import Salon from "../models/Salon.js";
import Service from "../models/Service.js";
import RatingAggregate from "../models/RatingAggregate.js";
import { RATING_TYPE } from "../models/ServiceRating.js";
import { Errors } from "../utils/response.js";

// Fixed IST (UTC+5:30), no DST — same convention already established
// elsewhere in this codebase (utils/dateRange.helpers.js's own header)
// for "what timezone is a calendar day/hour in" on this India-only
// platform. Kept local to this file rather than importing that
// file, which is explicitly scoped to a different endpoint by its
// own header comment.
const IST_OFFSET_MS = 330 * 60 * 1000;
const istHourOf = (utcDate) => new Date(utcDate.getTime() + IST_OFFSET_MS).getUTCHours();

// A "real" booking, for every count/rate metric below, excludes HOLD
// (a slot lock awaiting payment — never actually happened) and
// EXPIRED (a HOLD that timed out — also never actually happened).
// CONFIRMED/CHECKED_IN/ONGOING/COMPLETED/CANCELLED/NO_SHOW are all
// bookings that were genuinely made, regardless of outcome.
const REAL_BOOKING_STATUSES = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.CHECKED_IN,
  BOOKING_STATUS.ONGOING,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.NO_SHOW,
];

export const PERIOD_KEYS = Object.freeze({
  "30d": "30d",
  "3m": "3m",
  "6m": "6m",
  "1y": "1y",
});

/** period key -> { from, to, bucketUnit } — `to` is now, `from` is the start boundary, `bucketUnit` picks trend-chart granularity. */
function resolvePeriod(periodKey) {
  const to = new Date();
  const from = new Date(to);
  let bucketUnit = "month";
  switch (periodKey) {
    case "30d":
      from.setUTCDate(from.getUTCDate() - 30);
      bucketUnit = "day";
      break;
    case "3m":
      from.setUTCMonth(from.getUTCMonth() - 3);
      break;
    case "1y":
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      break;
    case "6m":
    default:
      from.setUTCMonth(from.getUTCMonth() - 6);
      break;
  }
  return { from, to, bucketUnit };
}

const dayBucketKey = (d) => {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
};
const monthBucketKey = (d) => {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Admin geography scope check for a single salon — the exact inline
 * pattern already used by GET /admin/salons/:id (controllers/
 * salonDetail.controller.js), reused verbatim rather than abstracted,
 * so this endpoint's authorization behavior is provably identical to
 * the existing, trusted Salon Detail endpoint's own.
 */
function assertAdminCanAccessSalon(admin, salon) {
  // salon.location.territory.stateRef/districtRef are POPULATED here
  // (see getAdminSalonAnalytics' .populate() calls) — ._id is the raw
  // ObjectId, matching exactly how salonDetail.controller.js's own
  // scope guard reads it.
  if (admin.adminLevel === "STATE") {
    const salonState = salon.location?.territory?.stateRef?._id?.toString();
    if (salonState !== admin.stateRef?.toString()) {
      throw Errors.forbidden("Access denied");
    }
  }
  if (admin.adminLevel === "DISTRICT") {
    const salonDistrict = salon.location?.territory?.districtRef?._id?.toString();
    if (salonDistrict !== admin.districtRef?.toString()) {
      throw Errors.forbidden("Access denied");
    }
  }
}

export const getAdminSalonAnalytics = async ({ salonId, periodKey, admin }) => {
  if (!mongoose.Types.ObjectId.isValid(salonId)) {
    throw Errors.badRequest("Invalid salon ID");
  }
  const resolvedPeriodKey = PERIOD_KEYS[periodKey] ? periodKey : "6m";

  const salon = await Salon.findOne({ _id: salonId, isDeleted: { $ne: true } })
    .select("basicInfo.shopName location.territory.stateRef location.territory.districtRef")
    .populate("location.territory.stateRef", "name")
    .populate("location.territory.districtRef", "name")
    .lean();
  if (!salon) throw Errors.notFound("Salon not found");

  assertAdminCanAccessSalon(admin, salon);

  const { from, to, bucketUnit } = resolvePeriod(resolvedPeriodKey);
  const salonObjectId = new mongoose.Types.ObjectId(salonId);

  // ── A. Booking-lifecycle metrics (real Booking statuses, period-bounded by startTime) ──
  const bookingMatch = {
    salonRef: salonObjectId,
    isDeleted: { $ne: true },
    startTime: { $gte: from, $lte: to },
    status: { $in: REAL_BOOKING_STATUSES },
  };

  const [statusBreakdown, bookingRows] = await Promise.all([
    Booking.aggregate([
      { $match: bookingMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    // Raw, period-bounded rows — reused below for trend/top-services/
    // peak-hours/customer-growth bucketing without 4 separate round
    // trips (one bounded aggregation query, not per-chart queries).
    Booking.find(bookingMatch).select("status startTime serviceRefs userRef").lean(),
  ]);

  const countByStatus = Object.fromEntries(statusBreakdown.map((r) => [r._id, r.count]));
  const totalBookings = statusBreakdown.reduce((sum, r) => sum + r.count, 0);
  const completedBookings = countByStatus[BOOKING_STATUS.COMPLETED] ?? 0;
  const cancelledBookings = countByStatus[BOOKING_STATUS.CANCELLED] ?? 0;
  const cancelRatePercent = totalBookings > 0 ? Number(((cancelledBookings / totalBookings) * 100).toFixed(1)) : null;

  const completedRows = bookingRows.filter((b) => b.status === BOOKING_STATUS.COMPLETED);

  // Booking trend — real counts per bucket, over ALL real-status bookings (not just completed).
  const bookingTrendMap = new Map();
  for (const b of bookingRows) {
    const key = bucketUnit === "day" ? dayBucketKey(b.startTime) : monthBucketKey(b.startTime);
    bookingTrendMap.set(key, (bookingTrendMap.get(key) ?? 0) + 1);
  }

  // Peak hours — IST hour-of-day, completed bookings only (the ones that actually happened).
  const peakHoursMap = new Map();
  for (const b of completedRows) {
    const h = istHourOf(b.startTime);
    peakHoursMap.set(h, (peakHoursMap.get(h) ?? 0) + 1);
  }
  const peakHours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: peakHoursMap.get(h) ?? 0 }));

  // Top services — booking COUNT per service is a real, unambiguous
  // metric (a service's presence on a booking is a fact). Per-service
  // REVENUE is deliberately NOT computed: Booking stores one
  // undivided serviceAmountInPaise for the whole booking, not a
  // per-service breakdown, so a multi-service booking has no reliable
  // way to split its amount across services without double-counting
  // or guessing a split — returning a fabricated number here would
  // violate this ticket's own "do not invent" rule. revenueInPaise is
  // therefore explicitly null on every row, not fabricated.
  const serviceCounts = new Map();
  for (const b of completedRows) {
    for (const svcId of b.serviceRefs || []) {
      const key = String(svcId);
      serviceCounts.set(key, (serviceCounts.get(key) ?? 0) + 1);
    }
  }
  const topServiceIds = Array.from(serviceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
  const serviceDocs = topServiceIds.length
    ? await Service.find({ _id: { $in: topServiceIds } }).select("name").lean()
    : [];
  const serviceNameById = Object.fromEntries(serviceDocs.map((s) => [String(s._id), s.name]));
  const topServices = topServiceIds.map((id) => ({
    serviceId: id,
    name: serviceNameById[id] ?? "(deleted service)",
    bookingCount: serviceCounts.get(id),
    revenueInPaise: null, // see comment above — not reliably derivable per-service
  }));

  // ── B. Finance metrics — METRIC CORRECTNESS PASS ──────────────────
  // Single analytics time semantic for this whole endpoint: the
  // BOOKING's appointment/startTime — never Transaction.createdAt.
  // Transaction.bookingId is unique (schema-enforced, confirmed in
  // models/Transaction.js) — one Booking has at most one Transaction,
  // and the real confirm flow (controllers/booking.controller.js
  // #runBookingConfirmationCore) creates it with amount/commission/
  // payoutAmount copied VERBATIM from booking.totalAmountInPaise/
  // commissionAmountInPaise/serviceAmountInPaise at confirm time — no
  // separate pricing calculation exists to diverge from. So revenue
  // is attributed to the period by looking up each PERIOD-QUALIFYING
  // booking's own (at most one) Transaction, never by querying
  // Transaction on its own createdAt — a booking made on Sep 30 for
  // an Oct 1 appointment must count as October revenue, matching
  // October bookings, not September.
  //
  // Net revenue per transaction = amount - refundAmount, counted only
  // when status === "PAID". This is not an invented formula — it is
  // this codebase's own already-established, already-tested refund
  // semantic (confirmed in scripts/verifyRazorpaySourceRefund.js):
  // a PARTIAL refund keeps status "PAID" and increments refundAmount;
  // a FULL refund flips status to "REFUNDED" (contributing zero here,
  // correctly — that money was actually returned to the customer).
  // This also directly satisfies "do not call a cancelled booking's
  // old PAID transaction revenue if it was subsequently refunded":
  // a CANCELLED booking whose transaction was fully refunded
  // contributes 0; one refunded to a no-refund policy still correctly
  // keeps its real net amount.
  const qualifyingBookingIds = bookingRows.map((b) => b._id);
  const startTimeByBookingId = new Map(bookingRows.map((b) => [String(b._id), b.startTime]));

  const txnRows = qualifyingBookingIds.length
    ? await Transaction.find({ bookingId: { $in: qualifyingBookingIds }, status: "PAID" })
        .select("bookingId amount refundAmount")
        .lean()
    : [];

  let totalRevenueInPaise = 0;
  const revenueTrendMap = new Map();
  for (const t of txnRows) {
    const net = t.amount - (t.refundAmount || 0);
    totalRevenueInPaise += net;
    const bookingStartTime = startTimeByBookingId.get(String(t.bookingId));
    const key = bucketUnit === "day" ? dayBucketKey(bookingStartTime) : monthBucketKey(bookingStartTime);
    revenueTrendMap.set(key, (revenueTrendMap.get(key) ?? 0) + net);
  }
  // Avg Booking Value = net revenue / number of qualifying BOOKINGS
  // that actually generated a transaction (never a transaction count
  // drawn from a different time window than the bookings themselves).
  const revenueGeneratingBookingCount = txnRows.length;
  const avgBookingValueInPaise = revenueGeneratingBookingCount > 0 ? Math.round(totalRevenueInPaise / revenueGeneratingBookingCount) : null;

  // ── C. Customers — real, derived from completed bookings only. ──
  const periodCustomerIds = [...new Set(completedRows.map((b) => String(b.userRef)))];
  const totalCustomers = periodCustomerIds.length;

  // "Repeat" = a customer seen in this period who has >= 2 completed
  // bookings at THIS salon ALL-TIME (not just within the period) —
  // the simple, documented definition the ticket itself proposes.
  // Also doubles as the data needed for the Customer Growth
  // new-vs-repeat trend below (first-ever completed booking date per
  // customer at this salon, all-time, salon-scoped so still bounded).
  let repeatCustomers = 0;
  let firstBookingDateByUser = new Map();
  if (periodCustomerIds.length > 0) {
    const allTimeAgg = await Booking.aggregate([
      {
        $match: {
          salonRef: salonObjectId,
          isDeleted: { $ne: true },
          status: BOOKING_STATUS.COMPLETED,
          userRef: { $in: periodCustomerIds.map((id) => new mongoose.Types.ObjectId(id)) },
        },
      },
      { $group: { _id: "$userRef", totalCompletedAllTime: { $sum: 1 }, firstBookingDate: { $min: "$startTime" } } },
    ]);
    repeatCustomers = allTimeAgg.filter((r) => r.totalCompletedAllTime >= 2).length;
    firstBookingDateByUser = new Map(allTimeAgg.map((r) => [String(r._id), r.firstBookingDate]));
  }

  // Customer growth trend — per bucket, how many of that bucket's
  // customers were brand-new (their all-time-first completed booking
  // at this salon falls in this same bucket) vs repeat.
  const growthMap = new Map(); // bucket -> {new:Set, repeat:Set}
  for (const b of completedRows) {
    const key = bucketUnit === "day" ? dayBucketKey(b.startTime) : monthBucketKey(b.startTime);
    if (!growthMap.has(key)) growthMap.set(key, { newSet: new Set(), repeatSet: new Set() });
    const bucket = growthMap.get(key);
    const uid = String(b.userRef);
    const firstDate = firstBookingDateByUser.get(uid);
    const firstKey = firstDate ? (bucketUnit === "day" ? dayBucketKey(firstDate) : monthBucketKey(firstDate)) : null;
    if (firstKey === key) bucket.newSet.add(uid);
    else bucket.repeatSet.add(uid);
  }

  // ── D. Rating — real, from the already-live Rating & Review Engine
  // aggregate (RatingAggregate, type SALON). All-time cumulative by
  // that model's own design (it has no time-series breakdown), so
  // this is NOT period-filtered — documented explicitly in the DTO. ──
  const ratingAgg = await RatingAggregate.findOne({ salonId: salonObjectId, type: RATING_TYPE.SALON }).lean();
  const avgRating = ratingAgg && ratingAgg.count > 0 ? Number((ratingAgg.total / ratingAgg.count).toFixed(1)) : null;
  const ratingCount = ratingAgg?.count ?? 0;
  const ratingDistribution = ratingAgg && ratingAgg.count > 0
    ? { "1": ratingAgg.distribution?.get?.("1") ?? ratingAgg.distribution?.["1"] ?? 0,
        "2": ratingAgg.distribution?.get?.("2") ?? ratingAgg.distribution?.["2"] ?? 0,
        "3": ratingAgg.distribution?.get?.("3") ?? ratingAgg.distribution?.["3"] ?? 0,
        "4": ratingAgg.distribution?.get?.("4") ?? ratingAgg.distribution?.["4"] ?? 0,
        "5": ratingAgg.distribution?.get?.("5") ?? ratingAgg.distribution?.["5"] ?? 0 }
    : null;

  // Build sorted bucket lists for the 3 trend charts.
  const allBucketKeys = new Set([...bookingTrendMap.keys(), ...revenueTrendMap.keys(), ...growthMap.keys()]);
  const sortedBuckets = Array.from(allBucketKeys).sort();

  return {
    salon: {
      id: String(salon._id),
      name: salon.basicInfo?.shopName ?? null,
      district: salon.location?.territory?.districtRef?.name ?? null,
      state: salon.location?.territory?.stateRef?.name ?? null,
    },
    period: { key: resolvedPeriodKey, from: from.toISOString(), to: to.toISOString(), bucketUnit },
    summary: {
      totalBookings,
      completedBookings,
      cancelledBookings,
      cancelRatePercent,
      totalRevenueInPaise,
      avgBookingValueInPaise,
      totalCustomers,
      repeatCustomers,
      avgRating,
      ratingCount,
    },
    trends: {
      bookings: sortedBuckets.map((k) => ({ bucket: k, count: bookingTrendMap.get(k) ?? 0 })),
      revenue: sortedBuckets.map((k) => ({ bucket: k, amountInPaise: revenueTrendMap.get(k) ?? 0 })),
      customers: sortedBuckets.map((k) => ({
        bucket: k,
        newCustomers: growthMap.get(k)?.newSet.size ?? 0,
        repeatCustomers: growthMap.get(k)?.repeatSet.size ?? 0,
      })),
    },
    topServices,
    peakHours,
    ratingDistribution,
    // Deliberately not implemented this pass — see audit report §12/§17.
    // District/State averages and the Top-10-salons comparison would
    // each require a second, cross-salon aggregation whose definition
    // the ticket itself said not to invent without clear evidence; the
    // existing platform-wide /app/salon-analytics dashboard already
    // offers a real top-salons ranking, left untouched by this ticket.
    comparisons: { district: null, state: null, topSalons: null },
    // Deliberately null — no approved Health Score formula exists.
    // Inventing weights here would be exactly the fabrication this
    // ticket explicitly forbids.
    health: { score: null, bookingRate: null, reviewScore: null, revenueGrowth: null },
  };
};
