/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRazorpaySourceRefund.js
 *
 * P0-C Phase 2 — live verification of the Support "refundTo = WALLET | SOURCE"
 * choice against the REAL Razorpay TEST-mode API: real payments (paid through
 * Razorpay's hosted test checkout, demo bank → Success), real refunds.
 * Webhook HTTP calls are made by this script from REAL Razorpay entities,
 * signed with a test secret (Razorpay cannot reach localhost).
 *
 *   /pay?o=1 ₹200  PARTIAL (HALF_REFUND policy) source refund
 *   /pay?o=2 ₹100  FULL source refund
 *   /pay?o=3 ₹150  source refund re-issued after refund.failed
 *
 * Run: RZP_LIVE_PAYMENTS=1 node scripts/verifyRazorpaySourceRefund.js
 */

import "dotenv/config";
import http from "http";
import crypto from "crypto";
import mongoose from "mongoose";
import Razorpay from "razorpay";

process.env.RAZORPAY_WEBHOOK_SECRET = "ztest_rzp_webhook_secret_p0c2";

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
import Refund from "../models/Refund.js";
import Notification from "../models/Notification.js";
import { issueRefundForCancelledBooking } from "../services/RefundExecutionService.js";
import { resolvePaymentVerification } from "../modules/support/services/verification/paymentVerification.service.js";

if (!String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")) { console.error("Refusing to run: not a TEST-mode key."); process.exit(2); }
if (process.env.RZP_LIVE_PAYMENTS !== "1") { console.error("Set RZP_LIVE_PAYMENTS=1 (needs real test-mode checkouts)."); process.exit(2); }

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_RZP0C2_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const runTag = Date.now();

const purge = async () => {
  const users = await User.find({ name: new RegExp(`^${P}`) }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const salons = await Salon.find({ ownerId: { $in: userIds } }).select("_id").lean();
  const salonIds = salons.map((s) => s._id);
  const bookings = await Booking.find({ userRef: { $in: userIds } }).select("_id").lean();
  const bookingIds = bookings.map((b) => b._id);
  const txns = await Transaction.find({ bookingId: { $in: bookingIds } }).select("paymentId").lean();
  const payIds = txns.map((t) => t.paymentId);
  await Refund.deleteMany({ $or: [{ bookingId: { $in: bookingIds } }, { paymentId: { $in: payIds } }, { idempotencyKey: new RegExp(`^${P}`) }] });
  await WebhookEvent.deleteMany({ $or: [{ bookingId: { $in: bookingIds } }, { paymentId: { $in: payIds } }, { eventId: new RegExp(`^${P}`) }, { eventId: new RegExp(`booking-refund-lock:`), lockedAt: { $lt: new Date(Date.now() - 1000) } }] });
  await WalletTransaction.deleteMany({ userId: { $in: userIds } });
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
    const cu = await (async () => { const u = await User.create({ name: `${P}CUST`, phone: phone(), role: "USER", accountStatus: "ACTIVE", walletBalance: 0 }); return { u, token: generateAccessToken({ _id: u._id, role: "USER", tokenVersion: 0 }) }; })();
    const owner = await User.create({ name: `${P}OWNER`, phone: phone(), role: "OWNER", accountStatus: "ACTIVE" });
    const dayTiming = { open: "09:00", close: "20:00" };
    const salon = await Salon.create({
      ownerId: owner._id, basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
      timings: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, dayTiming])),
      location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${P} addr` },
    });
    let slot = 0;
    const mkBooking = async ({ total, commission = 3000 }) => {
      const start = new Date(Date.now() + (120 + slot++ * 45) * 60000);
      return Booking.create({
        userRef: cu.u._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.HOLD, lockUntil: new Date(Date.now() + 90 * 60000),
        serviceAmountInPaise: total - commission, commissionAmountInPaise: commission, totalAmountInPaise: total,
      });
    };
    const createOrder = (bookingId) => call("/api/payments/create-order", cu.token, { method: "POST", body: { bookingId: String(bookingId) } });
    const clientConfirm = (bookingId, orderId, paymentId) => call("/api/v1/bookings/user/confirm", cu.token, { method: "POST", body: { bookingId: String(bookingId), paymentMethod: "RAZORPAY", orderId, paymentId, razorpaySignature: crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex") } });
    const cancel = (id, policy, refundAmountInPaise) => Booking.collection.updateOne({ _id: id }, { $set: { status: "CANCELLED", cancellationPolicy: policy, refundAmountInPaise } });
    const fresh = (id) => Booking.findById(id).lean();
    const pending = async () => (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise ?? 0;
    const walletBalance = async () => (await User.findById(cu.u._id).lean()).walletBalance;
    let evc = 0;
    const webhook = (event, entities, id = `${P}evt_${runTag}_${++evc}`) => {
      const raw = JSON.stringify({ entity: "event", account_id: "acc_ztest", event, contains: Object.keys(entities), payload: Object.fromEntries(Object.entries(entities).map(([k, v]) => [k, { entity: v }])), created_at: Math.floor(Date.now() / 1000) });
      return call("/api/webhooks/razorpay", null, { method: "POST", raw, headers: { "content-type": "application/json", "x-razorpay-event-id": id, "x-razorpay-signature": crypto.createHmac("sha256", SECRET).update(raw).digest("hex") } }).then((r) => ({ ...r, id }));
    };
    const verify = (bookingId) => resolvePaymentVerification({ ticket: { relatedBookingRef: String(bookingId), requesterType: "SALON_OWNER" }, actor: { id: owner._id, role: "ADMIN" } });
    const actor = { triggeredBy: "ADMIN", triggeredById: owner._id };

    // ═══ payments ═══════════════════════════════════════════════
    const bA = await mkBooking({ total: 20000 });   // half
    const bB = await mkBooking({ total: 10000 });   // full
    const bR = await mkBooking({ total: 15000 });   // retry after failed
    const oA = (await createOrder(bA._id)).data, oB = (await createOrder(bB._id)).data, oR = (await createOrder(bR._id)).data;
    const paid = new Map();
    payServer = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/pay") {
        const which = u.searchParams.get("o"); const o = { 1: oA, 2: oB, 3: oR }[which];
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(`<!doctype html><meta charset=utf-8><title>Pay ${which}</title><body style="font-family:sans-serif"><h3>Razorpay TEST payment #${which} — ₹${o.amount / 100} — click SUCCESS on the demo bank page</h3>
<form method="POST" action="https://api.razorpay.com/v1/checkout/embedded"><input type=hidden name=key_id value="${process.env.RAZORPAY_KEY_ID}"><input type=hidden name=order_id value="${o.orderId}">
<input type=hidden name=name value="Zemish test"><input type=hidden name="prefill[contact]" value="+918123456789"><input type=hidden name="prefill[email]" value="ztest@example.com">
<input type=hidden name=callback_url value="http://localhost:6565/callback?o=${which}"><input type=hidden name=cancel_url value="http://localhost:6565/callback?o=${which}"><button type=submit>Pay with Razorpay (test mode)</button></form></body>`);
      }
      if (u.pathname === "/callback") {
        let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { paid.set(u.searchParams.get("o"), Object.fromEntries(new URLSearchParams(raw))); res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>done</title><h3>result received — you can close this page</h3>"); });
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => payServer.listen(6565, r));
    console.log(`\nPAYMENT PAGES READY:\n  http://localhost:6565/pay?o=1  (₹200)\n  http://localhost:6565/pay?o=2  (₹100)\n  http://localhost:6565/pay?o=3  (₹150)\nWaiting up to 20 minutes…\n`);
    const t0 = Date.now();
    while (paid.size < 3 && Date.now() - t0 < 20 * 60000) await sleep(1000);
    check("R0 three real checkouts completed", paid.size === 3, [...paid.keys()]);
    if (paid.size === 3) {
      const payA = paid.get("1").razorpay_payment_id, payB = paid.get("2").razorpay_payment_id, payR = paid.get("3").razorpay_payment_id;
      check("R1 all three bookings confirmed by the client (normal flow)", (await clientConfirm(bA._id, oA.orderId, payA)).status === 200 && (await clientConfirm(bB._id, oB.orderId, payB)).status === 200 && (await clientConfirm(bR._id, oR.orderId, payR)).status === 200);
      const pendingAfterConfirm = await pending();
      check("R2 salon PENDING holds the three service amounts (17000 + 7000 + 12000)", pendingAfterConfirm === 36000, pendingAfterConfirm);
      const gw = async (pid) => (await rz.payments.fetchMultipleRefund(pid)).items;
      // Razorpay returns a new refund as "pending" and processes it a little later: wait for the real "processed" state.
      const realProcessed = async (refundId) => { let e = await rz.refunds.fetch(refundId); for (let i = 0; i < 15 && e.status !== "processed"; i++) { await sleep(2000); e = await rz.refunds.fetch(refundId); } return e; };
      const processedEvent = async (refundId, paymentId, eventId) => webhook("refund.processed", { refund: await realProcessed(refundId), payment: await rz.payments.fetch(paymentId) }, eventId);

      // ═══ PARTIAL (HALF_REFUND) → SOURCE ═════════════════════════
      await cancel(bA._id, "HALF_REFUND", 10000);
      const vBefore = await verify(bA._id);
      check("H0 support verification before: ISSUE_REFUND allowed", vBefore.state === "VERIFIED_ACTION_ALLOWED" && vBefore.allowedActions.includes("ISSUE_REFUND"), vBefore);
      const walletBefore = await walletBalance();
      const h1 = await issueRefundForCancelledBooking({ bookingId: bA._id, ...actor, refundTo: "SOURCE" });
      const gwA = await gw(payA);
      const docA = await Refund.findOne({ idempotencyKey: `booking-refund:${bA._id}` }).lean();
      check("H1 refundTo=SOURCE with the 50% policy → PARTIAL refund ₹100 of ₹200 at Razorpay; gateway refund id stored", h1.refundPaise === 10000 && /^rfnd_/.test(h1.refundId || "") && gwA.length === 1 && gwA[0].amount === 10000 && docA?.razorpayRefundId === h1.refundId && docA.isFull === false, { h1, gw: gwA.map((x) => x.amount) });
      let tA = await Transaction.findOne({ paymentId: payA }).lean();
      const bA1 = await fresh(bA._id);
      check("H2 Transaction.refundAmount = 10000 as soon as Razorpay accepts the refund (status still PAID); Booking.paymentStatus still PAID (only partially refunded)", tA.refundAmount === 10000 && tA.status === "PAID" && bA1.paymentStatus === "PAID", { ra: tA.refundAmount, st: tA.status, ps: bA1.paymentStatus });
      const pendA = await pending();
      check("H3 salon pending reversed by the service half (₹85) — exactly once", pendingAfterConfirm - pendA === 8500, { pendA });
      const h1b = await issueRefundForCancelledBooking({ bookingId: bA._id, ...actor, refundTo: "SOURCE" });
      check("H4 SOURCE again → alreadyIssued; still one Razorpay refund; no second salon reversal", h1b.alreadyIssued === true && (await gw(payA)).length === 1 && (await pending()) === pendA);
      const hw = await issueRefundForCancelledBooking({ bookingId: bA._id, ...actor });
      check("H5 WALLET (default) after SOURCE → alreadyIssued, refundedTo SOURCE: the customer is NOT refunded twice (wallet balance and wallet transactions unchanged)", hw.alreadyIssued === true && hw.refundedTo === "SOURCE" && (await walletBalance()) === walletBefore && (await WalletTransaction.countDocuments({ bookingId: bA._id })) === 0, hw);
      const vAfter = await verify(bA._id);
      check("H6 support verification after: PAYMENT_ALREADY_REFUNDED, no action allowed (partial refund recognised)", vAfter.reason === "PAYMENT_ALREADY_REFUNDED" && vAfter.allowedActions.length === 0 && vAfter.facts.refundedAmountPaise === 10000, vAfter);
      const wpA = await processedEvent(h1.refundId, payA, `${P}hp_${runTag}`);
      const wpA2 = await webhook("refund.processed", { refund: await realProcessed(h1.refundId), payment: await rz.payments.fetch(payA) }, `${P}hp_${runTag}`);
      check("H7 refund.processed completes it (REFUND_COMPLETED); the SAME event redelivered → duplicate ignored", wpA.data.outcome === "REFUND_COMPLETED" && wpA2.data.duplicate === true, { a: wpA.data, b: wpA2.data });
      check("H8 Razorpay agrees: partial (₹100 of ₹200 refunded)", (await rz.payments.fetch(payA)).amount_refunded === 10000);

      // ═══ FULL → SOURCE ═════════════════════════════════════════
      await cancel(bB._id, "FULL_REFUND", 10000);
      const pendBBefore = await pending();
      const f1 = await issueRefundForCancelledBooking({ bookingId: bB._id, ...actor, refundTo: "SOURCE" });
      const gwB = await gw(payB);
      check("F1 refundTo=SOURCE with the full policy → FULL refund ₹100 at Razorpay", f1.refundPaise === 10000 && gwB.length === 1 && gwB[0].amount === 10000 && (await Refund.findOne({ idempotencyKey: `booking-refund:${bB._id}` }).lean()).isFull === true);
      const tB0 = await Transaction.findOne({ paymentId: payB }).lean();
      check("F2a Transaction.refundAmount = 10000 once Razorpay accepts the full refund; status/paymentStatus flip to REFUNDED only when it is PROCESSED", tB0.refundAmount === 10000 && (tB0.status === "PAID" ? (await fresh(bB._id)).paymentStatus === "PAID" : true), { t: [tB0.status, tB0.refundAmount] });
      check("F3 salon pending reversed by the service part (₹70) once", pendBBefore - (await pending()) === 7000);
      const vB = await verify(bB._id);
      check("F4 support verification: PAYMENT_ALREADY_REFUNDED (Transaction REFUNDED is now understood, not 'unsupported state')", vB.reason === "PAYMENT_ALREADY_REFUNDED" && vB.state === "VERIFIED_NO_ACTION_ALLOWED", vB);
      const wB = await processedEvent(f1.refundId, payB, `${P}fp_${runTag}`);
      check("F5 refund.processed → REFUND_COMPLETED (not flagged: we issued it)", wB.data.outcome === "REFUND_COMPLETED", wB.data);
      const tB = await Transaction.findOne({ paymentId: payB }).lean();
      const bB1 = await fresh(bB._id);
      check("F6 once PROCESSED: Transaction.status REFUNDED (refundAmount 10000) and Booking.paymentStatus → REFUNDED automatically", tB.refundAmount === 10000 && tB.status === "REFUNDED" && bB1.paymentStatus === "REFUNDED", { t: [tB.status, tB.refundAmount], ps: bB1.paymentStatus });

      // ═══ refund.failed → re-issue ══════════════════════════════
      await cancel(bR._id, "FULL_REFUND", 15000);
      const synthetic = await Refund.create({ paymentId: payR, orderId: oR.orderId, bookingId: bR._id, amountInPaise: 15000, paymentAmountInPaise: 15000, isFull: true, reason: "BOOKING_CANCELLED", initiatedBy: { type: "ADMIN" }, idempotencyKey: `booking-refund:${bR._id}`, razorpayRefundId: "rfnd_ZTESTFAILED0001", refundStatus: "PENDING", gatewayStatus: "pending", attempts: 1 });
      const vPend = await verify(bR._id);
      check("X0 while a source refund is PENDING, support verification blocks a second refund", vPend.reason === "PAYMENT_ALREADY_REFUNDED", vPend.reason);
      const failedEvt = { id: "rfnd_ZTESTFAILED0001", entity: "refund", payment_id: payR, amount: 15000, status: "failed", status_description: "Bank rejected the refund" };
      const x1 = await webhook("refund.failed", { refund: failedEvt }, `${P}xf_${runTag}`);
      const x1b = await webhook("refund.failed", { refund: failedEvt }, `${P}xf_${runTag}`);
      const docF = await Refund.findById(synthetic._id).lean();
      check("X1 refund.failed → Refund FAILED with the reason; the same event redelivered → duplicate ignored", x1.data.outcome === "REFUND_FAILED_RECORDED" && docF.refundStatus === "FAILED" && /rejected/i.test(docF.failureReason || "") && x1b.data.duplicate === true, { x1: x1.data, doc: docF.refundStatus });
      const vFailed = await verify(bR._id);
      check("X2 a FAILED refund does not count as refunded: support can retry (ISSUE_REFUND allowed again)", vFailed.state === "VERIFIED_ACTION_ALLOWED", vFailed.reason);
      const pendR0 = await pending();
      const x3 = await issueRefundForCancelledBooking({ bookingId: bR._id, ...actor, refundTo: "SOURCE" });
      const gwR = await gw(payR);
      const docR = await Refund.findById(synthetic._id).lean();
      check("X3 retry with SOURCE re-issues on the SAME Refund record: a real ₹150 Razorpay refund now exists, record moves to PROCESSED/PENDING with the new refund id", gwR.length === 1 && gwR[0].amount === 15000 && docR.razorpayRefundId === gwR[0].id && ["PENDING", "PROCESSED"].includes(docR.refundStatus) && docR.attempts >= 2, { gw: gwR.length, doc: [docR.razorpayRefundId, docR.refundStatus, docR.attempts] });
      check("X4 salon reversal happened once for the retry (₹120) — no repeat", pendR0 - (await pending()) === 12000, { d: pendR0 - (await pending()) });
      await issueRefundForCancelledBooking({ bookingId: bR._id, ...actor, refundTo: "SOURCE" });
      check("X5 a further SOURCE call is a no-op (alreadyIssued), one gateway refund", (await gw(payR)).length === 1);

      // ═══ WALLET first, then SOURCE (no gateway involved) ═══════
      const bW = await mkBooking({ total: 6000 });
      await Booking.collection.updateOne({ _id: bW._id }, { $set: { status: "CANCELLED", cancellationPolicy: "FULL_REFUND", refundAmountInPaise: 6000 } });
      const w1 = await issueRefundForCancelledBooking({ bookingId: bW._id, ...actor });
      check("W1 default WALLET refund still works exactly as before (customer wallet +₹60, wallet transaction written)", w1.alreadyIssued === false && w1.refundPaise === 6000 && (await walletBalance()) === walletBefore + 60 && (await WalletTransaction.countDocuments({ bookingId: bW._id, type: "REFUND" })) === 1, w1);
      const w2 = await issueRefundForCancelledBooking({ bookingId: bW._id, ...actor, refundTo: "SOURCE" });
      check("W2 SOURCE after a WALLET refund → alreadyIssued, refundedTo WALLET; nothing sent to Razorpay", w2.alreadyIssued === true && w2.refundedTo === "WALLET" && (await Refund.countDocuments({ bookingId: bW._id })) === 0, w2);
      const w3 = await issueRefundForCancelledBooking({ bookingId: bW._id, ...actor });
      check("W3 WALLET again → alreadyIssued (existing behaviour intact)", w3.alreadyIssued === true);
      // concurrent WALLET vs SOURCE on one fresh cancelled booking (fake payment id — no gateway refund can succeed)
      const bC = await mkBooking({ total: 6000 });
      await Booking.collection.updateOne({ _id: bC._id }, { $set: { status: "CANCELLED", cancellationPolicy: "FULL_REFUND", refundAmountInPaise: 6000 } });
      await Transaction.create({ bookingId: bC._id, userId: cu.u._id, salonId: salon._id, resourceId: oid(), paymentId: `pay_ZTESTFAKE${runTag}`, amount: 6000, commission: 3000, payoutAmount: 3000, status: "PAID", type: "BOOKING", paymentMethod: "UPI" });
      const race = await Promise.allSettled([
        issueRefundForCancelledBooking({ bookingId: bC._id, ...actor }),
        issueRefundForCancelledBooking({ bookingId: bC._id, ...actor, refundTo: "SOURCE" }),
        issueRefundForCancelledBooking({ bookingId: bC._id, ...actor }),
      ]);
      const walletRefunds = await WalletTransaction.countDocuments({ bookingId: bC._id, type: "REFUND" });
      const srcRefunds = await Refund.countDocuments({ bookingId: bC._id, refundStatus: { $in: ["PENDING", "PROCESSED"] } });
      check("K1 WALLET and SOURCE (and a repeat) racing on one booking → the customer is refunded AT MOST ONCE in total; losers get alreadyIssued or REFUND_IN_PROGRESS, never a double refund",
        walletRefunds + srcRefunds <= 1 && race.every((x) => x.status === "fulfilled" || ["REFUND_IN_PROGRESS", "PAYMENT_NOT_FOUND"].includes(x.reason?.code)), { walletRefunds, srcRefunds, race: race.map((x) => x.status === "fulfilled" ? (x.value.alreadyIssued ? "already" : "issued") : x.reason?.code) });
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
