/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRazorpayWebhook.js
 *
 * RAZORPAY P0-B — verification of the Razorpay webhook against the REAL
 * Razorpay TEST-mode API: real orders, real payments made through Razorpay's
 * hosted test checkout, real refunds created by the webhook handler.
 *
 * HONEST SCOPE: Razorpay cannot reach localhost, so the webhook HTTP calls are
 * made by this script. Their payloads are assembled from the REAL entities
 * Razorpay returns (payments.fetch / orders.fetch / refund fetch) in Razorpay's
 * documented event envelope and signed with a test webhook secret
 * (RAZORPAY_WEBHOOK_SECRET). Delivery BY Razorpay (and its own event ids /
 * signature header) is NOT exercised — that needs a public URL registered in the
 * dashboard. Everything the handler does with the event IS real.
 *
 * Needs three real test-mode checkouts (paid via Razorpay's demo-bank page):
 *   /pay?o=1 SUCCESS  booking with a VALID hold      -> auto-confirm
 *   /pay?o=2 SUCCESS  booking whose hold then EXPIRES -> automatic refund
 *   /pay?o=3 FAILURE  a real failed payment           -> payment.failed
 *
 * Run: RZP_LIVE_PAYMENTS=1 node scripts/verifyRazorpayWebhook.js
 */

import "dotenv/config";
import http from "http";
import crypto from "crypto";
import mongoose from "mongoose";
import Razorpay from "razorpay";

process.env.RAZORPAY_WEBHOOK_SECRET = "ztest_rzp_webhook_secret_p0b";

import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import WalletTransaction from "../models/WalletTransaction.js";
import WebhookEvent from "../models/WebhookEvent.js";
import Notification from "../models/Notification.js";

if (!String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")) {
  console.error("Refusing to run: RAZORPAY_KEY_ID is not a TEST-mode key (rzp_test_…).");
  process.exit(2);
}
if (process.env.RZP_LIVE_PAYMENTS !== "1") {
  console.error("Set RZP_LIVE_PAYMENTS=1 (this script needs real test-mode checkouts).");
  process.exit(2);
}

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_RZP0B_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const hmac = (raw, secret = SECRET) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
const runTag = Date.now();

const purge = async () => {
  const users = await User.find({ name: new RegExp(`^${P}`) }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const salons = await Salon.find({ ownerId: { $in: userIds } }).select("_id").lean();
  const salonIds = salons.map((s) => s._id);
  const bookings = await Booking.find({ userRef: { $in: userIds } }).select("_id").lean();
  const bookingIds = bookings.map((b) => b._id);
  await Transaction.deleteMany({ bookingId: { $in: bookingIds } });
  await WalletTransaction.deleteMany({ userId: { $in: userIds } });
  await WalletLedger.collection.deleteMany({ $or: [{ ownerId: { $in: salonIds } }, { salonId: { $in: salonIds } }] });
  await SalonEarnings.deleteMany({ $or: [{ salonId: { $in: salonIds } }, { entityId: { $in: salonIds } }] });
  await Notification.deleteMany({ recipientId: { $in: userIds } }).catch(() => {});
  await WebhookEvent.deleteMany({ $or: [{ bookingId: { $in: bookingIds } }, { eventId: new RegExp(`^${P}`) }, { eventId: new RegExp(`^ACTION:refund:pay_.*`), bookingId: { $in: bookingIds } }] });
  await Booking.collection.deleteMany({ _id: { $in: bookingIds } });
  await Salon.deleteMany({ _id: { $in: salonIds } });
  await User.deleteMany({ _id: { $in: userIds } });
};

const run = async () => {
  await connectDB();
  await purge();
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;
  const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

  const call = (path, token, { method = "GET", body, headers = {}, raw } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
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
    const clientConfirm = (user, bookingId, orderId, paymentId) => {
      const sig = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
      return call("/api/v1/bookings/user/confirm", user.token, { method: "POST", body: { bookingId: String(bookingId), paymentMethod: "RAZORPAY", orderId, paymentId, razorpaySignature: sig } });
    };
    const fresh = (id) => Booking.findById(id).lean();

    // webhook envelope from REAL entities
    let evCounter = 0;
    const envelope = (event, entities) => ({ entity: "event", account_id: "acc_ztest", event, contains: Object.keys(entities), payload: Object.fromEntries(Object.entries(entities).map(([k, v]) => [k, { entity: v }])), created_at: Math.floor(Date.now() / 1000) });
    const send = (payload, { id = `${P}evt_${runTag}_${++evCounter}`, secret = SECRET, sign = true, rawOverride } = {}) => {
      const raw = rawOverride ?? JSON.stringify(payload);
      const headers = { "content-type": "application/json", "x-razorpay-event-id": id };
      if (sign) headers["x-razorpay-signature"] = hmac(raw, secret);
      return call("/api/webhooks/razorpay", null, { method: "POST", raw, headers }).then((r) => ({ ...r, id }));
    };

    // ═══ Signature / transport (no payment needed) ══════════════════
    const cu = await mkUser("CUST");
    const bSig = await mkBooking(cu);
    const oSig = (await createOrder(cu, bSig._id)).data;
    const realOrderEntity = await rz.orders.fetch(oSig.orderId);
    const fakePay = (over = {}) => ({ id: `pay_ZTEST${runTag}${++evCounter}`.slice(0, 22), entity: "payment", amount: 12000, currency: "INR", status: "captured", order_id: oSig.orderId, amount_refunded: 0, ...over });
    const evt = envelope("customer.created", { payment: fakePay() }); // harmless event type: exercises transport/signature only
    let r = await send(evt, { sign: false });
    check("T1 missing signature → 401", r.status === 401, r);
    r = await send(evt, { secret: "not-the-secret" });
    check("T2 wrong secret → 401", r.status === 401, r);
    const raw0 = JSON.stringify(evt);
    r = await call("/api/webhooks/razorpay", null, { method: "POST", raw: raw0 + " ", headers: { "x-razorpay-signature": hmac(raw0), "x-razorpay-event-id": `${P}t3_${runTag}` } });
    check("T3 body altered after signing → 401 (HMAC covers the exact bytes)", r.status === 401, r);
    r = await call("/api/webhooks/razorpay", null, { method: "POST", raw: raw0, headers: { "x-razorpay-signature": hmac(raw0), "x-razorpay-event-id": `${P}t3b_${runTag}` } });
    check("T3b sanity: the same body with its correct signature is accepted (200)", r.status === 200, r);
    r = await call("/api/webhooks/razorpay", null, { method: "POST", raw: "not json", headers: { "x-razorpay-signature": hmac("not json") } });
    check("T4 signed but malformed body → 400", r.status === 400, r);
    const secretBefore = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    r = await call("/api/webhooks/razorpay", null, { method: "POST", raw: raw0, headers: { "x-razorpay-signature": hmac(raw0, secretBefore) } });
    process.env.RAZORPAY_WEBHOOK_SECRET = secretBefore;
    check("T5 webhook secret not configured → 503 (fails closed, never accepts)", r.status === 503, r);
    r = await send(envelope("customer.created", { payment: fakePay() }));
    check("T6 unhandled event type → 200, recorded IGNORED", r.status === 200 && r.data.outcome === "UNHANDLED_EVENT", r.data);
    // wallet top-up orders are not booking orders
    const topupOrder = await rz.orders.create({ amount: 5000, currency: "INR", receipt: `topup_${runTag}`, notes: { ztest: "1" } });
    await WalletTransaction.create({ userId: cu.u._id, direction: "CREDIT", type: "TOPUP", status: "PENDING", source: "RAZORPAY", amountInPaise: 5000, requestId: `${P}topup_${runTag}`, razorpayOrderId: topupOrder.id });
    r = await send(envelope("payment.captured", { payment: fakePay({ order_id: topupOrder.id, amount: 5000 }) }));
    check("T7 captured payment on a WALLET TOP-UP order → IGNORED (never refunded / never confirmed as a booking)", r.data.outcome === "WALLET_TOPUP", r.data);
    r = await send(envelope("payment.captured", { payment: fakePay({ order_id: "order_ZTESTUNKNOWN0001" }) }));
    check("T8 captured payment on an order we do not know → IGNORED UNKNOWN_ORDER", r.data.outcome === "UNKNOWN_ORDER", r.data);
    r = await send(envelope("payment.captured", { payment: fakePay({ amount: 999 }) }));
    check("T9 amount ≠ booking total → NEEDS_REVIEW, booking untouched, nothing refunded", r.data.outcome === "AMOUNT_MISMATCH" && (await fresh(bSig._id)).status === "HOLD", r.data);
    const doc9 = await WebhookEvent.findOne({ eventId: r.id }).lean();
    check("T9b …and the WebhookEvent row says NEEDS_REVIEW", doc9?.status === "NEEDS_REVIEW");
    const orphanOrder = await rz.orders.create({ amount: 12000, currency: "INR", receipt: `orph_${runTag}`, notes: { bookingId: String(bSig._id) } });
    const fpOrphan = fakePay({ order_id: orphanOrder.id });
    r = await send(envelope("payment.captured", { payment: fpOrphan }), { id: `${P}orph_${runTag}` });
    const orphanDoc = await WebhookEvent.findOne({ eventId: r.id }).lean();
    check("T10 payment on an order that is NOT the booking's current order → refund attempted; Razorpay rejects the fake payment id → event FAILED, HTTP 500 (Razorpay would retry)", r.status === 500 && orphanDoc?.status === "FAILED" && (await Transaction.countDocuments({ bookingId: bSig._id })) === 0, { s: r.status, doc: orphanDoc?.status });
    r = await send(envelope("payment.captured", { payment: fpOrphan }), { id: `${P}orph_${runTag}` });
    const orphanDoc2 = await WebhookEvent.findOne({ eventId: `${P}orph_${runTag}` }).lean();
    check("T11 the retry re-claims the FAILED event (attempts 2) instead of treating it as a duplicate", orphanDoc2?.attempts === 2, { attempts: orphanDoc2?.attempts, s: r.status });

    // ═══ Real payments ═════════════════════════════════════════════
    const bOk = await mkBooking(cu, { total: 11100 });
    const bExp = await mkBooking(cu, { total: 22200 });
    const bFail = await mkBooking(cu, { total: 3300 });
    const o1 = (await createOrder(cu, bOk._id)).data;
    const o2 = (await createOrder(cu, bExp._id)).data;
    const o3 = (await createOrder(cu, bFail._id)).data;
    const paid = new Map();
    payServer = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/pay") {
        const which = u.searchParams.get("o");
        const o = { 1: o1, 2: o2, 3: o3 }[which];
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(`<!doctype html><meta charset=utf-8><title>Pay ${which}</title><body style="font-family:sans-serif">
<h3>Razorpay TEST payment #${which} — ₹${o.amount / 100} (order ${o.orderId}) — ${which === "3" ? "click FAILURE on the demo bank page" : "click SUCCESS on the demo bank page"}</h3>
<form method="POST" action="https://api.razorpay.com/v1/checkout/embedded">
<input type=hidden name=key_id value="${process.env.RAZORPAY_KEY_ID}"><input type=hidden name=order_id value="${o.orderId}">
<input type=hidden name=name value="Zemish test"><input type=hidden name="prefill[contact]" value="+918123456789"><input type=hidden name="prefill[email]" value="ztest@example.com">
<input type=hidden name=callback_url value="http://localhost:6363/callback?o=${which}"><input type=hidden name=cancel_url value="http://localhost:6363/callback?o=${which}">
<button type=submit>Pay with Razorpay (test mode)</button></form></body>`);
      }
      if (u.pathname === "/callback") {
        let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
          const f = Object.fromEntries(new URLSearchParams(raw));
          paid.set(u.searchParams.get("o"), f);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<!doctype html><title>done</title><body style="font-family:sans-serif"><h3>${f.razorpay_payment_id ? "Payment captured — result received" : "Payment failed/cancelled — result received"}. You can close this page.</h3></body>`);
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r2) => payServer.listen(6363, r2));
    console.log(`\nPAYMENT PAGES READY:\n  http://localhost:6363/pay?o=1  (₹111 — SUCCESS)\n  http://localhost:6363/pay?o=2  (₹222 — SUCCESS)\n  http://localhost:6363/pay?o=3  (₹33  — FAILURE)\nWaiting up to 20 minutes…\n`);
    const t0 = Date.now();
    while (paid.size < 3 && Date.now() - t0 < 20 * 60000) await sleep(1000);
    check("R0 three real checkouts completed", paid.size === 3, [...paid.keys()]);
    if (paid.size === 3) {
      const p1 = paid.get("1"), p2 = paid.get("2"), p3 = paid.get("3");
      const pay1 = await rz.payments.fetch(p1.razorpay_payment_id);
      const pay2 = await rz.payments.fetch(p2.razorpay_payment_id);
      check("R1 Razorpay reports payments 1 and 2 captured", pay1.status === "captured" && pay2.status === "captured", [pay1.status, pay2.status]);
      const ord1 = await rz.orders.fetch(o1.orderId);
      const ord2 = await rz.orders.fetch(o2.orderId);

      // ── S1: valid hold, webhook and client race ──
      const wh1 = envelope("payment.captured", { payment: pay1 });
      const [w1, c1] = await Promise.all([send(wh1, { id: `${P}s1_${runTag}` }), clientConfirm(cu, bOk._id, o1.orderId, pay1.id)]);
      const b1 = await fresh(bOk._id);
      check("S1.1 webhook + client /confirm racing on the same payment → both succeed (200)", w1.status === 200 && c1.status === 200, { w: w1.data, c: c1.data });
      check("S1.2 booking CONFIRMED and paid; exactly ONE Transaction for the payment", b1.status === "CONFIRMED" && b1.paymentStatus === "PAID" && (await Transaction.countDocuments({ paymentId: pay1.id })) === 1, { st: b1.status, n: await Transaction.countDocuments({ paymentId: pay1.id }) });
      const w1Wallet = await SalonEarnings.findOne({ salonId: salon._id }).lean();
      check("S1.3 salon PENDING credited exactly once (service amount ₹91) — no double credit from the race", w1Wallet?.pendingBalanceInPaise === 9100, w1Wallet?.pendingBalanceInPaise);
      check("S1.4 the winner is either path, and the WebhookEvent is PROCESSED", ["AUTO_CONFIRMED", "ALREADY_RECORDED"].includes(w1.data.outcome), w1.data);
      // replays
      r = await send(wh1, { id: `${P}s1_${runTag}` });
      check("S1.5 SAME event id redelivered → 200 duplicate:true, nothing re-processed", r.status === 200 && r.data.duplicate === true, r.data);
      r = await send(envelope("order.paid", { payment: pay1, order: ord1 }));
      check("S1.6 order.paid for the same payment (different event id) → ALREADY_RECORDED, no second Transaction", r.data.outcome === "ALREADY_RECORDED" && (await Transaction.countDocuments({ paymentId: pay1.id })) === 1, r.data);
      r = await clientConfirm(cu, bOk._id, o1.orderId, pay1.id);
      check("S1.7 client /confirm AFTER the booking is confirmed → 200 alreadyConfirmed (no error shown to the customer), still one Transaction", r.status === 200 && (r.data.alreadyConfirmed === true || r.data.success === true) && (await Transaction.countDocuments({ paymentId: pay1.id })) === 1, r.data);
      r = await call("/api/v1/bookings/user/confirm", cu.token, { method: "POST", body: { bookingId: String(bOk._id), paymentMethod: "RAZORPAY", orderId: o2.orderId, paymentId: pay2.id, razorpaySignature: crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${o2.orderId}|${pay2.id}`).digest("hex") } });
      check("S1.8 a DIFFERENT payment on the confirmed booking is still rejected (not treated as a replay)", r.status >= 400, r.data);

      // ── S2: hold expires before the webhook → automatic refund ──
      await Booking.collection.updateOne({ _id: bExp._id }, { $set: { lockUntil: new Date(Date.now() - 60000) } });
      const wh2 = envelope("payment.captured", { payment: pay2 });
      const deliveries = await Promise.all([1, 2, 3, 4, 5].map(() => send(wh2, { id: `${P}s2_${runTag}` })));
      const refunds2 = await rz.payments.fetchMultipleRefund(pay2.id);
      check("S2.1 five CONCURRENT deliveries of the same event → exactly ONE real refund at Razorpay, full amount", refunds2.items.length === 1 && refunds2.items[0].amount === 22200, refunds2.items.map((x) => [x.id, x.amount]));
      check("S2.2 delivery responses: one processed, the rest duplicate/in-flight (never a 5xx other than a retryable 503)", deliveries.filter((d) => d.status === 200 && !d.data.duplicate).length === 1 && deliveries.every((d) => d.status === 200 || d.status === 503), deliveries.map((d) => [d.status, d.data.duplicate, d.data.outcome]));
      const b2 = await fresh(bExp._id);
      check("S2.3 expired-hold booking NOT confirmed, no Transaction, no salon credit for it", b2.status !== "CONFIRMED" && (await Transaction.countDocuments({ bookingId: bExp._id })) === 0 && (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise === 9100, { st: b2.status });
      const ev2 = await WebhookEvent.findOne({ eventId: `${P}s2_${runTag}` }).lean();
      check("S2.4 WebhookEvent PROCESSED with outcome AUTO_REFUND(REFUND_CREATED:HOLD_EXPIRED) and the refund id", ev2?.status === "PROCESSED" && /REFUND_CREATED:HOLD_EXPIRED/.test(ev2.outcome || "") && ev2.refundId === refunds2.items[0].id, ev2);
      r = await send(envelope("order.paid", { payment: pay2, order: ord2 }));
      check("S2.5 order.paid for the SAME payment (another event id) → refund NOT repeated (still one refund at Razorpay)", (await rz.payments.fetchMultipleRefund(pay2.id)).items.length === 1 && /REFUND_ALREADY/.test(r.data.outcome || ""), r.data);
      const actionDoc = await WebhookEvent.findOne({ eventId: `ACTION:refund:${pay2.id}` }).lean();
      check("S2.6 the once-per-payment ACTION lock exists and is PROCESSED", actionDoc?.status === "PROCESSED" && actionDoc.kind === "ACTION");

      // refund.processed from the REAL refund entity
      let refundEntity = refunds2.items[0];
      for (let i = 0; i < 10 && refundEntity.status !== "processed"; i++) { await sleep(2000); refundEntity = await rz.refunds.fetch(refundEntity.id); }
      const payAfter = await rz.payments.fetch(pay2.id);
      r = await send(envelope("refund.processed", { refund: refundEntity, payment: payAfter }), { id: `${P}s2r_${runTag}` });
      const b2r = await fresh(bExp._id);
      check(`S2.7 refund.processed (real refund entity, Razorpay status "${refundEntity.status}") → recorded; booking.paymentStatus REFUNDED`, refundEntity.status === "processed" ? (r.data.outcome === "REFUND_RECORDED" && b2r.paymentStatus === "REFUNDED") : (r.data.outcome === "REFUND_NOT_PROCESSED"), { o: r.data, ps: b2r.paymentStatus });
      r = await send(envelope("refund.processed", { refund: refundEntity, payment: payAfter }), { id: `${P}s2r_${runTag}` });
      check("S2.8 refund.processed redelivered → duplicate", r.data.duplicate === true, r.data);
      // a refund on a payment that DID confirm a booking is flagged, not acted on
      const fakeRefund = { id: "rfnd_ZTESTFAKE00001", entity: "refund", payment_id: pay1.id, amount: 11100, status: "processed" };
      r = await send(envelope("refund.processed", { refund: fakeRefund, payment: pay1 }));
      check("S2.9 refund.processed for a payment that confirmed a booking → NEEDS_REVIEW, booking + wallet untouched", r.data.outcome === "REFUND_ON_CONFIRMED_BOOKING" && (await fresh(bOk._id)).status === "CONFIRMED" && (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise === 9100, r.data);

      // ── S3: real failed payment ──
      const failedPid = (() => { try { return JSON.parse(p3["error[metadata]"] || "{}").payment_id; } catch { return null; } })();
      if (failedPid) {
        const payFailed = await rz.payments.fetch(failedPid);
        r = await send(envelope("payment.failed", { payment: payFailed }));
        check(`S3.1 payment.failed (real failed payment, Razorpay status "${payFailed.status}") → recorded; booking still HOLD and still payable`, r.data.outcome === "PAYMENT_FAILED_RECORDED" && (await fresh(bFail._id)).status === "HOLD", r.data);
        r = await send(envelope("payment.captured", { payment: payFailed }));
        check("S3.2 a payment that is not captured is never confirmed or refunded, even if sent as payment.captured", r.data.outcome === "NOT_CAPTURED" && (await Transaction.countDocuments({ bookingId: bFail._id })) === 0, r.data);
      } else {
        results.push("   S3 skipped: Razorpay did not return a failed payment id in the callback");
      }
    }
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    if (payServer) payServer.close();
    await purge().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    await WebhookEvent.deleteMany({ eventId: new RegExp(`^${P}`) }).catch(() => {});
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
