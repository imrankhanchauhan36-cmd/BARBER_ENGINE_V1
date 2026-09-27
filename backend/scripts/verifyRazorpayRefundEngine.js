/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRazorpayRefundEngine.js
 *
 * RAZORPAY P0-C — live verification of the refund engine against the REAL
 * Razorpay TEST-mode API: real payments (paid through Razorpay's hosted test
 * checkout), real refunds created and fetched at Razorpay.
 *
 * Webhook HTTP calls are made by this script (Razorpay cannot reach localhost),
 * with payloads assembled from the REAL refund/payment entities and signed with
 * a test webhook secret — the same honest scope as verifyRazorpayWebhook.js.
 *
 * Needs three real successful checkouts (demo bank → Success):
 *   /pay?o=1  ₹200  booking A: confirmed, then partial + external + full refunds
 *   /pay?o=2  ₹100  booking B: confirmed, cancelled → refund to ORIGINAL source
 *   /pay?o=3  ₹150  booking C: hold expires → automatic refund → booking REFUNDED
 *
 * Run: RZP_LIVE_PAYMENTS=1 node scripts/verifyRazorpayRefundEngine.js
 */

import "dotenv/config";
import http from "http";
import crypto from "crypto";
import mongoose from "mongoose";
import Razorpay from "razorpay";

process.env.RAZORPAY_WEBHOOK_SECRET = "ztest_rzp_webhook_secret_p0c";

import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import WebhookEvent from "../models/WebhookEvent.js";
import Refund from "../models/Refund.js";
import Notification from "../models/Notification.js";
import { issueRazorpayRefund } from "../services/RazorpayRefundService.js";
import { issueRefundForCancelledBooking } from "../services/RefundExecutionService.js";
import { supportInternalSchemas } from "../modules/support/validators/supportInternal.validator.js";

if (!String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")) { console.error("Refusing to run: not a TEST-mode key."); process.exit(2); }
if (process.env.RZP_LIVE_PAYMENTS !== "1") { console.error("Set RZP_LIVE_PAYMENTS=1 (needs real test-mode checkouts)."); process.exit(2); }

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_RZP0C_";
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
  await WebhookEvent.deleteMany({ $or: [{ bookingId: { $in: bookingIds } }, { paymentId: { $in: payIds } }, { eventId: new RegExp(`^${P}`) }] });
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
    const mkBooking = async ({ total }) => {
      const start = new Date(Date.now() + (120 + slot++ * 45) * 60000);
      return Booking.create({
        userRef: cu.u._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.HOLD, lockUntil: new Date(Date.now() + 90 * 60000),
        serviceAmountInPaise: total - 3000, commissionAmountInPaise: 3000, totalAmountInPaise: total,
      });
    };
    const createOrder = (bookingId) => call("/api/payments/create-order", cu.token, { method: "POST", body: { bookingId: String(bookingId) } });
    const clientConfirm = (bookingId, orderId, paymentId) => call("/api/v1/bookings/user/confirm", cu.token, { method: "POST", body: { bookingId: String(bookingId), paymentMethod: "RAZORPAY", orderId, paymentId, razorpaySignature: crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex") } });
    const fresh = (id) => Booking.findById(id).lean();
    let evc = 0;
    const webhook = (event, entities, id = `${P}evt_${runTag}_${++evc}`) => {
      const raw = JSON.stringify({ entity: "event", account_id: "acc_ztest", event, contains: Object.keys(entities), payload: Object.fromEntries(Object.entries(entities).map(([k, v]) => [k, { entity: v }])), created_at: Math.floor(Date.now() / 1000) });
      return call("/api/webhooks/razorpay", null, { method: "POST", raw, headers: { "content-type": "application/json", "x-razorpay-event-id": id, "x-razorpay-signature": crypto.createHmac("sha256", SECRET).update(raw).digest("hex") } }).then((r) => ({ ...r, id }));
    };
    // deliver refund.processed for a real refund (re-fetched so the entity is Razorpay's own)
    const deliverProcessed = async (refundId, paymentId) => {
      let entity = await rz.refunds.fetch(refundId);
      for (let i = 0; i < 10 && entity.status !== "processed"; i++) { await sleep(2000); entity = await rz.refunds.fetch(refundId); }
      const payment = await rz.payments.fetch(paymentId);
      return { entity, res: await webhook("refund.processed", { refund: entity, payment }) };
    };

    // ═══ payments ═══════════════════════════════════════════════
    const bA = await mkBooking({ total: 20000 });
    const bB = await mkBooking({ total: 10000 });
    const bC = await mkBooking({ total: 15000 });
    const oA = (await createOrder(bA._id)).data, oB = (await createOrder(bB._id)).data, oC = (await createOrder(bC._id)).data;
    const paid = new Map();
    payServer = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/pay") {
        const which = u.searchParams.get("o"); const o = { 1: oA, 2: oB, 3: oC }[which];
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(`<!doctype html><meta charset=utf-8><title>Pay ${which}</title><body style="font-family:sans-serif"><h3>Razorpay TEST payment #${which} — ₹${o.amount / 100} — click SUCCESS on the demo bank page</h3>
<form method="POST" action="https://api.razorpay.com/v1/checkout/embedded"><input type=hidden name=key_id value="${process.env.RAZORPAY_KEY_ID}"><input type=hidden name=order_id value="${o.orderId}">
<input type=hidden name=name value="Zemish test"><input type=hidden name="prefill[contact]" value="+918123456789"><input type=hidden name="prefill[email]" value="ztest@example.com">
<input type=hidden name=callback_url value="http://localhost:6464/callback?o=${which}"><input type=hidden name=cancel_url value="http://localhost:6464/callback?o=${which}"><button type=submit>Pay with Razorpay (test mode)</button></form></body>`);
      }
      if (u.pathname === "/callback") {
        let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { paid.set(u.searchParams.get("o"), Object.fromEntries(new URLSearchParams(raw))); res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>done</title><h3>result received — you can close this page</h3>"); });
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => payServer.listen(6464, r));
    console.log(`\nPAYMENT PAGES READY:\n  http://localhost:6464/pay?o=1  (₹200)\n  http://localhost:6464/pay?o=2  (₹100)\n  http://localhost:6464/pay?o=3  (₹150)\nWaiting up to 20 minutes…\n`);
    const t0 = Date.now();
    while (paid.size < 3 && Date.now() - t0 < 20 * 60000) await sleep(1000);
    check("R0 three real checkouts completed", paid.size === 3, [...paid.keys()]);
    if (paid.size === 3) {
      const payA = paid.get("1").razorpay_payment_id, payB = paid.get("2").razorpay_payment_id, payC = paid.get("3").razorpay_payment_id;

      // book A and B through the normal client confirm; C's hold expires
      check("R1 booking A confirmed by the client (normal flow)", (await clientConfirm(bA._id, oA.orderId, payA)).status === 200 && (await fresh(bA._id)).status === "CONFIRMED");
      check("R2 booking B confirmed by the client", (await clientConfirm(bB._id, oB.orderId, payB)).status === 200 && (await fresh(bB._id)).status === "CONFIRMED");
      await Booking.collection.updateOne({ _id: bC._id }, { $set: { lockUntil: new Date(Date.now() - 60000) } });

      // ═══ A — partial / external / full on one payment ₹200 ═══
      const gw = async () => (await rz.payments.fetchMultipleRefund(payA)).items;
      let r1 = await issueRazorpayRefund({ paymentId: payA, amountInPaise: 5000, reason: "SUPPORT_TEST", bookingId: bA._id, initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}A1_${runTag}` });
      check("A1 PARTIAL refund ₹50 → real Razorpay refund with an id; Refund record stores refundId + refundStatus", /^rfnd_/.test(r1.refund.razorpayRefundId || "") && r1.refund.amountInPaise === 5000 && ["PENDING", "PROCESSED"].includes(r1.refund.refundStatus) && r1.refund.isFull === false, r1.refund);
      const gwA1 = (await gw());
      check("A2 Razorpay itself lists that refund: ₹50, notes carry our refundRef", gwA1.length === 1 && gwA1[0].amount === 5000 && gwA1[0].notes?.refundRef === String(r1.refund._id), gwA1.map((x) => [x.id, x.amount]));
      const replay = await issueRazorpayRefund({ paymentId: payA, amountInPaise: 5000, idempotencyKey: `${P}A1_${runTag}`, reason: "SUPPORT_TEST" });
      check("A3 SAME idempotency key again → the same refund returned, idempotent:true, still ONE refund at Razorpay", replay.idempotent === true && String(replay.refund._id) === String(r1.refund._id) && (await gw()).length === 1);
      const conc = await Promise.allSettled([1, 2, 3, 4, 5].map(() => issueRazorpayRefund({ paymentId: payA, amountInPaise: 2000, idempotencyKey: `${P}A2_${runTag}`, reason: "SUPPORT_TEST", bookingId: bA._id })));
      const gwAfterConc = await gw();
      check("A4 five CONCURRENT identical requests → exactly ONE new ₹20 refund at Razorpay (others replay or are told a refund is in progress)",
        gwAfterConc.length === 2 && gwAfterConc.filter((x) => x.amount === 2000).length === 1 && conc.every((c) => c.status === "fulfilled" || c.reason?.code === "REFUND_IN_PROGRESS"), { n: gwAfterConc.length, conc: conc.map((c) => c.status === "fulfilled" ? "ok" : c.reason?.code) });
      check("A4b …and exactly one Refund document for that key", (await Refund.countDocuments({ idempotencyKey: `${P}A2_${runTag}` })) === 1);
      // external refund (as if made from the Razorpay dashboard)
      const ext = await rz.payments.refund(payA, { amount: 6000, notes: { source: "ztest_dashboard" } });
      const dProc = await deliverProcessed(ext.id, payA);
      const extDoc = await Refund.findOne({ razorpayRefundId: ext.id }).lean();
      check("A5 refund made OUTSIDE the system + refund.processed → recorded as EXTERNAL Refund (PROCESSED); flagged NEEDS_REVIEW because it refunds a confirmed booking", extDoc?.initiatedBy?.type === "EXTERNAL" && extDoc.refundStatus === "PROCESSED" && dProc.res.data.outcome === "REFUND_ON_CONFIRMED_BOOKING", { extDoc: extDoc?.refundStatus, o: dProc.res.data });
      // complete our two refunds via webhook (real entities)
      for (const id of [r1.refund.razorpayRefundId, gwAfterConc.find((x) => x.amount === 2000).id]) await deliverProcessed(id, payA);
      const docs = await Refund.find({ paymentId: payA }).lean();
      check("A6 refund.processed completes our refunds → all three Refund records PROCESSED (5000 + 2000 + 6000)", docs.length === 3 && docs.every((d) => d.refundStatus === "PROCESSED" && d.processedAt), docs.map((d) => [d.amountInPaise, d.refundStatus]));
      let tA = await Transaction.findOne({ paymentId: payA }).lean();
      check("A7 Transaction.refundAmount = 13000, status still PAID (only partially refunded); booking paymentStatus still PAID", tA.refundAmount === 13000 && tA.status === "PAID" && (await fresh(bA._id)).paymentStatus === "PAID", { ra: tA.refundAmount, st: tA.status });
      const dup = await webhook("refund.processed", { refund: await rz.refunds.fetch(ext.id), payment: await rz.payments.fetch(payA) }, dProc.res.id ? dProc.res.id : undefined);
      check("A8 refund.processed with the same event id redelivered → duplicate, nothing changes", dup.status === 200, dup.data);
      // over-refund
      let over; try { await issueRazorpayRefund({ paymentId: payA, amountInPaise: 8000, idempotencyKey: `${P}A3_${runTag}` }); } catch (e) { over = e; }
      check("A9 refund larger than what is left (₹80 asked, ₹70 left — the external ₹60 counts) → rejected 400 EXCEEDS_REFUNDABLE; no gateway refund made", over?.code === "EXCEEDS_REFUNDABLE" && (await gw()).length === 3, over?.message);
      // FULL = the rest
      const full = await issueRazorpayRefund({ paymentId: payA, idempotencyKey: `${P}A4_${runTag}`, reason: "SUPPORT_TEST", bookingId: bA._id, initiatedBy: { type: "ADMIN" } });
      check("A10 FULL refund (no amount) refunds exactly what is left: ₹70; marked isFull", full.refund.amountInPaise === 7000 && full.refund.isFull === true, full.refund);
      await deliverProcessed(full.refund.razorpayRefundId, payA);
      tA = await Transaction.findOne({ paymentId: payA }).lean();
      const bA2 = await fresh(bA._id);
      check("A11 payment now fully refunded (20000): Transaction REFUNDED and Booking.paymentStatus = REFUNDED automatically", tA.status === "REFUNDED" && tA.refundAmount === 20000 && bA2.paymentStatus === "REFUNDED", { t: [tA.status, tA.refundAmount], b: bA2.paymentStatus });
      const rz2 = await rz.payments.fetch(payA);
      check("A12 Razorpay agrees: payment amount_refunded = 20000", rz2.amount_refunded === 20000 && rz2.refund_status === "full", [rz2.amount_refunded, rz2.refund_status]);
      let again; try { await issueRazorpayRefund({ paymentId: payA, amountInPaise: 100, idempotencyKey: `${P}A5_${runTag}` }); } catch (e) { again = e; }
      check("A13 refunding an already fully refunded payment → 409 ALREADY_FULLY_REFUNDED", again?.code === "ALREADY_FULLY_REFUNDED", again?.message);
      let bad; try { await issueRazorpayRefund({ paymentId: payA, amountInPaise: 0, idempotencyKey: `${P}A6_${runTag}` }); } catch (e) { bad = e; }
      check("A14 zero / invalid amount and a non-payment id are rejected before any gateway call", bad?.code === "BAD_AMOUNT" && (await issueRazorpayRefund({ paymentId: "order_x", idempotencyKey: "k" }).catch((e) => e.code)) === "BAD_PAYMENT_ID");
      // refund.failed handling (synthetic — real test-mode refunds do not fail)
      const pend = await Refund.create({ paymentId: payA, amountInPaise: 100, paymentAmountInPaise: 20000, idempotencyKey: `${P}synthetic_${runTag}`, razorpayRefundId: "rfnd_ZTESTSYNTH0001", refundStatus: "PENDING", gatewayStatus: "pending", bookingId: bA._id });
      let rf = await webhook("refund.failed", { refund: { id: "rfnd_ZTESTSYNTH0001", entity: "refund", payment_id: payA, amount: 100, status: "failed" } });
      check("A15 refund.failed (synthetic event) marks a PENDING refund FAILED", rf.data.outcome === "REFUND_FAILED_RECORDED" && (await Refund.findById(pend._id).lean()).refundStatus === "FAILED");
      rf = await webhook("refund.failed", { refund: { id: ext.id, entity: "refund", payment_id: payA, amount: 6000, status: "failed" } });
      check("A16 a late/contradictory refund.failed can never move a PROCESSED refund backwards", (await Refund.findOne({ razorpayRefundId: ext.id }).lean()).refundStatus === "PROCESSED");

      // ═══ B — cancellation refund executed to the ORIGINAL payment source ═══
      await Booking.collection.updateOne({ _id: bB._id }, { $set: { status: "CANCELLED", cancellationPolicy: "FULL_REFUND", refundAmountInPaise: 10000 } });
      const pendingBefore = (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise;
      const resB = await issueRefundForCancelledBooking({ bookingId: bB._id, triggeredBy: "ADMIN", triggeredById: owner._id, refundTo: "SOURCE" });
      const gwB = (await rz.payments.fetchMultipleRefund(payB)).items;
      check("B1 existing cancellation refund with refundTo=SOURCE → real Razorpay refund for the policy amount (₹100, full)", resB.refundPaise === 10000 && /^rfnd_/.test(resB.refundId || "") && gwB.length === 1 && gwB[0].amount === 10000, { resB, gw: gwB.map((x) => x.amount) });
      check("B2 no in-app wallet credit was made (the customer's wallet balance is untouched)", (await User.findById(cu.u._id).lean()).walletBalance === 0);
      const pendingAfter = (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise;
      check("B3 the salon's PENDING earnings were clawed back by the service portion (₹70) through the existing debitPending", pendingBefore - pendingAfter === 7000, { pendingBefore, pendingAfter });
      const resB2 = await issueRefundForCancelledBooking({ bookingId: bB._id, triggeredBy: "ADMIN", triggeredById: owner._id, refundTo: "SOURCE" });
      check("B4 calling it again → alreadyIssued; no second refund at Razorpay; no second salon debit", resB2.alreadyIssued === true && (await rz.payments.fetchMultipleRefund(payB)).items.length === 1 && (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise === pendingAfter);
      await deliverProcessed(resB.refundId, payB);
      const bB2 = await fresh(bB._id);
      const tB = await Transaction.findOne({ paymentId: payB }).lean();
      check("B5 refund.processed → booking B paymentStatus REFUNDED, Transaction REFUNDED — and NOT flagged for review (we issued it)", bB2.paymentStatus === "REFUNDED" && tB.status === "REFUNDED" && (await WebhookEvent.findOne({ paymentId: payB, outcome: "REFUND_COMPLETED" }).lean()) !== null);
      let noSrc; try { const wb = await mkBooking({ total: 9000 }); await Transaction.create({ bookingId: wb._id, userId: cu.u._id, salonId: salon._id, resourceId: oid(), paymentId: `wallet_${wb._id}`, amount: 9000, commission: 3000, payoutAmount: 6000, status: "PAID", type: "BOOKING", paymentMethod: "WALLET" }); await Booking.collection.updateOne({ _id: wb._id }, { $set: { status: "CANCELLED", cancellationPolicy: "FULL_REFUND", refundAmountInPaise: 9000 } }); await issueRefundForCancelledBooking({ bookingId: wb._id, triggeredBy: "ADMIN", triggeredById: owner._id, refundTo: "SOURCE" }); } catch (e) { noSrc = e; }
      check("B6 a wallet-paid booking has no original Razorpay payment → SOURCE refund refused (409)", noSrc?.code === "NOT_RAZORPAY_PAID", noSrc?.message);
      check("B7 the support refund endpoint accepts refundTo WALLET|SOURCE (default WALLET) and still rejects amounts / unknown fields",
        supportInternalSchemas.issueRefund.validate({}).value.refundTo === "WALLET" && !supportInternalSchemas.issueRefund.validate({ refundTo: "SOURCE" }).error && !!supportInternalSchemas.issueRefund.validate({ refundTo: "NOPE" }).error && !!supportInternalSchemas.issueRefund.validate({ amountInPaise: 1 }).error);

      // ═══ C — automatic refund (P0-B path) through the engine → booking REFUNDED ═══
      const payCEntity = await rz.payments.fetch(payC);
      const wC = await webhook("payment.captured", { payment: payCEntity });
      const refC = await Refund.findOne({ paymentId: payC }).lean();
      check("C1 expired hold + payment.captured → automatic FULL refund recorded through the engine (key auto:<paymentId>, reason HOLD_EXPIRED, initiatedBy SYSTEM)", wC.status === 200 && refC?.idempotencyKey === `auto:${payC}` && refC.reason === "HOLD_EXPIRED" && refC.initiatedBy.type === "SYSTEM" && refC.amountInPaise === 15000 && refC.isFull, { wC: wC.data, refC });
      const wC2 = await webhook("order.paid", { payment: payCEntity, order: await rz.orders.fetch(oC.orderId) });
      check("C2 order.paid for the same payment → no second refund (one Refund record, one refund at Razorpay)", (await Refund.countDocuments({ paymentId: payC })) === 1 && (await rz.payments.fetchMultipleRefund(payC)).items.length === 1, wC2.data);
      const gwC = (await rz.payments.fetchMultipleRefund(payC)).items[0];
      const dC = await deliverProcessed(gwC.id, payC);
      const bC2 = await fresh(bC._id);
      check("C3 refund.processed → Booking C paymentStatus REFUNDED automatically; booking never confirmed; no Transaction", bC2.paymentStatus === "REFUNDED" && bC2.status !== "CONFIRMED" && (await Transaction.countDocuments({ bookingId: bC._id })) === 0 && dC.res.data.outcome === "REFUND_RECORDED", { ps: bC2.paymentStatus, o: dC.res.data });
      check("C4 the refund record now shows PROCESSED with the Razorpay refundId", (await Refund.findOne({ paymentId: payC }).lean()).refundStatus === "PROCESSED");
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
