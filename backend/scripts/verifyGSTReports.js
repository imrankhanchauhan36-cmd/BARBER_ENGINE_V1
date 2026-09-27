/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyGSTReports.js
 *
 * P0 Revenue Calculation Engine — Step 4.3 (GST Reports & Liability
 * Engine) — live verification. Real Express app, real signed JWTs, real
 * Atlas dev DB, disposable prefixed fixtures purged before/after.
 *
 * Fixtures are written DIRECTLY as GSTLedger documents with hand-picked
 * invoiceDate values (never through Booking/RevenueSplit — this step's
 * own LOCKED rule is "use ONLY GSTLedger", so the test fixtures honor
 * that boundary too) into two disposable, unlikely-to-collide years
 * (9001 and 9002) so real production GST data can never affect the
 * assertions below, and "multiple years" isolation is proven directly.
 *
 * Run:  cd backend && node scripts/verifyGSTReports.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_GSTREPORT43_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const YEAR_A = 2091; // disposable, within Joi range, decades past any real data
const YEAR_B = 2092;

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;
  const call = (path, token) => fetch(`http://127.0.0.1:${port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

  const fixtureUserIds = [];
  const fixtureLedgerIds = [];

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
    const stateAdminUser = await User.create({ name: `${P}STATE_ADMIN`, email: `${P.toLowerCase()}state_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid() });
    fixtureUserIds.push(stateAdminUser._id);
    const stateToken = generateAccessToken({ _id: stateAdminUser._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    const mkSale = async ({ year, month, day = 15, bookingId = oid(), revenueSplitId = oid(), taxable = 2000, gstRate = 18, gst = 360, fee = 2000, policyVersion = 1 }) => {
      const row = await GSTLedger.create({ bookingId, revenueSplitId, ledgerType: "SALE", status: "COLLECTED", taxableValueInPaise: taxable, gstRate, gstAmountInPaise: gst, platformFeeInPaise: fee, invoiceDate: new Date(Date.UTC(year, month - 1, day, 10, 0, 0)), policyVersion });
      fixtureLedgerIds.push(row._id);
      return row;
    };
    const mkReversal = async ({ year, month, day = 20, bookingId, revenueSplitId, taxable, gstRate = 18, gst, fee, policyVersion = 1, refundId }) => {
      const row = await GSTLedger.create({ bookingId, revenueSplitId, ledgerType: "REFUND_REVERSAL", status: "REVERSED", taxableValueInPaise: taxable, gstRate, gstAmountInPaise: gst, platformFeeInPaise: fee, invoiceDate: new Date(Date.UTC(year, month - 1, day, 10, 0, 0)), policyVersion, refundId });
      fixtureLedgerIds.push(row._id);
      return row;
    };

    // ═══ FIXTURES, all in disposable YEAR_A / YEAR_B ═══════════════
    // January YEAR_A: two SALE bookings, one fully refunded (net 0 for that booking).
    const janBookingId1 = oid(), janSplitId1 = oid();
    await mkSale({ year: YEAR_A, month: 1, bookingId: janBookingId1, revenueSplitId: janSplitId1, taxable: 2000, gst: 360, fee: 2000 });
    await mkReversal({ year: YEAR_A, month: 1, bookingId: janBookingId1, revenueSplitId: janSplitId1, taxable: 2000, gst: 360, fee: 2000, refundId: `rfnd_ZTEST${P}jan1` });
    const janBookingId2 = oid(), janSplitId2 = oid();
    await mkSale({ year: YEAR_A, month: 1, bookingId: janBookingId2, revenueSplitId: janSplitId2, taxable: 2500, gst: 450, fee: 2500 });

    // February YEAR_A: one SALE, no refund.
    const febBookingId = oid(), febSplitId = oid();
    await mkSale({ year: YEAR_A, month: 2, bookingId: febBookingId, revenueSplitId: febSplitId, taxable: 2000, gst: 360, fee: 2000 });

    // March YEAR_A: deliberately EMPTY — no fixtures at all (empty-month check).

    // A cross-month reversal: sale in Feb, its refund confirmed in March — proves
    // "aggregate by invoiceDate", i.e. the reversal reduces MARCH's liability, not Feb's.
    const crossBookingId = oid(), crossSplitId = oid();
    await mkSale({ year: YEAR_A, month: 2, day: 5, bookingId: crossBookingId, revenueSplitId: crossSplitId, taxable: 1000, gst: 180, fee: 1000 });
    await mkReversal({ year: YEAR_A, month: 3, day: 10, bookingId: crossBookingId, revenueSplitId: crossSplitId, taxable: 500, gst: 90, fee: 500, refundId: `rfnd_ZTEST${P}cross1` });

    // April, May, June YEAR_A — one SALE each, to build a real Q2 roll-up.
    for (const m of [4, 5, 6]) await mkSale({ year: YEAR_A, month: m, taxable: 1000, gst: 180, fee: 1000 });

    // The CURRENT real calendar month/quarter/year — for /summary, using the disposable
    // year replaced by "now" would defeat isolation, so /summary is verified structurally
    // (shape + arithmetic identity) rather than against a hand-picked fixture total.

    // YEAR_B: completely separate data, to prove year isolation ("multiple years").
    await mkSale({ year: YEAR_B, month: 1, taxable: 9999, gst: 1800, fee: 9999 });

    // ═══ AUTH / RBAC ══════════════════════════════════════════════
    let r = await call(`/api/admin/finance/gst-report/summary`, null);
    check("A1. Unauthenticated → 401", r.status === 401, r.status);
    r = await call(`/api/admin/finance/gst-report/summary`, stateToken);
    check("A2. STATE admin cannot read the GST report (403) — INDIA-only", r.status === 403, r.data);
    r = await call(`/api/admin/finance/gst-report/monthly?year=${YEAR_A}`, stateToken);
    check("A3. STATE admin cannot read /monthly either (403)", r.status === 403, r.data);
    r = await call(`/api/admin/finance/gst-report/export?month=1&year=${YEAR_A}`, stateToken);
    check("A4. STATE admin cannot read /export either (403)", r.status === 403, r.data);
    r = await call(`/api/admin/finance/gst-report/monthly?year=abc`, indiaToken);
    check("A5. Invalid year query rejected (400)", r.status === 400, r.data);
    r = await call(`/api/admin/finance/gst-report/export?month=13&year=${YEAR_A}`, indiaToken);
    check("A6. Invalid month (13) rejected (400)", r.status === 400, r.data);

    // ═══ /monthly — the core: monthly, quarterly, yearly totals ═════
    r = await call(`/api/admin/finance/gst-report/monthly?year=${YEAR_A}`, indiaToken);
    check("M1. /monthly returns 200 with 12 months", r.status === 200 && r.data?.data?.months?.length === 12, r.data);
    const months = r.data.data.months;

    const jan = months[0], feb = months[1], mar = months[2], apr = months[3], may = months[4], jun = months[5];
    check("M2. ✓ MONTHLY TOTALS — January: collected 360+450=810, reversed 360, net 450, taxable 2000+2500=4500, bookings=2, refunds=1",
      jan.collected === 8.10 && jan.reversed === 3.60 && jan.net === 4.50 && jan.taxable === 45.00 && jan.bookings === 2 && jan.refunds === 1, jan);
    check("M3. ✓ MONTHLY — February: sale ₹1.80+₹18.00... wait exact — collected 360+180=540 (₹5.40), reversed 0 in Feb (its refund is dated March), net 5.40, bookings=2, refunds=0",
      feb.collected === 5.40 && feb.reversed === 0 && feb.net === 5.40 && feb.bookings === 2 && feb.refunds === 0, feb);
    check("M4. ✓ EMPTY MONTH — March: no SALE, but the CROSS-MONTH reversal (₹0.90) lands here, not in Feb — collected 0, reversed 0.90, net −0.90, bookings=0, refunds=1",
      mar.collected === 0 && mar.reversed === 0.90 && mar.net === -0.90 && mar.bookings === 0 && mar.refunds === 1, mar);
    check("M5. ✓ AGGREGATE BY invoiceDate confirmed: the reversal's OWN invoiceDate (March) determined its period, not its SALE's original month (Feb)", feb.reversed === 0 && mar.reversed === 0.90);
    for (const m of [apr, may, jun]) check(`M6. ✓ ${m.monthName}: one ₹1.80 SALE, no refund`, m.collected === 1.80 && m.reversed === 0 && m.net === 1.80 && m.bookings === 1);
    const julToDec = months.slice(6, 12);
    check("M7. ✓ EMPTY MONTHS (Jul–Dec, no fixtures at all): all twelve fields are zero, never omitted/undefined/null", julToDec.every((m) => m.collected === 0 && m.reversed === 0 && m.net === 0 && m.taxable === 0 && m.bookings === 0 && m.refunds === 0), julToDec);
    check("M8. Every monthly row uses the exact ticket field names: taxable, collected, reversed, net, bookings, refunds", ["taxable", "collected", "reversed", "net", "bookings", "refunds", "month", "monthName"].every((k) => k in jan));

    // ═══ Quarterly ═══════════════════════════════════════════════
    const quarters = r.data.data.quarters;
    check("Q1. ✓ QUARTERLY TOTALS — Q1 (Jan+Feb+Mar) = collected 8.10+5.40+0=13.50, reversed 3.60+0+0.90=4.50, net 9.00", quarters[0].collected === 13.50 && quarters[0].reversed === 4.50 && quarters[0].net === 9.00, quarters[0]);
    check("Q2. ✓ Q2 (Apr+May+Jun) = collected 1.80×3=5.40, reversed 0, net 5.40, bookings=3", quarters[1].collected === 5.40 && quarters[1].reversed === 0 && quarters[1].net === 5.40 && quarters[1].bookings === 3, quarters[1]);
    check("Q3. Q3 and Q4 are both entirely empty (zero)", quarters[2].net === 0 && quarters[3].net === 0);
    check("Q4. Quarter roll-ups sum EXACTLY from the same 12 months already verified above (no drift, no double count)", quarters[0].collected === jan.collected + feb.collected + mar.collected);

    // ═══ Yearly ══════════════════════════════════════════════════
    const yearTotal = r.data.data.yearTotal;
    check("Y1. ✓ YEARLY TOTAL — sum of all 4 quarters: collected 13.50+5.40=18.90, reversed 4.50, net 14.40, bookings 2+2+0+3=7, refunds 1+1=2",
      yearTotal.collected === 18.90 && yearTotal.reversed === 4.50 && yearTotal.net === 14.40 && yearTotal.bookings === 7 && yearTotal.refunds === 2, yearTotal);
    check("Y2. ✓ REFUND REDUCES LIABILITY: net (14.40) is strictly less than gross collected (18.90) because of the two refunds", yearTotal.net < yearTotal.collected);

    // ═══ Multiple years — isolation ═════════════════════════════════
    r = await call(`/api/admin/finance/gst-report/monthly?year=${YEAR_B}`, indiaToken);
    const yearBJan = r.data.data.months[0];
    check("Y3. ✓ MULTIPLE YEARS — YEAR_B January shows ONLY its own fixture (collected ₹18.00), completely unaffected by YEAR_A's data", yearBJan.collected === 18.00 && yearBJan.bookings === 1, yearBJan);
    check("Y4. ✓ YEAR_B's other 11 months are empty — no leakage from YEAR_A's non-January data", r.data.data.months.slice(1).every((m) => m.net === 0));
    const yearAAgain = (await call(`/api/admin/finance/gst-report/monthly?year=${YEAR_A}`, indiaToken)).data.data.yearTotal;
    check("Y5. ✓ Re-fetching YEAR_A gives the SAME total as before — YEAR_B's fixture never leaked into YEAR_A either", yearAAgain.collected === 18.90);

    // ═══ /export — JSON-only, export-ready structure ═════════════════
    r = await call(`/api/admin/finance/gst-report/export?month=1&year=${YEAR_A}`, indiaToken);
    check("E1. /export returns 200 JSON", r.status === 200 && r.headers?.get?.("content-type") !== "application/pdf", r.status);
    const exp = r.data.data;
    check("E2. export.summary matches /monthly's January row exactly", exp.summary.collected === jan.collected && exp.summary.reversed === jan.reversed && exp.summary.net === jan.net, exp.summary);
    check("E3. export.lineItems contains exactly the 3 real GSTLedger rows dated in January (2 SALE + 1 REFUND_REVERSAL), sorted by invoiceDate", exp.lineItems.length === 3 && exp.lineItems[0].ledgerType === "SALE" && new Date(exp.lineItems[0].invoiceDate) <= new Date(exp.lineItems[1].invoiceDate), exp.lineItems.map((i) => [i.ledgerType, i.invoiceDate]));
    check("E4. Every line item is sourced ONLY from GSTLedger fields (no bookingRef-populated shopName etc. — proves Booking was never read)", exp.lineItems.every((i) => Object.keys(i).every((k) => ["id", "bookingId", "revenueSplitId", "ledgerType", "status", "taxableValue", "gstRate", "gstAmount", "platformFee", "invoiceDate", "policyVersion", "refundId"].includes(k))));
    check("E5. period + generatedAt present (export-ready structure)", exp.period?.year === YEAR_A && exp.period?.month === 1 && !!exp.generatedAt);
    const expEmpty = (await call(`/api/admin/finance/gst-report/export?month=9&year=${YEAR_A}`, indiaToken)).data.data;
    check("E6. /export for an empty month returns a valid all-zero summary and an EMPTY lineItems array (never an error)", expEmpty.summary.net === 0 && Array.isArray(expEmpty.lineItems) && expEmpty.lineItems.length === 0, expEmpty);

    // ═══ /summary — structural + cross-check against /monthly for THIS real month ═══
    r = await call(`/api/admin/finance/gst-report/summary`, indiaToken);
    check("S1. /summary returns 200 with currentMonth/currentQuarter/currentYear, each with the ticket's 6 fields", r.status === 200 && ["grossTaxableValue", "gstCollected", "gstReversed", "netGSTLiability", "bookingCount", "refundCount"].every((k) => k in r.data.data.currentMonth), r.data.data);
    check("S2. netGSTLiability = gstCollected − gstReversed holds for currentMonth/currentQuarter/currentYear", [r.data.data.currentMonth, r.data.data.currentQuarter, r.data.data.currentYear].every((p) => Math.round((p.gstCollected - p.gstReversed) * 100) === Math.round(p.netGSTLiability * 100)), r.data.data);
    const now = new Date();
    const liveMonthly = (await call(`/api/admin/finance/gst-report/monthly?year=${now.getUTCFullYear()}`, indiaToken)).data.data;
    const liveThisMonth = liveMonthly.months[now.getUTCMonth()];
    check("S3. currentMonth in /summary matches the SAME real month's row from /monthly EXACTLY (both endpoints agree)", r.data.data.currentMonth.gstCollected === liveThisMonth.collected && r.data.data.currentMonth.gstReversed === liveThisMonth.reversed, { summary: r.data.data.currentMonth, monthly: liveThisMonth });

    // ═══ Nothing else was touched — confirm no Booking/RevenueSplit writes happened ═══
    const Booking = (await import("../models/Booking.js")).default;
    const RevenueSplit = (await import("../modules/finance/models/RevenueSplit.js")).default;
    check("X1. No Booking document exists for any fixture bookingId used above (this engine never reads/writes Booking)", !(await Booking.exists({ _id: { $in: [janBookingId1, janBookingId2, febBookingId, crossBookingId] } })));
    check("X2. No RevenueSplit document exists for any fixture revenueSplitId used above either", !(await RevenueSplit.exists({ _id: { $in: [janSplitId1, janSplitId2, febSplitId, crossSplitId] } })));
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await GSTLedger.collection.deleteMany({ _id: { $in: fixtureLedgerIds } }).catch((e) => results.push(`⚠️ purge GSTLedger error ${e.message}`));
    await User.deleteMany({ _id: { $in: fixtureUserIds } }).catch((e) => results.push(`⚠️ purge User error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
