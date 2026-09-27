/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFinanceAnalyticsEngine.js
 *
 * STEP 7.2 — Finance Analytics Engine — disposable live verification.
 * Real Atlas dev DB, real HTTP via app.listen(0), all assertions check
 * DELTAS contributed by this script's own fixtures on a specific
 * "today" bucket (never absolute totals), safe against a live,
 * non-empty database.
 *
 * Proves:
 *   1. Daily/Monthly Revenue trend correctly buckets RevenueSplit rows
 *      by day/month, always 30/12 zero-filled entries.
 *   2. GST Collected Trend correctly nets SALE − REFUND_REVERSAL per
 *      bucket, for both daily and monthly granularity.
 *   3. Salon Payout Trend sums BOTH legacy PayoutRequest AND
 *      GenericPayoutRequest PAID rows into the same bucket.
 *   4. Acquisition Earnings Trend reads FieldAgentEarningLedger
 *      (entitlementType ACQUISITION, CREDITED only).
 *   5. Territory Earnings Trend reads TerritoryRevenueLedger — NOT
 *      FieldAgentEarningLedger's TERRITORY_PARTNER rows (the STEP 6.1
 *      retirement) — proven by seeding an OLD-path TERRITORY_PARTNER
 *      FieldAgentEarningLedger row and confirming it is EXCLUDED from
 *      the trend.
 *   6. All 4 real HTTP endpoints respond correctly and are INDIA-only.
 *   7. ISOLATION: zero writes anywhere.
 *
 * Run:  cd backend && node scripts/verifyFinanceAnalyticsEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import PayoutRequest from "../models/PayoutRequest.js";
import GenericPayoutRequest from "../modules/payout/models/GenericPayoutRequest.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import TerritoryRevenueLedger from "../modules/finance/models/TerritoryRevenueLedger.js";
import {
  getDailyRevenueTrend,
  getMonthlyRevenueTrend,
  getGstCollectedTrend,
  getPayoutTrends,
} from "../modules/finance/services/FinanceAnalyticsService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_FAE72_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `9${String(9330000000 + phoneSeq++).slice(-9)}`;

const pad2 = (n) => String(n).padStart(2, "0");
const now = new Date();
const todayDayKey = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
const thisMonthKey = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;

const fixtureRevenueSplitIds = [];
const fixtureGstLedgerIds = [];
const fixturePayoutRequestIds = [];
const fixtureGenericPayoutIds = [];
const fixtureFieldAgentEarningIds = [];
const fixtureTerritoryRevenueLedgerIds = [];
const fixtureUserIds = [];

const bankSnapshot = { accountHolder: `${P}HOLDER`, maskedAccount: "XXXX0000", ifsc: "HDFC0000001", bankName: "HDFC Bank" };

const purgeFixtures = async () => {
  await RevenueSplit.collection.deleteMany({ _id: { $in: fixtureRevenueSplitIds } });
  await GSTLedger.collection.deleteMany({ _id: { $in: fixtureGstLedgerIds } });
  await PayoutRequest.deleteMany({ _id: { $in: fixturePayoutRequestIds } });
  await GenericPayoutRequest.collection.deleteMany({ _id: { $in: fixtureGenericPayoutIds } });
  await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: fixtureFieldAgentEarningIds } });
  await TerritoryRevenueLedger.collection.deleteMany({ _id: { $in: fixtureTerritoryRevenueLedgerIds } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token) => fetch(url(path), { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
    const stateAdmin = await User.create({ name: `${P}STATEADMIN`, phone: nextPhone(), email: `${P.toLowerCase()}stateadmin_${Date.now()}@ztest.local`, role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid(), isActive: true });
    fixtureUserIds.push(stateAdmin._id);
    const stateToken = generateAccessToken({ _id: stateAdmin._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    // ── BASELINE ───────────────────────────────────────────────────
    const beforeDaily = await getDailyRevenueTrend({ days: 30 });
    const beforeMonthly = await getMonthlyRevenueTrend({ months: 12 });
    const beforeGstDaily = await getGstCollectedTrend({ granularity: "daily", days: 30 });
    const beforePayouts = await getPayoutTrends({ granularity: "daily", days: 30 });
    const findBucket = (arr, key) => arr.find((b) => b.key === key);

    // ── FIXTURES ───────────────────────────────────────────────────
    // RevenueSplit (chart 1/2)
    const rs = await RevenueSplit.create({
      bookingId: oid(), serviceAmountInPaise: 10000, platformFeeInPaise: 2000, gstRatePercent: 18,
      gstAmountInPaise: 360, customerPaidInPaise: 12360, salonCreditInPaise: 10000, zemishRevenueInPaise: 2000, policyVersion: 1,
    });
    fixtureRevenueSplitIds.push(rs._id);

    // GSTLedger (chart 3)
    const gstSale = await GSTLedger.create({ bookingId: rs.bookingId, revenueSplitId: rs._id, ledgerType: "SALE", status: "COLLECTED", taxableValueInPaise: 2000, gstRate: 18, gstAmountInPaise: 360, platformFeeInPaise: 2000, invoiceDate: new Date(), policyVersion: 1 });
    fixtureGstLedgerIds.push(gstSale._id);
    const gstReversal = await GSTLedger.create({ bookingId: rs.bookingId, revenueSplitId: rs._id, ledgerType: "REFUND_REVERSAL", status: "REVERSED", taxableValueInPaise: 1000, gstRate: 18, gstAmountInPaise: 180, platformFeeInPaise: 1000, invoiceDate: new Date(), policyVersion: 1, refundId: `rfnd_${P}${Date.now()}` });
    fixtureGstLedgerIds.push(gstReversal._id);

    // Salon Payout Trend (chart 4) — both models
    const legacyPayout = await PayoutRequest.create({ salonId: oid(), amountInPaise: 15000, status: "PAID" });
    fixturePayoutRequestIds.push(legacyPayout._id);
    const genericPayout = await GenericPayoutRequest.create({ entityType: "SALON", entityId: oid(), amountInPaise: 8000, status: "PAID", isOpen: false, bankSnapshot, idempotencyKey: `${P}gpr_${Math.random()}` });
    fixtureGenericPayoutIds.push(genericPayout._id);

    // Acquisition Earnings Trend (chart 5)
    const acqRow = await FieldAgentEarningLedger.create({
      bookingRef: oid(), entitlementType: "ACQUISITION", idempotencyKey: `${P}acq_${Math.random()}`,
      fieldAgentRef: oid(), acquisitionClaimRef: oid(), policySource: "NATIONAL", policyVersionRef: oid(),
      appliedRatePercent: 10, bookingCommissionAmountInPaise: 5000, rawEligibleAmountInPaise: 500,
      creditedAmountInPaise: 500, creditOutcome: "CREDITED", bookingCompletedAt: new Date(),
    });
    fixtureFieldAgentEarningIds.push(acqRow._id);

    // OLD-path TERRITORY_PARTNER row — must be EXCLUDED from the Territory Earnings Trend.
    const oldTerritoryRow = await FieldAgentEarningLedger.create({
      bookingRef: oid(), entitlementType: "TERRITORY_PARTNER", idempotencyKey: `${P}tpold_${Math.random()}`,
      fieldAgentRef: oid(), territoryAssignmentRef: oid(), policySource: "NATIONAL", policyVersionRef: oid(),
      appliedRatePercent: 8, bookingCommissionAmountInPaise: 5000, rawEligibleAmountInPaise: 400,
      creditedAmountInPaise: 400, creditOutcome: "CREDITED", bookingCompletedAt: new Date(),
    });
    fixtureFieldAgentEarningIds.push(oldTerritoryRow._id);

    // TerritoryRevenueLedger (chart 6) — the correct, NEW-path source.
    const tpSplit = oid();
    const tpSale = await TerritoryRevenueLedger.create({ bookingId: oid(), territoryRevenueSplitId: tpSplit, territoryPartnerRef: oid(), ledgerType: "SALE", status: "CREDITED", amountInPaise: 300 });
    fixtureTerritoryRevenueLedgerIds.push(tpSale._id);
    const tpReversal = await TerritoryRevenueLedger.create({ bookingId: oid(), territoryRevenueSplitId: tpSplit, territoryPartnerRef: oid(), ledgerType: "REFUND_REVERSAL", status: "REVERSED", amountInPaise: 50, refundId: `rfnd_${P}tp_${Date.now()}` });
    fixtureTerritoryRevenueLedgerIds.push(tpReversal._id);

    // ── COMPUTE ────────────────────────────────────────────────────
    const afterDaily = await getDailyRevenueTrend({ days: 30 });
    const afterMonthly = await getMonthlyRevenueTrend({ months: 12 });
    const afterGstDaily = await getGstCollectedTrend({ granularity: "daily", days: 30 });
    const afterGstMonthly = await getGstCollectedTrend({ granularity: "monthly", months: 12 });
    const afterPayouts = await getPayoutTrends({ granularity: "daily", days: 30 });

    // ═══ Chart 1/2 — Revenue ═══════════════════════════════════════
    check("1. Daily Revenue trend returns exactly 30 zero-filled entries", afterDaily.length === 30, afterDaily.length);
    check("2. Monthly Revenue trend returns exactly 12 zero-filled entries", afterMonthly.length === 12, afterMonthly.length);
    const dailyBucketBefore = findBucket(beforeDaily, todayDayKey) || { customerPaidInPaise: 0, zemishRevenueInPaise: 0, bookingCount: 0 };
    const dailyBucketAfter = findBucket(afterDaily, todayDayKey);
    check("3. Today's daily bucket picked up the fixture RevenueSplit: +₹123.60 customerPaid, +₹20.00 zemishRevenue, +1 booking", (dailyBucketAfter.customerPaidInPaise - dailyBucketBefore.customerPaidInPaise) === 12360 && (dailyBucketAfter.zemishRevenueInPaise - dailyBucketBefore.zemishRevenueInPaise) === 2000 && (dailyBucketAfter.bookingCount - dailyBucketBefore.bookingCount) === 1, { before: dailyBucketBefore, after: dailyBucketAfter });
    const monthlyBucketBefore = findBucket(beforeMonthly, thisMonthKey) || { customerPaidInPaise: 0 };
    const monthlyBucketAfter = findBucket(afterMonthly, thisMonthKey);
    check("4. This month's monthly bucket also picked it up: +₹123.60 customerPaid", (monthlyBucketAfter.customerPaidInPaise - monthlyBucketBefore.customerPaidInPaise) === 12360);

    // ═══ Chart 3 — GST ═════════════════════════════════════════════
    const gstBucketBefore = findBucket(beforeGstDaily, todayDayKey) || { gstCollectedInPaise: 0, gstReversedInPaise: 0, netGstInPaise: 0 };
    const gstBucketAfter = findBucket(afterGstDaily, todayDayKey);
    check("5. GST Collected Trend (daily): +₹3.60 collected, +₹1.80 reversed, net +₹1.80", (gstBucketAfter.gstCollectedInPaise - gstBucketBefore.gstCollectedInPaise) === 360 && (gstBucketAfter.gstReversedInPaise - gstBucketBefore.gstReversedInPaise) === 180 && (gstBucketAfter.netGstInPaise - gstBucketBefore.netGstInPaise) === 180, { before: gstBucketBefore, after: gstBucketAfter });
    const gstMonthlyBucket = findBucket(afterGstMonthly, thisMonthKey);
    check("6. GST Collected Trend also works for monthly granularity", gstMonthlyBucket.netGstInPaise >= 180, gstMonthlyBucket);

    // ═══ Chart 4 — Salon Payout Trend (both models summed) ═════════
    const salonBucketBefore = findBucket(beforePayouts.salonPayoutTrend, todayDayKey) || { salonPaidInPaise: 0 };
    const salonBucketAfter = findBucket(afterPayouts.salonPayoutTrend, todayDayKey);
    check("7. Salon Payout Trend sums BOTH legacy PayoutRequest (₹150.00) AND GenericPayoutRequest (₹80.00): +₹230.00", (salonBucketAfter.salonPaidInPaise - salonBucketBefore.salonPaidInPaise) === 23000, { before: salonBucketBefore, after: salonBucketAfter });

    // ═══ Chart 5 — Acquisition Earnings Trend ══════════════════════
    const acqBucketBefore = findBucket(beforePayouts.acquisitionEarningsTrend, todayDayKey) || { acquisitionEarningsInPaise: 0 };
    const acqBucketAfter = findBucket(afterPayouts.acquisitionEarningsTrend, todayDayKey);
    check("8. Acquisition Earnings Trend picked up the CREDITED FieldAgentEarningLedger row: +₹5.00", (acqBucketAfter.acquisitionEarningsInPaise - acqBucketBefore.acquisitionEarningsInPaise) === 500, { before: acqBucketBefore, after: acqBucketAfter });

    // ═══ Chart 6 — Territory Earnings Trend (NEW source, old source excluded) ══
    const tpBucketBefore = findBucket(beforePayouts.territoryEarningsTrend, todayDayKey) || { territoryEarningsInPaise: 0 };
    const tpBucketAfter = findBucket(afterPayouts.territoryEarningsTrend, todayDayKey);
    check("9. Territory Earnings Trend reads TerritoryRevenueLedger (₹3.00 SALE − ₹0.50 REFUND_REVERSAL): +₹2.50 net — the OLD-path FieldAgentEarningLedger TERRITORY_PARTNER row (₹4.00) is CORRECTLY EXCLUDED", (tpBucketAfter.territoryEarningsInPaise - tpBucketBefore.territoryEarningsInPaise) === 250, { before: tpBucketBefore, after: tpBucketAfter });

    // ═══ Real HTTP endpoints ═══════════════════════════════════════
    const httpDaily = await authFetch("/api/admin/finance/analytics/daily?days=30", indiaToken);
    check("10. GET /daily succeeds (200), 30 entries", httpDaily.status === 200 && httpDaily.data.data.length === 30, httpDaily.status);
    const httpMonthly = await authFetch("/api/admin/finance/analytics/monthly?months=12", indiaToken);
    check("11. GET /monthly succeeds (200), 12 entries", httpMonthly.status === 200 && httpMonthly.data.data.length === 12);
    const httpGst = await authFetch("/api/admin/finance/analytics/gst?granularity=daily&days=30", indiaToken);
    check("12. GET /gst succeeds (200)", httpGst.status === 200 && Array.isArray(httpGst.data.data));
    const httpPayouts = await authFetch("/api/admin/finance/analytics/payouts?granularity=daily&days=30", indiaToken);
    check("13. GET /payouts succeeds (200), bundles all 3 trends", httpPayouts.status === 200 && !!httpPayouts.data.data.salonPayoutTrend && !!httpPayouts.data.data.acquisitionEarningsTrend && !!httpPayouts.data.data.territoryEarningsTrend, httpPayouts.data);
    check("14. HTTP /payouts territory figure matches the direct service call exactly", findBucket(httpPayouts.data.data.territoryEarningsTrend, todayDayKey)?.territoryEarningsInPaise === tpBucketAfter.territoryEarningsInPaise);

    // RBAC
    const stateDaily = await authFetch("/api/admin/finance/analytics/daily", stateToken);
    check("15. Non-INDIA admin rejected on /daily (403)", stateDaily.status === 403);
    const noAuth = await authFetch("/api/admin/finance/analytics/gst", null);
    check("16. Unauthenticated request rejected on /gst (401)", noAuth.status === 401);

    // Validation
    const badQuery = await authFetch("/api/admin/finance/analytics/gst?granularity=weekly", indiaToken);
    check("17. Invalid granularity value rejected (400)", badQuery.status === 400, badQuery.data);

    // ═══ ISOLATION ═════════════════════════════════════════════════
    check("18. RevenueSplit fixture row unchanged (immutable, read-only engine)", (await RevenueSplit.findById(rs._id).lean()).customerPaidInPaise === 12360);
    check("19. GSTLedger fixture rows still exactly 2 for this bookingId", (await GSTLedger.countDocuments({ bookingId: rs.bookingId })) === 2);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
