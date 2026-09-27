/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRazorpayBookingPayment.js
 *
 * RAZORPAY P0-A — live verification of booking payment verification
 * against the REAL Razorpay TEST-mode API (real orders, real payment
 * fetches), over real HTTP + real MongoDB (Atlas dev DB, prefixed
 * fixtures, purged before/after). Refuses to run with a live key.
 *
 * PART A (no card needed): create-order idempotency / persistence / key_id,
 *   and confirm-time rejections using valid HMACs computed with the key
 *   secret (exactly what an attacker holding a signed order/payment pair
 *   would send).
 * PART B (needs two real captured TEST payments): set RZP_LIVE_PAYMENTS=1.
 *   The script serves a localhost-only page that opens Razorpay Checkout
 *   for two orders; pay each with Razorpay's published test card. It then
 *   verifies acceptance of a genuine captured payment and rejection of
 *   cross-booking use, reuse and amount mismatch.
 *
 * Run:  cd backend && node scripts/verifyRazorpayBookingPayment.js
 *       RZP_LIVE_PAYMENTS=1 node scripts/verifyRazorpayBookingPayment.js
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
import Notification from "../models/Notification.js";
import { evaluateCapturedPayment } from "../services/Razorpay.service.js";

if (!String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")) {
  console.error("Refusing to run: RAZORPAY_KEY_ID is not a TEST-mode key (rzp_test_…).");
  process.exit(2);
}

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_RZP0A_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIVE = process.env.RZP_LIVE_PAYMENTS === "1";
const sign = (orderId, paymentId) => crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

const purge = async () => {
  const users = await User.find({ name: new RegExp(`^${P}`) }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const salons = await Salon.find({ ownerId: { $in: userIds } }).select("_id").lean();
  const salonIds = salons.map((s) => s._id);
  const bookings = await Booking.find({ userRef: { $in: userIds } }).select("_id").lean();
  const bookingIds = bookings.map((b) => b._id);
  await Transaction.deleteMany({ bookingId: { $in: bookingIds } });
  await WalletLedger.collection.deleteMany({ $or: [{ ownerId: { $in: salonIds } }, { salonId: { $in: salonIds } }] });
  await SalonEarnings.deleteMany({ $or: [{ salonId: { $in: salonIds } }, { entityId: { $in: salonIds } }] });
  await Notification.deleteMany({ recipientId: { $in: userIds } }).catch(() => {});
  await Booking.collection.deleteMany({ _id: { $in: bookingIds } });
  await Salon.deleteMany({ _id: { $in: salonIds } });
  await User.deleteMany({ _id: { $in: userIds } });
};

const run = async () => {
  await connectDB();
  await purge();
  // the P0-A unique index must exist before the uniqueness checks below
  await Booking.collection.createIndex({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: "string" } } }).catch(() => {});
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;
  const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

  const call = (path, token, { method = "GET", body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

  let payServer = null;
  try {
    const mkUser = async (label) => {
      const u = await User.create({ name: `${P}${label}`, phone: phone(), role: "USER", accountStatus: "ACTIVE", walletBalance: 0 });
      return { u, token: generateAccessToken({ _id: u._id, role: "USER", tokenVersion: 0 }) };
    };
    const owner = await User.create({ name: `${P}OWNER`, phone: phone(), role: "OWNER", accountStatus: "ACTIVE" });
    const dayTiming = { open: "09:00", close: "20:00" };
    const salon = await Salon.create({
      ownerId: owner._id, basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
      timings: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, dayTiming])),
      location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${P} addr` },
    });
    let slot = 0;
    const mkBooking = async (user, { total = 12000, lockMinutes = 10 } = {}) => {
      const start = new Date(Date.now() + (120 + slot++ * 45) * 60000);
      return Booking.create({
        userRef: user.u._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.HOLD, lockUntil: new Date(Date.now() + lockMinutes * 60000),
        serviceAmountInPaise: total - 2000, commissionAmountInPaise: 2000, totalAmountInPaise: total,
      });
    };
    const createOrder = (user, bookingId) => call("/api/payments/create-order", user.token, { method: "POST", body: { bookingId: String(bookingId) } });
    const confirm = (user, bookingId, orderId, paymentId, sig) =>
      call("/api/v1/bookings/user/confirm", user.token, { method: "POST", body: { bookingId: String(bookingId), paymentMethod: "RAZORPAY", orderId, paymentId, razorpaySignature: sig ?? sign(orderId, paymentId) } });
    const fresh = (id) => Booking.findById(id).lean();

    // ═══ Unit: pure verdicts ═════════════════════════════════════
    const okPay = { id: "pay_X", order_id: "order_X", currency: "INR", amount: 12000, status: "captured", amount_refunded: 0 };
    const ev = (over) => evaluateCapturedPayment({ payment: { ...okPay, ...over }, orderId: "order_X", paymentId: "pay_X", amountInPaise: 12000 });
    check("U1 captured + matching order/amount/currency accepted", ev({}).ok === true);
    check("U2 authorized (not captured) rejected", ev({ status: "authorized" }).code === "NOT_CAPTURED");
    check("U3 failed / created rejected", ev({ status: "failed" }).code === "NOT_CAPTURED" && ev({ status: "created" }).code === "NOT_CAPTURED");
    check("U4 wrong order rejected", ev({ order_id: "order_OTHER" }).code === "ORDER_MISMATCH");
    check("U5 wrong amount rejected (underpayment and overpayment)", ev({ amount: 100 }).code === "AMOUNT_MISMATCH" && ev({ amount: 999999 }).code === "AMOUNT_MISMATCH");
    check("U6 non-INR rejected", ev({ currency: "USD" }).code === "CURRENCY_MISMATCH");
    check("U7 refunded payment rejected", ev({ amount_refunded: 12000, status: "captured" }).code === "PAYMENT_REFUNDED");
    check("U8 payment id mismatch rejected", evaluateCapturedPayment({ payment: { ...okPay, id: "pay_Y" }, orderId: "order_X", paymentId: "pay_X", amountInPaise: 12000 }).code === "PAYMENT_MISMATCH");

    // ═══ PART A — create-order ═══════════════════════════════════
    const cu = await mkUser("CUST_A");
    const b1 = await mkBooking(cu, { total: 12000 });
    let r = await createOrder(cu, b1._id);
    const o1 = r.data;
    const stored = await fresh(b1._id);
    check("A1 create-order 200 with a real Razorpay order, amount = booking total, INR", r.status === 200 && /^order_/.test(o1.orderId) && o1.amount === 12000 && o1.currency === "INR", r.data);
    check("A2 keyId returned and equals the configured RAZORPAY_KEY_ID (never the secret)", o1.keyId === process.env.RAZORPAY_KEY_ID && !JSON.stringify(r.data).includes(process.env.RAZORPAY_KEY_SECRET));
    check("A3 razorpayOrderId persisted on the booking", stored.razorpayOrderId === o1.orderId, stored.razorpayOrderId);
    const realOrder = await rz.orders.fetch(o1.orderId);
    check("A4 the order really exists at Razorpay with notes.bookingId", realOrder.status === "created" && realOrder.notes?.bookingId === String(b1._id) && realOrder.amount === 12000, realOrder);
    r = await createOrder(cu, b1._id);
    check("A5 create-order again → SAME order (idempotent), reused:true", r.status === 200 && r.data.orderId === o1.orderId && r.data.reused === true, r.data);
    const b2 = await mkBooking(cu, { total: 15000 });
    const conc = await Promise.all([1, 2, 3, 4, 5].map(() => createOrder(cu, b2._id)));
    const ids = new Set(conc.map((x) => x.data.orderId));
    check("A6 five concurrent create-order calls converge on ONE order, all 200", conc.every((x) => x.status === 200) && ids.size === 1 && (await fresh(b2._id)).razorpayOrderId === [...ids][0], [...ids]);
    const other = await mkUser("CUST_B");
    check("A8 another user cannot create an order for this booking (403)", (await createOrder(other, b1._id)).status === 403);
    const bExp = await mkBooking(cu, { lockMinutes: -1 });
    check("A9 expired hold → 409, no order minted", (await createOrder(cu, bExp._id)).status === 409 && (await fresh(bExp._id)).razorpayOrderId === null);
    const bDone = await mkBooking(cu);
    await Booking.collection.updateOne({ _id: bDone._id }, { $set: { status: "CONFIRMED" } });
    check("A10 non-HOLD booking → 409", (await createOrder(cu, bDone._id)).status === 409);
    const b3 = await mkBooking(cu, { total: 13000 });
    await Booking.collection.updateOne({ _id: b3._id }, { $set: { razorpayOrderId: "order_DOESNOTEXIST000" } });
    r = await createOrder(cu, b3._id);
    check("A11 stored order unknown to Razorpay → replaced by a fresh real order", r.status === 200 && r.data.orderId !== "order_DOESNOTEXIST000" && (await fresh(b3._id)).razorpayOrderId === r.data.orderId, r.data);
    const b4 = await mkBooking(cu, { total: 14000 });
    let dupErr = null;
    try { await Booking.collection.updateOne({ _id: b4._id }, { $set: { razorpayOrderId: o1.orderId } }); } catch (e) { dupErr = e; }
    check("A12 one order cannot be attached to two bookings (unique index)", dupErr?.code === 11000, dupErr?.message);

    // ═══ PART A — confirm rejections (valid HMACs, no real payment) ═══
    const bOrdA = await mkBooking(cu, { total: 12500 });
    const oA = (await createOrder(cu, bOrdA._id)).data;
    const bOrdB = await mkBooking(cu, { total: 12600 });
    const oB = (await createOrder(cu, bOrdB._id)).data;
    r = await confirm(cu, bOrdA._id, oB.orderId, "pay_FAKE00000000001");
    check("C1 valid HMAC but order belongs to ANOTHER booking → 400, booking stays HOLD", r.status === 400 && /not made for this booking/i.test(r.data.message || "") && (await fresh(bOrdA._id)).status === "HOLD", r.data);
    r = await confirm(cu, bOrdA._id, oA.orderId, "pay_FAKE00000000002");
    check("C2 valid HMAC + right order but payment id does not exist at Razorpay → 400, still HOLD", r.status === 400 && /not found/i.test(r.data.message || "") && (await fresh(bOrdA._id)).status === "HOLD" && (await Transaction.countDocuments({ bookingId: bOrdA._id })) === 0, r.data);
    r = await confirm(cu, bOrdA._id, oA.orderId, "pay_FAKE00000000003", "0".repeat(64));
    check("C3 invalid HMAC → 403 (unchanged behaviour)", r.status === 403, r.data);
    check("C4 nothing was recorded by any rejected attempt (no Transaction, no wallet credit)", (await Transaction.countDocuments({ bookingId: { $in: [bOrdA._id, bOrdB._id] } })) === 0 && !(await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise);
    // legacy booking (no stored order): only an order Razorpay says was made for THIS booking is accepted
    const bLeg = await mkBooking(cu, { total: 12700 });
    const legOrder = await rz.orders.create({ amount: 12700, currency: "INR", receipt: `booking_${bLeg._id}`, notes: { bookingId: String(bLeg._id) } });
    const foreign = await rz.orders.create({ amount: 12700, currency: "INR", receipt: `x_${Date.now()}`, notes: { bookingId: String(oid()) } });
    r = await confirm(cu, bLeg._id, foreign.id, "pay_FAKE00000000004");
    check("C5 legacy booking (no stored order): an order made for a different booking → 400", r.status === 400 && /not made for this booking/i.test(r.data.message || ""), r.data);
    r = await confirm(cu, bLeg._id, legOrder.id, "pay_FAKE00000000005");
    check("C6 legacy booking: its own order passes the binding check, then fails on the (fake) payment → 400 not found", r.status === 400 && /not found/i.test(r.data.message || ""), r.data);

    // ═══ Unchanged paths: WALLET payment and the dev MOCK bypass ══════
    const wu = await mkUser("CUST_WALLET");
    await User.updateOne({ _id: wu.u._id }, { $set: { walletBalance: 500 } });
    const bW = await mkBooking(wu, { total: 12000 });
    r = await call("/api/v1/bookings/user/confirm", wu.token, { method: "POST", body: { bookingId: String(bW._id), paymentMethod: "WALLET" } });
    check("D1 WALLET payment confirm unaffected (no gateway call) → 200 CONFIRMED", r.status === 200 && (await fresh(bW._id)).status === "CONFIRMED", r.data);
    const bM = await mkBooking(wu, { total: 12000 });
    r = await confirm(wu, bM._id, "order_MOCK000000001", "pay_MOCK000000001", "0".repeat(64));
    check("D2 without the explicit bypass flag a MOCK-looking request is rejected (403)", r.status === 403, r.data);
    process.env.RAZORPAY_ALLOW_TEST_BYPASS = "true";
    r = await call("/api/v1/bookings/user/confirm", wu.token, { method: "POST", body: { bookingId: String(bM._id), paymentMethod: "MOCK_RAZORPAY", orderId: "order_MOCK000000001", paymentId: "pay_MOCK000000001", razorpaySignature: "0".repeat(64) } });
    delete process.env.RAZORPAY_ALLOW_TEST_BYPASS;
    check("D3 explicit dev MOCK_RAZORPAY bypass (flag on, non-production) still works without a real payment → 200", r.status === 200 && (await fresh(bM._id)).status === "CONFIRMED", r.data);
    const bM2 = await mkBooking(wu, { total: 12000 });
    r = await call("/api/v1/bookings/user/confirm", wu.token, { method: "POST", body: { bookingId: String(bM2._id), paymentMethod: "RAZORPAY", orderId: "order_MOCK000000002", paymentId: "pay_MOCK000000002", razorpaySignature: "0".repeat(64) } });
    check("D4 a real RAZORPAY payment can never take the bypass path (403)", r.status === 403, r.data);

    // ═══ PART B — real captured TEST payments ═══════════════════
    if (!LIVE) {
      results.push("   PART B skipped (set RZP_LIVE_PAYMENTS=1 to run with real test-mode payments)");
    } else {
      const bPay1 = await mkBooking(cu, { total: 11100 });      // paid for real, confirmed
      const bPay2 = await mkBooking(cu, { total: 22200 });      // paid for real, used for attack tests
      const bAtk = await mkBooking(cu, { total: 22200 });       // victim of cross-booking reuse
      const oP1 = (await createOrder(cu, bPay1._id)).data;
      const oP2 = (await createOrder(cu, bPay2._id)).data;
      const oAtk = (await createOrder(cu, bAtk._id)).data;
      const paid = new Map();
      payServer = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        if (u.pathname === "/pay") {
          const which = u.searchParams.get("o");
          const orderId = which === "1" ? oP1.orderId : oP2.orderId;
          const amount = which === "1" ? oP1.amount : oP2.amount;
          // Razorpay hosted checkout in REDIRECT mode (top-level page, no iframe): the
          // form posts to Razorpay, which posts the result back to /callback below.
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end(`<!doctype html><meta charset=utf-8><title>Pay ${which}</title><body style="font-family:sans-serif">
<h3>Razorpay TEST payment #${which} — ₹${amount / 100} (order ${orderId})</h3>
<form method="POST" action="https://api.razorpay.com/v1/checkout/embedded">
<input type=hidden name=key_id value="${process.env.RAZORPAY_KEY_ID}">
<input type=hidden name=order_id value="${orderId}">
<input type=hidden name=name value="Zemish test">
<input type=hidden name="prefill[contact]" value="+918123456789">
<input type=hidden name="prefill[email]" value="ztest@example.com">
<input type=hidden name=callback_url value="http://localhost:6262/callback?o=${which}">
<input type=hidden name=cancel_url value="http://localhost:6262/cancelled">
<button id=b type=submit>Pay with Razorpay (test mode)</button></form></body>`);
        }
        if (u.pathname === "/callback" && req.method === "POST") {
          let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
            const f = Object.fromEntries(new URLSearchParams(raw));
            if (f.razorpay_payment_id) paid.set(u.searchParams.get("o"), f);
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<!doctype html><title>done</title><body style="font-family:sans-serif"><h3>${f.razorpay_payment_id ? "Payment captured by Razorpay — result received. You can close this page." : "Payment not completed: " + (f["error[description]"] || "unknown")}</h3></body>`);
          });
          return;
        }
        res.writeHead(404); res.end();
      });
      await new Promise((r) => payServer.listen(6262, r));
      console.log(`\nPAYMENT PAGES READY — pay with Razorpay's test card:\n  http://localhost:6262/pay?o=1   (₹111.00)\n  http://localhost:6262/pay?o=2   (₹222.00)\nWaiting up to 15 minutes…\n`);
      const t0 = Date.now();
      while (paid.size < 2 && Date.now() - t0 < 15 * 60000) await sleep(1000);
      check("B0 both real test payments completed in Razorpay Checkout", paid.size === 2, [...paid.keys()]);
      if (paid.size === 2) {
        const p1 = paid.get("1"), p2 = paid.get("2");
        const rp1 = await rz.payments.fetch(p1.razorpay_payment_id);
        const rp2 = await rz.payments.fetch(p2.razorpay_payment_id);
        check("B1 Razorpay itself reports both payments captured for the right orders and amounts",
          rp1.status === "captured" && rp1.order_id === oP1.orderId && rp1.amount === 11100 && rp2.status === "captured" && rp2.order_id === oP2.orderId && rp2.amount === 22200, { s1: rp1.status, s2: rp2.status });
        check("B2 the checkout-returned signatures are genuine HMACs (sanity of the harness)", p1.razorpay_signature === sign(oP1.orderId, p1.razorpay_payment_id));

        // — attacks first, while everything is still HOLD —
        r = await confirm(cu, bAtk._id, oP2.orderId, p2.razorpay_payment_id, p2.razorpay_signature);
        check("B3 CROSS-BOOKING REUSE: genuine captured ₹222 payment made for booking X cannot confirm booking Y → 400", r.status === 400 && /not made for this booking/i.test(r.data.message || "") && (await fresh(bAtk._id)).status === "HOLD", r.data);
        r = await confirm(cu, bPay1._id, oP2.orderId, p2.razorpay_payment_id, p2.razorpay_signature);
        check("B4 a cheaper booking cannot ride on another booking's payment/order → 400", r.status === 400 && (await fresh(bPay1._id)).status === "HOLD", r.data);
        // amount tamper: booking amount changed after the order was paid
        await Booking.collection.updateOne({ _id: bPay2._id }, { $set: { totalAmountInPaise: 44400 } });
        r = await confirm(cu, bPay2._id, oP2.orderId, p2.razorpay_payment_id, p2.razorpay_signature);
        check("B5 AMOUNT MISMATCH: payment ₹222 vs booking total ₹444 → 400, still HOLD", r.status === 400 && /amount/i.test(r.data.message || "") && (await fresh(bPay2._id)).status === "HOLD", r.data);
        await Booking.collection.updateOne({ _id: bPay2._id }, { $set: { totalAmountInPaise: 22200 } });

        // — genuine payment accepted —
        r = await confirm(cu, bPay1._id, oP1.orderId, p1.razorpay_payment_id, p1.razorpay_signature);
        const after1 = await fresh(bPay1._id);
        const txn1 = await Transaction.findOne({ bookingId: bPay1._id }).lean();
        check("B6 genuine captured payment for the right booking/amount → 200 CONFIRMED", r.status === 200 && after1.status === "CONFIRMED" && after1.paymentStatus === "PAID", r.data);
        check("B7 Transaction stores the server-verified orderId + paymentId + amount; booking keeps razorpayOrderId",
          txn1?.orderId === oP1.orderId && txn1?.paymentId === p1.razorpay_payment_id && txn1?.amount === 11100 && after1.razorpayOrderId === oP1.orderId, txn1);
        const w = await SalonEarnings.findOne({ salonId: salon._id }).lean();
        check("B8 salon wallet credited PENDING with the service amount (existing flow intact)", w?.pendingBalanceInPaise === 9100, w?.pendingBalanceInPaise);

        // — reuse blocked —
        r = await confirm(cu, bPay1._id, oP1.orderId, p1.razorpay_payment_id, p1.razorpay_signature);
        check("B9 PAYMENT REUSE on the same booking → rejected (not 200), no second Transaction", r.status >= 400 && (await Transaction.countDocuments({ paymentId: p1.razorpay_payment_id })) === 1, r.data);
        r = await confirm(cu, bPay2._id, oP1.orderId, p1.razorpay_payment_id, p1.razorpay_signature);
        check("B10 PAYMENT REUSE on a different booking → 400/409, that booking stays HOLD", r.status >= 400 && (await fresh(bPay2._id)).status === "HOLD", r.data);
        r = await confirm(cu, bPay2._id, oP2.orderId, p2.razorpay_payment_id, p2.razorpay_signature);
        check("B11 the second genuine payment (amount restored) confirms its own booking → 200", r.status === 200 && (await fresh(bPay2._id)).status === "CONFIRMED", r.data);
        r = await createOrder(cu, bPay2._id);
        check("B12 create-order after confirmation → 409 (no new order for a paid booking)", r.status === 409, r.data);
      }
    }
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    if (payServer) payServer.close();
    await purge().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
