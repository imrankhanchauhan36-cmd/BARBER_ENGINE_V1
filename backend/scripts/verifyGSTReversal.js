/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyGSTReversal.js
 *
 * P0 Revenue Calculation Engine — Step 4.2 (GST Reversal Engine) — live
 * verification. Real Atlas dev DB, disposable prefixed fixtures, purged
 * before/after.
 *
 * PART A (no real payment needed): unit-level checks of
 * createRefundReversalLedger() directly, using real GSTLedger/RevenueSplit/
 * Refund documents (all real Mongo writes, no gateway call) — proportional
 * math, idempotency, concurrency, immutability, "SALE unchanged."
 *
 * PART B (RZP_LIVE_PAYMENTS=1): the REAL end-to-end integration — a real
 * Razorpay TEST-mode payment, a real booking confirmation (which creates a
 * real SALE ledger via Step 3/4.1), then two real Razorpay refunds (50%,
 * then the remaining 50%) issued through the UNMODIFIED RazorpayRefundService,
 * completed via real refund.processed webhook payloads built from Razorpay's
 * own refund entities — proving the Step 4.2 integration fires automatically,
 * with no other file touched.
 *
 * Run:
 *   node scripts/verifyGSTReversal.js                (Part A only)
 *   RZP_LIVE_PAYMENTS=1 node scripts/verifyGSTReversal.js  (Part A + B)
 */

import "dotenv/config";
import http from "http";
import crypto from "crypto";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import RefundModel from "../models/Refund.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import { GST_LEDGER_TYPE, GST_LEDGER_STATUS } from "../modules/finance/constants/gstLedger.constants.js";
import { calculateRevenue } from "../modules/finance/services/RevenueCalculationService.js";
import { toRevenueSplitDocumentDTO } from "../modules/finance/dto/revenue.dto.js";
import { createSaleLedger, createRefundReversalLedger } from "../modules/finance/services/GSTLedgerService.js";
import { issueRazorpayRefund } from "../services/RazorpayRefundService.js";

if (String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_live_")) { console.error("Refusing to run against a LIVE Razorpay key."); process.exit(2); }
const LIVE = process.env.RZP_LIVE_PAYMENTS === "1";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_GSTREV42_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const runTag = Date.now();

const run = async () => {
  await connectDB();

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureBookingIds = [];
  const fixtureSettingsIds = [];
  const fixturePaymentIds = []; // synthetic Refund.paymentId values (Part A, no real Razorpay payment)
  let payServer = null, server = null;

  const purgeFixtures = async () => {
    await GSTLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await RevenueSplit.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await RefundModel.deleteMany({ $or: [{ bookingId: { $in: fixtureBookingIds } }, { paymentId: { $in: fixturePaymentIds } }] });
    await Transaction.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await WalletLedger.collection.deleteMany({ $or: [{ ownerId: { $in: fixtureSalonIds } }, { salonId: { $in: fixtureSalonIds } }] });
    await SalonEarnings.deleteMany({ $or: [{ salonId: { $in: fixtureSalonIds } }, { entityId: { $in: fixtureSalonIds } }] });
    await Booking.collection.deleteMany({ _id: { $in: fixtureBookingIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await RevenueSettings.deleteMany({ _id: { $in: fixtureSettingsIds.filter(Boolean) } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
  };

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to use as createdBy for fixtures");

    const owner = await User.create({ name: `${P}OWNER`, phone: phone(), role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id);
    const dayTiming = { open: "09:00", close: "20:00" };
    const salon = await Salon.create({
      ownerId: owner._id, basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
      timings: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, dayTiming])),
      location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${P} addr` },
    });
    fixtureSalonIds.push(salon._id);
    const cust = await User.create({ name: `${P}CUST`, phone: phone(), role: "USER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(cust._id);

    let slot = 0;
    const mkBooking = async ({ service = 10000 } = {}) => {
      const start = new Date(Date.now() + (120 + slot++ * 45) * 60000);
      const b = await Booking.create({
        userRef: cust._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.CONFIRMED, serviceAmountInPaise: service, commissionAmountInPaise: 2000, totalAmountInPaise: service + 2360,
      });
      fixtureBookingIds.push(b._id);
      return b;
    };
    const publish = async (platformFeeInPaise, gstRate) => {
      await RevenueSettings.updateMany({ status: "PUBLISHED" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      const last = await RevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
      const doc = await RevenueSettings.create({ platformFeeInPaise, gstRate, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: (last?.version ?? 0) + 1, createdBy: indiaAdmin._id, status: "PUBLISHED", publishedAt: new Date(), publishedBy: indiaAdmin._id });
      fixtureSettingsIds.push(doc._id);
      return doc;
    };
    const mkSplit = async (booking, settings) => {
      const calc = calculateRevenue({ serviceAmountInPaise: booking.serviceAmountInPaise, revenueSettings: { platformFeeInPaise: settings.platformFeeInPaise, gstRate: settings.gstRate, gstEnabled: true, version: settings.version } });
      return RevenueSplit.create({ bookingId: booking._id, ...toRevenueSplitDocumentDTO(calc) });
    };
    // A synthetic, PROCESSED Refund fixture — lets Part A exercise the proportional
    // math without a real gateway call. bookingId/paymentId are disposable/fake.
    const mkRefundFixture = async ({ bookingId, amountInPaise, paymentAmountInPaise, razorpayRefundId }) => {
      const paymentId = `pay_ZTEST${runTag}${Math.floor(Math.random() * 1e6)}`;
      fixturePaymentIds.push(paymentId);
      return RefundModel.create({
        paymentId, bookingId, amountInPaise, paymentAmountInPaise, isFull: amountInPaise >= paymentAmountInPaise,
        reason: "BOOKING_CANCELLED", initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}k_${runTag}_${Math.random()}`,
        razorpayRefundId, refundStatus: "PROCESSED", gatewayStatus: "processed", processedAt: new Date(),
      });
    };

    // ═══ PART A — unit-level, real Mongo writes, no gateway call ════
    const settings1 = await publish(2000, 18); // ₹20 fee, 18% GST
    const b1 = await mkBooking({ service: 10000 });
    const split1 = await mkSplit(b1, settings1);
    const sale1 = await createSaleLedger({ revenueSplit: split1 });
    check("Sanity: SALE ledger created (fee ₹20, GST ₹3.60)", sale1.gstAmountInPaise === 360 && sale1.platformFeeInPaise === 2000);

    // A1: exact LOCKED example — 50% refund → reversal ₹1.80
    const refA = await mkRefundFixture({ bookingId: b1._id, amountInPaise: 6180, paymentAmountInPaise: 12360, razorpayRefundId: `rfnd_ZTEST${runTag}A1` });
    const reversalA1 = await createRefundReversalLedger({ revenueSplit: split1, refundId: refA.razorpayRefundId });
    check("A1. 50% refund (₹61.80 of ₹123.60) → reversal = ₹1.80 EXACTLY (the ticket's own example)", reversalA1?.gstAmountInPaise === 180, reversalA1);
    check("A2. ledgerType REFUND_REVERSAL, status REVERSED, refundId stored", reversalA1.ledgerType === GST_LEDGER_TYPE.REFUND_REVERSAL && reversalA1.status === GST_LEDGER_STATUS.REVERSED && reversalA1.refundId === refA.razorpayRefundId);
    check("A3. gstRate + policyVersion copied VERBATIM from the SALE row, never recomputed", reversalA1.gstRate === sale1.gstRate && reversalA1.policyVersion === sale1.policyVersion);
    check("A4. taxableValue and platformFee also apportioned proportionally (50% of ₹20 = ₹10)", reversalA1.taxableValueInPaise === 1000 && reversalA1.platformFeeInPaise === 1000, reversalA1);

    // A5: SALE unchanged after the reversal
    const sale1After = await GSTLedger.findById(sale1._id).lean();
    check("A5. SALE ledger is COMPLETELY UNCHANGED by the reversal — still ₹3.60, never updated", sale1After.gstAmountInPaise === 360 && String(sale1After._id) === String(sale1._id) && sale1After.status === GST_LEDGER_STATUS.COLLECTED);

    // A6: idempotent — calling again for the SAME refundId returns the SAME row
    const reversalA1Again = await createRefundReversalLedger({ revenueSplit: split1, refundId: refA.razorpayRefundId });
    check("A6. Duplicate refund safe: calling again for the SAME refundId returns the EXISTING row, not a new one", String(reversalA1Again._id) === String(reversalA1._id) && (await GSTLedger.countDocuments({ refundId: refA.razorpayRefundId })) === 1);

    // A7: "full refund after partial creates remaining balance" — a SECOND, independent refund for the remaining 50%
    const refB = await mkRefundFixture({ bookingId: b1._id, amountInPaise: 6180, paymentAmountInPaise: 12360, razorpayRefundId: `rfnd_ZTEST${runTag}A7` });
    const reversalA7 = await createRefundReversalLedger({ revenueSplit: split1, refundId: refB.razorpayRefundId });
    check("A7. The REMAINING 50% (a separate refundId) → a SEPARATE reversal of ₹1.80 (not zero, not double)", reversalA7?.gstAmountInPaise === 180 && String(reversalA7._id) !== String(reversalA1._id));
    const allRowsB1 = await GSTLedger.find({ revenueSplitId: split1._id }).lean();
    const netGst = allRowsB1.filter((r) => r.ledgerType === "SALE").reduce((s, r) => s + r.gstAmountInPaise, 0) - allRowsB1.filter((r) => r.ledgerType === "REFUND_REVERSAL").reduce((s, r) => s + r.gstAmountInPaise, 0);
    check("A8. Net GST liability for this booking is EXACTLY 0 after both refunds", netGst === 0, { netGst, rows: allRowsB1.map((r) => [r.ledgerType, r.gstAmountInPaise]) });
    check("A9. Exactly 3 rows total for this RevenueSplit: 1 SALE + 2 REFUND_REVERSAL", allRowsB1.length === 3);

    // A10: concurrent race on a THIRD, independent refund/booking
    const b2 = await mkBooking({ service: 20000 });
    const split2 = await mkSplit(b2, settings1);
    const sale2 = await createSaleLedger({ revenueSplit: split2 });
    const refC = await mkRefundFixture({ bookingId: b2._id, amountInPaise: 5220, paymentAmountInPaise: 26100, razorpayRefundId: `rfnd_ZTEST${runTag}A10` }); // 20% refund
    const raced = await Promise.allSettled(Array.from({ length: 5 }, () => createRefundReversalLedger({ revenueSplit: split2, refundId: refC.razorpayRefundId })));
    check("A10. Five CONCURRENT calls for the SAME refundId → none throws", raced.every((r) => r.status === "fulfilled"), raced.map((r) => r.status === "rejected" ? r.reason?.message : "ok"));
    const raceIds = raced.filter((r) => r.status === "fulfilled" && r.value).map((r) => String(r.value._id));
    check("A11. All concurrent calls converge on the SAME reversal row — unique partial index held under a real race", new Set(raceIds).size === 1);
    check("A12. Exactly ONE REFUND_REVERSAL row exists after the race, proportional (20% of the fixed ₹3.60 GST = ₹0.72 — GST is on the flat ₹20 fee, not the ₹200 service amount)", (await GSTLedger.countDocuments({ revenueSplitId: split2._id, ledgerType: "REFUND_REVERSAL" })) === 1 && (await GSTLedger.findOne({ revenueSplitId: split2._id, ledgerType: "REFUND_REVERSAL" }).lean()).gstAmountInPaise === 72);

    // A13: no SALE ledger (GST disabled) → nothing to reverse
    const settingsNoGst = await publish(1500, 18); // will be created with gstEnabled left default true via calculateRevenue, so force zero-fee instead for a real "no SALE" case
    const b3 = await mkBooking({ service: 5000 });
    const calcZero = calculateRevenue({ serviceAmountInPaise: 5000, revenueSettings: { platformFeeInPaise: 0, gstRate: 18, gstEnabled: true, version: settingsNoGst.version } });
    const split3 = await RevenueSplit.create({ bookingId: b3._id, ...toRevenueSplitDocumentDTO(calcZero) });
    const refD = await mkRefundFixture({ bookingId: b3._id, amountInPaise: 5000, paymentAmountInPaise: 5000, razorpayRefundId: `rfnd_ZTEST${runTag}A13` });
    const reversalNoSale = await createRefundReversalLedger({ revenueSplit: split3, refundId: refD.razorpayRefundId });
    check("A13. No SALE ledger exists (zero GST) → createRefundReversalLedger returns null, no row created", reversalNoSale === null && (await GSTLedger.countDocuments({ revenueSplitId: split3._id })) === 0);

    // A14: refund not yet PROCESSED (PENDING) → no reversal yet
    const refPending = await RefundModel.create({ paymentId: `pay_ZTEST${runTag}pending`, bookingId: b2._id, amountInPaise: 1000, paymentAmountInPaise: 26100, isFull: false, reason: "BOOKING_CANCELLED", initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}kpending_${runTag}`, razorpayRefundId: `rfnd_ZTEST${runTag}A14`, refundStatus: "PENDING", gatewayStatus: "pending" });
    fixturePaymentIds.push(refPending.paymentId);
    const reversalPending = await createRefundReversalLedger({ revenueSplit: split2, refundId: refPending.razorpayRefundId });
    check("A14. A refund still PENDING (not PROCESSED) → no reversal created", reversalPending === null && (await GSTLedger.countDocuments({ refundId: refPending.razorpayRefundId })) === 0);

    // A15: unknown refundId → null, no throw
    const reversalUnknown = await createRefundReversalLedger({ revenueSplit: split1, refundId: `rfnd_ZTEST${runTag}DOESNOTEXIST` });
    check("A15. Unknown refundId → returns null, no error", reversalUnknown === null);

    // ═══ Immutability of a REFUND_REVERSAL row ═══════════════════════
    let u1, u2, d1;
    try { await GSTLedger.updateOne({ _id: reversalA1._id }, { $set: { gstAmountInPaise: 1 } }); } catch (e) { u1 = e; }
    try { await GSTLedger.findOneAndUpdate({ _id: reversalA1._id }, { $set: { status: "COLLECTED" } }); } catch (e) { u2 = e; }
    try { await GSTLedger.deleteOne({ _id: reversalA1._id }); } catch (e) { d1 = e; }
    check("I1. updateOne on a REFUND_REVERSAL row is blocked", /immutable/i.test(u1?.message || ""));
    check("I2. findOneAndUpdate on a REFUND_REVERSAL row is blocked", /immutable/i.test(u2?.message || ""));
    check("I3. deleteOne on a REFUND_REVERSAL row is blocked", /immutable/i.test(d1?.message || ""));
    check("I4. row completely unchanged after every attack", (await GSTLedger.findById(reversalA1._id).lean()).gstAmountInPaise === 180);

    // ═══ A direct model-level duplicate refundId is DB-rejected too ═══
    let directDupErr;
    try { await GSTLedger.create({ bookingId: b1._id, revenueSplitId: split1._id, ledgerType: "REFUND_REVERSAL", status: "REVERSED", taxableValueInPaise: 1000, gstRate: 18, gstAmountInPaise: 180, platformFeeInPaise: 1000, invoiceDate: new Date(), policyVersion: split1.policyVersion, refundId: refA.razorpayRefundId }); } catch (e) { directDupErr = e; }
    check("D1. A direct model-level duplicate REFUND_REVERSAL for the same refundId is rejected by the DB (partial unique index)", directDupErr?.code === 11000, directDupErr?.message);
    check("D2. Two different SALE rows can never collide with the new refundId index (SALE rows all have refundId=null, index is partial to REFUND_REVERSAL only)", (await GSTLedger.countDocuments({ ledgerType: "SALE", refundId: null })) >= 2);

    // ═══ PART B — real end-to-end Razorpay flow ══════════════════════
    if (!LIVE) {
      results.push("   PART B skipped (set RZP_LIVE_PAYMENTS=1 to pay one real test-mode order and issue two real refunds)");
    } else {
      const settingsLive = await publish(2000, 18);
      const oidAppImport = await import("../app.js");
      server = oidAppImport.default.listen(0);
      await new Promise((r) => server.once("listening", r));
      const port = server.address().port;
      const call = (path, token, { method = "GET", body, headers = {}, raw } = {}) =>
        fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined })
          .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
      const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
      const custB = { u: await User.create({ name: `${P}CUSTB`, phone: phone(), role: "USER", accountStatus: "ACTIVE", walletBalance: 0 }) };
      fixtureUserIds.push(custB.u._id);
      custB.token = generateAccessToken({ _id: custB.u._id, role: "USER", tokenVersion: 0 });
      const start = new Date(Date.now() + 180 * 60000);
      const bLive = await Booking.create({ userRef: custB.u._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()], bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 1800000), serviceDuration: 30, status: BOOKING_STATUS.HOLD, lockUntil: new Date(Date.now() + 90 * 60000), serviceAmountInPaise: 10000, commissionAmountInPaise: 2360, totalAmountInPaise: 12360 });
      fixtureBookingIds.push(bLive._id);
      const oRes = await call("/api/payments/create-order", custB.token, { method: "POST", body: { bookingId: String(bLive._id) } });
      const o = oRes.data;

      const paid = new Map();
      payServer = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        if (u.pathname === "/pay") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<!doctype html><meta charset=utf-8><title>Pay</title><body style="font-family:sans-serif"><h3>Razorpay TEST payment — ₹123.60 — click SUCCESS on the demo bank page</h3><form method="POST" action="https://api.razorpay.com/v1/checkout/embedded"><input type=hidden name=key_id value="${process.env.RAZORPAY_KEY_ID}"><input type=hidden name=order_id value="${o.orderId}"><input type=hidden name=name value="Zemish test"><input type=hidden name="prefill[contact]" value="+918123456789"><input type=hidden name="prefill[email]" value="ztest@example.com"><input type=hidden name=callback_url value="http://localhost:6161/callback"><input type=hidden name=cancel_url value="http://localhost:6161/callback"><button type=submit>Pay with Razorpay (test mode)</button></form></body>`); }
        if (u.pathname === "/callback") { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { paid.set("1", Object.fromEntries(new URLSearchParams(raw))); res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>done</title><h3>result received — you can close this page</h3>"); }); return; }
        res.writeHead(404); res.end();
      });
      await new Promise((r) => payServer.listen(6161, r));
      console.log(`\nPAYMENT PAGE READY:\n  http://localhost:6161/pay  (₹123.60)\nWaiting up to 20 minutes…\n`);
      const t0 = Date.now();
      while (paid.size < 1 && Date.now() - t0 < 20 * 60000) await new Promise((r) => setTimeout(r, 1000));
      check("B0. Real test payment completed", paid.size === 1);

      if (paid.size === 1) {
        const p1 = paid.get("1");
        const sig = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${o.orderId}|${p1.razorpay_payment_id}`).digest("hex");
        const cRes = await call("/api/v1/bookings/user/confirm", custB.token, { method: "POST", body: { bookingId: String(bLive._id), paymentMethod: "RAZORPAY", orderId: o.orderId, paymentId: p1.razorpay_payment_id, razorpaySignature: sig } });
        check("B1. Real booking confirmed via the client flow", cRes.status === 200, cRes.data);
        const liveSplit = await RevenueSplit.findOne({ bookingId: bLive._id }).lean();
        const liveSale = await GSTLedger.findOne({ revenueSplitId: liveSplit._id, ledgerType: "SALE" }).lean();
        check("B2. Real SALE GST ledger auto-created via Step 3/4.1 (unchanged): fee ₹20, GST ₹3.60", liveSale?.gstAmountInPaise === 360 && liveSale?.platformFeeInPaise === 2000, liveSale);

        // Refund #1 — 50%, issued through the UNMODIFIED RazorpayRefundService (P0-C).
        const r1 = await issueRazorpayRefund({ paymentId: p1.razorpay_payment_id, amountInPaise: 6180, reason: "SUPPORT_TEST", bookingId: bLive._id, initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}refund1_${runTag}` });
        check("B3. Real 50% Razorpay refund (₹61.80) created via the UNCHANGED refund engine", /^rfnd_/.test(r1.refund.razorpayRefundId || ""), r1.refund);
        // issueRazorpayRefund already calls completeRefund() internally when Razorpay answers processed immediately;
        // if it answered PENDING instead, deliver a real refund.processed webhook to complete it (same pattern as P0-C's own scripts).
        let refundDoc1 = await RefundModel.findOne({ razorpayRefundId: r1.refund.razorpayRefundId }).lean();
        if (refundDoc1.refundStatus !== "PROCESSED") {
          process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "ztest_rzp_webhook_secret_p0d42";
          let refundEntity = await rz.refunds.fetch(r1.refund.razorpayRefundId);
          for (let i = 0; i < 10 && refundEntity.status !== "processed"; i++) { await new Promise((res) => setTimeout(res, 2000)); refundEntity = await rz.refunds.fetch(r1.refund.razorpayRefundId); }
          const payment = await rz.payments.fetch(p1.razorpay_payment_id);
          const wh = JSON.stringify({ entity: "event", event: "refund.processed", contains: ["refund", "payment"], payload: { refund: { entity: refundEntity }, payment: { entity: payment } }, created_at: Math.floor(Date.now() / 1000) });
          const whSig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(wh).digest("hex");
          await call("/api/webhooks/razorpay", null, { method: "POST", raw: wh, headers: { "content-type": "application/json", "x-razorpay-event-id": `${P}wh1_${runTag}`, "x-razorpay-signature": whSig } });
          refundDoc1 = await RefundModel.findOne({ razorpayRefundId: r1.refund.razorpayRefundId }).lean();
        }
        check("B4. Refund #1 reached PROCESSED", refundDoc1?.refundStatus === "PROCESSED", refundDoc1);
        const reversal1 = await GSTLedger.findOne({ refundId: r1.refund.razorpayRefundId }).lean();
        check("B5. Step 4.2 fired AUTOMATICALLY inside completeRefund() — a REFUND_REVERSAL row exists for exactly ₹1.80 (50% of ₹3.60), with NO other file touched", reversal1?.gstAmountInPaise === 180 && reversal1?.ledgerType === "REFUND_REVERSAL", reversal1);
        const saleAfter1 = await GSTLedger.findById(liveSale._id).lean();
        check("B6. Real SALE ledger untouched after refund #1", saleAfter1.gstAmountInPaise === 360);

        // Refund #2 — the REMAINING 50%, a SEPARATE Razorpay refund.
        const r2 = await issueRazorpayRefund({ paymentId: p1.razorpay_payment_id, amountInPaise: 6180, reason: "SUPPORT_TEST", bookingId: bLive._id, initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}refund2_${runTag}` });
        let refundDoc2 = await RefundModel.findOne({ razorpayRefundId: r2.refund.razorpayRefundId }).lean();
        if (refundDoc2.refundStatus !== "PROCESSED") {
          let refundEntity2 = await rz.refunds.fetch(r2.refund.razorpayRefundId);
          for (let i = 0; i < 10 && refundEntity2.status !== "processed"; i++) { await new Promise((res) => setTimeout(res, 2000)); refundEntity2 = await rz.refunds.fetch(r2.refund.razorpayRefundId); }
          const payment2 = await rz.payments.fetch(p1.razorpay_payment_id);
          const wh2 = JSON.stringify({ entity: "event", event: "refund.processed", contains: ["refund", "payment"], payload: { refund: { entity: refundEntity2 }, payment: { entity: payment2 } }, created_at: Math.floor(Date.now() / 1000) });
          const whSig2 = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(wh2).digest("hex");
          await call("/api/webhooks/razorpay", null, { method: "POST", raw: wh2, headers: { "content-type": "application/json", "x-razorpay-event-id": `${P}wh2_${runTag}`, "x-razorpay-signature": whSig2 } });
          refundDoc2 = await RefundModel.findOne({ razorpayRefundId: r2.refund.razorpayRefundId }).lean();
        }
        check("B7. Refund #2 (the REMAINING real 50%) reached PROCESSED", refundDoc2?.refundStatus === "PROCESSED");
        const reversal2 = await GSTLedger.findOne({ refundId: r2.refund.razorpayRefundId }).lean();
        check("B8. 'Full refund after partial creates remaining balance': the SECOND real refund creates its OWN ₹1.80 reversal (not zero, not double)", reversal2?.gstAmountInPaise === 180 && String(reversal2._id) !== String(reversal1._id));
        const allLive = await GSTLedger.find({ revenueSplitId: liveSplit._id }).lean();
        const netLive = allLive.filter((r) => r.ledgerType === "SALE").reduce((s, r) => s + r.gstAmountInPaise, 0) - allLive.filter((r) => r.ledgerType === "REFUND_REVERSAL").reduce((s, r) => s + r.gstAmountInPaise, 0);
        check("B9. NET GST LIABILITY for this real, fully-refunded booking is EXACTLY ₹0.00 (SALE ₹3.60 − ₹1.80 − ₹1.80)", netLive === 0, { netLive, rows: allLive.map((r) => [r.ledgerType, r.gstAmountInPaise]) });
        check("B10. Existing P0-C refund engine's own outcome is completely normal: Razorpay reports the payment fully refunded", (await rz.payments.fetch(p1.razorpay_payment_id)).amount_refunded === 12360);
      }
    }
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    if (payServer) payServer.close();
    if (server) server.close();
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
