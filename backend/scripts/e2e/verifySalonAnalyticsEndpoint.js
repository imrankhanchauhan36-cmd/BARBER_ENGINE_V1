/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifySalonAnalyticsEndpoint.js
 *
 * ADMIN PANEL MUST-DO-NOW #2 — per-salon analytics. Disposable,
 * fully read-only live verification against GET /api/admin/salons/
 * :id/analytics. Real Express app (app.listen(0)), real signed JWTs
 * for EXISTING real admins (read-only lookups, zero new admin
 * fixtures), real Atlas dev DB. Creates NO booking/transaction/
 * payment/financial records of any kind — every assertion either
 * calls the real HTTP endpoint or reads existing collections
 * directly for cross-check. Nothing is created or deleted; the
 * `finally` block only closes the server/DB connection.
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const SALON_A = "6a2873f43b043bc85838b68e"; // real salon, 13 PAID transactions, cancelled/expired bookings only
const SALON_B = "6a367a184c9a3dd9caeffe70"; // real salon, different district, same state as A
const REAL_BOOKING_STATUSES = [
  BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.ONGOING,
  BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW,
];

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token) =>
    fetch(url(path), { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  try {
    const beforeCounts = {
      Salon: await Salon.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
    };

    // ── Reuse real, existing, active admins only (read-only) ──
    const freshToken = async (adminId, role, extra = {}) => {
      const live = await User.findById(adminId).select("tokenVersion adminLevel stateRef districtRef").lean();
      return generateAccessToken({ _id: adminId, role, adminLevel: live.adminLevel, stateRef: live.stateRef, districtRef: live.districtRef, tokenVersion: live.tokenVersion ?? 0, ...extra });
    };
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id").lean();
    const indiaToken = await freshToken(indiaAdmin._id, "ADMIN");

    const stateAdminMatchA = await User.findOne({ role: "ADMIN", adminLevel: "STATE", stateRef: "69cac2058d4953980270f120", isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id").lean();
    const stateTokenMatch = await freshToken(stateAdminMatchA._id, "ADMIN");
    const stateAdminOther = await User.findOne({ role: "ADMIN", adminLevel: "STATE", stateRef: { $ne: "69cac2058d4953980270f120" }, isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id").lean();
    const stateTokenOther = await freshToken(stateAdminOther._id, "ADMIN");

    const districtAdminMatchA = await User.findOne({ role: "ADMIN", adminLevel: "DISTRICT", districtRef: "69cacc398d49539802710860", isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id").lean();
    const districtTokenMatchA = await freshToken(districtAdminMatchA._id, "ADMIN");
    const districtAdminOther = await User.findOne({ role: "ADMIN", adminLevel: "DISTRICT", districtRef: { $ne: "69cacc398d49539802710860" }, isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id").lean();
    const districtTokenOther = await freshToken(districtAdminOther._id, "ADMIN");

    // ═══ A. ROUTE / API ═══════════════════════════════════════════
    let r = await authFetch(`/api/admin/salons/${SALON_A}/analytics?period=1y`, indiaToken);
    check("A1. Valid salon -> 200", r.status === 200 && r.data?.data?.salon?.id === SALON_A, { status: r.status });

    r = await authFetch(`/api/admin/salons/not-a-valid-objectid/analytics`, indiaToken);
    check("A2. Invalid ObjectId -> 400", r.status === 400, { status: r.status });

    r = await authFetch(`/api/admin/salons/000000000000000000000000/analytics`, indiaToken);
    check("A3. Valid but nonexistent salon -> 404", r.status === 404, { status: r.status });

    // ═══ B. RBAC ══════════════════════════════════════════════════
    r = await authFetch(`/api/admin/salons/${SALON_A}/analytics`, indiaToken);
    check("B1. INDIA can access", r.status === 200, { status: r.status });

    r = await authFetch(`/api/admin/salons/${SALON_A}/analytics`, stateTokenMatch);
    check("B2. STATE can access salon in own state", r.status === 200, { status: r.status });

    r = await authFetch(`/api/admin/salons/${SALON_A}/analytics`, stateTokenOther);
    check("B3. STATE CANNOT access salon in another state -> 403", r.status === 403, { status: r.status });

    r = await authFetch(`/api/admin/salons/${SALON_A}/analytics`, districtTokenMatchA);
    check("B4. DISTRICT can access salon in own district", r.status === 200, { status: r.status });

    r = await authFetch(`/api/admin/salons/${SALON_B}/analytics`, districtTokenMatchA);
    check("B5. DISTRICT CANNOT access salon in another district (same state) -> 403", r.status === 403, { status: r.status });

    r = await authFetch(`/api/admin/salons/${SALON_A}/analytics`, districtTokenOther);
    check("B5b. DISTRICT (different state entirely) CANNOT access -> 403", r.status === 403, { status: r.status });

    // ═══ C. ISOLATION ═════════════════════════════════════════════
    const rA = await authFetch(`/api/admin/salons/${SALON_A}/analytics?period=1y`, indiaToken);
    const rB = await authFetch(`/api/admin/salons/${SALON_B}/analytics?period=1y`, indiaToken);
    check("C1. Salon A response identifies as Salon A only", rA.data?.data?.salon?.id === SALON_A, {});
    check("C2. Salon B response identifies as Salon B only", rB.data?.data?.salon?.id === SALON_B, {});
    check("C3. Salon A and Salon B summaries are not identical (real, distinct data)", JSON.stringify(rA.data?.data?.summary) !== JSON.stringify(rB.data?.data?.summary), { a: rA.data?.data?.summary, b: rB.data?.data?.summary });

    // ═══ D. PERIOD ════════════════════════════════════════════════
    for (const period of ["30d", "3m", "6m", "1y"]) {
      r = await authFetch(`/api/admin/salons/${SALON_A}/analytics?period=${period}`, indiaToken);
      check(`D. period=${period} -> 200, echoes period.key=${period}`, r.status === 200 && r.data?.data?.period?.key === period, { status: r.status, key: r.data?.data?.period?.key });
    }
    const r30 = await authFetch(`/api/admin/salons/${SALON_A}/analytics?period=30d`, indiaToken);
    const r1y = await authFetch(`/api/admin/salons/${SALON_A}/analytics?period=1y`, indiaToken);
    check("D2. 30d and 1y periods have different date boundaries (server-driven, not frontend-sliced)", r30.data?.data?.period?.from !== r1y.data?.data?.period?.from, {});

    // ═══ E. REAL DATA CROSS-CHECK (read-only, no mutation) ═══════
    const apiResp1y = await authFetch(`/api/admin/salons/${SALON_A}/analytics?period=1y`, indiaToken);
    const apiSummary = apiResp1y.data?.data?.summary;
    const { from, to } = apiResp1y.data.data.period;

    const qualifyingBookings = await Booking.find({ salonRef: new mongoose.Types.ObjectId(SALON_A), isDeleted: { $ne: true }, startTime: { $gte: new Date(from), $lte: new Date(to) }, status: { $in: REAL_BOOKING_STATUSES } }).select("_id status").lean();
    const directTotalBookings = qualifyingBookings.length;
    const directCancelled = qualifyingBookings.filter((b) => b.status === "CANCELLED").length;

    check("E1. Total Bookings matches an independent direct Mongo aggregation", apiSummary.totalBookings === directTotalBookings, { api: apiSummary.totalBookings, direct: directTotalBookings });
    check("E2. Cancelled Bookings matches an independent direct Mongo aggregation", apiSummary.cancelledBookings === directCancelled, { api: apiSummary.cancelledBookings, direct: directCancelled });

    // METRIC CORRECTNESS PASS — the cross-check itself must use the
    // CORRECTED methodology (join Transaction via bookingId from the
    // period-qualifying BOOKING set, net of refundAmount, status=PAID
    // only) — not the old Transaction.createdAt-windowed aggregate,
    // which this real dataset's zero-day booking-to-payment gap would
    // let pass even if the endpoint still had the old bug. See §16 of
    // the report for why no real multi-day-gap example exists here.
    const qualifyingBookingIds = qualifyingBookings.map((b) => b._id);
    const directTxns = qualifyingBookingIds.length
      ? await Transaction.find({ bookingId: { $in: qualifyingBookingIds }, status: "PAID" }).select("amount refundAmount").lean()
      : [];
    const directRevenue = directTxns.reduce((sum, t) => sum + (t.amount - (t.refundAmount || 0)), 0);
    const directAvgBookingValue = directTxns.length > 0 ? Math.round(directRevenue / directTxns.length) : null;
    check("E3. *** CRITICAL *** Total Revenue matches an independent direct bookingId-join calculation, net of refunds (corrected methodology, not legacy)", apiSummary.totalRevenueInPaise === directRevenue, { api: apiSummary.totalRevenueInPaise, direct: directRevenue });
    check("E3b. Avg Booking Value matches the same independent calculation (booking-based denominator, not a raw transaction-window count)", apiSummary.avgBookingValueInPaise === directAvgBookingValue, { api: apiSummary.avgBookingValueInPaise, direct: directAvgBookingValue });

    const directCustomerIds = await Booking.distinct("userRef", { salonRef: new mongoose.Types.ObjectId(SALON_A), isDeleted: { $ne: true }, startTime: { $gte: new Date(from), $lte: new Date(to) }, status: "COMPLETED" });
    check("E4. Total Customers matches an independent direct Mongo distinct-count", apiSummary.totalCustomers === directCustomerIds.length, { api: apiSummary.totalCustomers, direct: directCustomerIds.length });

    // ═══ E5. Revenue Trend reconciles with Total Revenue ═════════
    const apiRevenueTrendSum = (apiResp1y.data.data.trends.revenue || []).reduce((s, r) => s + r.amountInPaise, 0);
    check("E5. Revenue Trend bucket sum reconciles exactly with Total Revenue for the same period", apiRevenueTrendSum === apiSummary.totalRevenueInPaise, { trendSum: apiRevenueTrendSum, total: apiSummary.totalRevenueInPaise });

    // ═══ E6. Structural verification — no multiple-Transaction-per-Booking risk ═══
    const dupTxnCheck = await Transaction.aggregate([{ $group: { _id: "$bookingId", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
    check("E6. No booking in the entire database has more than one Transaction (schema-unique bookingId, confirmed empirically)", dupTxnCheck.length === 0, { dupTxnCheck });

    // ═══ E7. Cross-period gap — informational, read-only structural note (no fixture created) ═══
    const salonATxnsWithGap = await Transaction.aggregate([
      { $match: { salonId: new mongoose.Types.ObjectId(SALON_A) } },
      { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "booking" } },
      { $unwind: "$booking" },
      { $project: { gapMs: { $subtract: ["$booking.startTime", "$createdAt"] } } },
    ]);
    const maxGapDays = salonATxnsWithGap.length ? Math.max(...salonATxnsWithGap.map((r) => Math.abs(r.gapMs) / 86400000)) : 0;
    results.push(`ℹ E7. Max |Booking.startTime − Transaction.createdAt| gap found for Salon A's ${salonATxnsWithGap.length} transactions: ${maxGapDays.toFixed(2)} day(s) — see report §16 for why no multi-day live example exists in this dataset`);

    // ═══ F. EMPTY (nonexistent-activity salon, no fixture created — use a salon known to have zero Transactions/Bookings if one exists; otherwise this is skipped safely) ═══
    const zeroActivitySalon = await Salon.findOne({ isDeleted: { $ne: true }, _id: { $nin: [SALON_A, SALON_B] } })
      .select("_id")
      .lean();
    if (zeroActivitySalon) {
      const bookingCountForIt = await Booking.countDocuments({ salonRef: zeroActivitySalon._id, isDeleted: { $ne: true } });
      if (bookingCountForIt === 0) {
        r = await authFetch(`/api/admin/salons/${zeroActivitySalon._id}/analytics`, indiaToken);
        check("F1. A real salon with zero bookings returns honest zero summary (not an error, not fabricated)", r.status === 200 && r.data?.data?.summary?.totalBookings === 0, { status: r.status, summary: r.data?.data?.summary });
      } else {
        results.push("ℹ F1. Skipped — the sampled 'other' salon unexpectedly has bookings; no safe zero-activity salon found without creating a fixture (none created, per instruction)");
      }
    } else {
      results.push("ℹ F1. Skipped — no third salon available to sample");
    }

    // ═══ G. NO MOCK ═══════════════════════════════════════════════
    const fs = await import("node:fs/promises");
    const pageSrc = await fs.readFile(new URL("../../../admin-panel/src/pages/salons/SalonAnalyticsPage.jsx", import.meta.url), "utf8");
    // Match a live declaration/usage (const ANALYTICS_DB =, ANALYTICS_DB[...]),
    // not the explanatory comment that documents its removal.
    const hasLiveAnalyticsDb = /\bconst\s+ANALYTICS_DB\b|\bANALYTICS_DB\s*\[/.test(pageSrc);
    check("G1. ANALYTICS_DB no longer present as live code in SalonAnalyticsPage.jsx (only mentioned in a removal comment)", !hasLiveAnalyticsDb, {});

    // ═══ H. FINANCE SAFETY ════════════════════════════════════════
    const serviceSrc = await fs.readFile(new URL("../../services/adminSalonAnalytics.service.js", import.meta.url), "utf8");
    const controllerSrc = await fs.readFile(new URL("../../controllers/adminSalonAnalytics.controller.js", import.meta.url), "utf8");
    // Match a real import/usage line, not a comment stating the term is
    // deliberately NOT used — strip // and /* */ comment lines first.
    const stripComments = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    const serviceCode = stripComments(serviceSrc);
    const controllerCode = stripComments(controllerSrc);
    const legacyTerms = ["RevenueSettings", "RevenueCalculationService", "RevenueSettingsEngine", "AreaPlatformFeePolicy"];
    const foundLegacy = legacyTerms.filter((t) => serviceCode.includes(t) || controllerCode.includes(t));
    check("H1. New endpoint's live code (comments excluded) references NO legacy finance system", foundLegacy.length === 0, { foundLegacy });

    // ═══ I. REGRESSION ════════════════════════════════════════════
    const dashboardApiSrc = await fs.readFile(new URL("../../../admin-panel/src/pages/salons/api/salonAnalytics.api.js", import.meta.url), "utf8");
    check("I1. Platform-wide salonAnalytics.api.js untouched (still 4 original endpoints, no new ones added)", (dashboardApiSrc.match(/apiClient\.get/g) || []).length === 4, {});
    r = await authFetch(`/api/admin/finance/summary`, indiaToken);
    check("I2. Platform-wide /admin/finance/summary endpoint still works unaffected", r.status === 200, { status: r.status });

    const afterCounts = {
      Salon: await Salon.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
    };
    check("I3. Zero DB mutation — Salon/Booking/Transaction counts unchanged", JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), { before: beforeCounts, after: afterCounts });

  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nSALON ANALYTICS ENDPOINT: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
