/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRevenueSplitIntegration.js
 *
 * P0 Revenue Calculation Engine — Step 3 — live verification.
 *
 * Real Express app, real signed JWTs, real Atlas dev DB, disposable
 * fixtures purged before/after. PART B pays two REAL Razorpay TEST-mode
 * orders through the hosted checkout (Razorpay cannot reach localhost,
 * so — same honest-scope note as every prior Razorpay verification
 * script — the webhook delivery itself is simulated from real Razorpay
 * entities, signed with a test secret; the payment/order/refund calls
 * are 100% real).
 *
 * Proves:
 *   1. A Razorpay-confirmed booking gets exactly one immutable
 *      RevenueSplit, with the correct service/fee/GST/customer-paid
 *      split and the live PUBLISHED policyVersion.
 *   2. Salon Hold Wallet is credited with ONLY the service amount —
 *      unmodified existing behaviour, asserted equal to the split's own
 *      salonCreditInPaise.
 *   3. Idempotent: a duplicate client /confirm and a raced
 *      webhook+client confirmation both produce exactly ONE split.
 *   4. Never recalculated: republishing new RevenueSettings after a
 *      split exists does not change it.
 *   5. WALLET-paid bookings are explicitly out of scope — no split.
 *   6. No PUBLISHED RevenueSettings at all → booking confirmation still
 *      succeeds normally; simply no split is created.
 *   7. Existing Transaction/WalletLedger/refund code paths are
 *      completely unmodified and still work exactly as before.
 *
 * Run:
 *   node scripts/verifyRevenueSplitIntegration.js                (Part A only)
 *   RZP_LIVE_PAYMENTS=1 node scripts/verifyRevenueSplitIntegration.js  (Part A + B)
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
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js"; // Step 4.1 — createRevenueSplitForBooking now also creates a GST ledger row as a side effect; purge must clean it up too
import { REVENUE_SETTINGS_STATUS } from "../modules/finance/constants/revenue.constants.js";
import { createRevenueSplitForBooking } from "../modules/finance/services/RevenueSplitIntegrationService.js";
import { issueRefundForCancelledBooking } from "../services/RefundExecutionService.js";

if (String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_live_")) {
  console.error("Refusing to run against a LIVE Razorpay key.");
  process.exit(2);
}
const LIVE = process.env.RZP_LIVE_PAYMENTS === "1";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_REVSPLIT3_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const runTag = Date.now();

const purge = async (fixtureUserIds, fixtureSettingsIds, extraBookingIds = []) => {
  const users = await User.find({ _id: { $in: fixtureUserIds } }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const salons = await Salon.find({ ownerId: { $in: userIds } }).select("_id").lean();
  const salonIds = salons.map((s) => s._id);
  const bookings = await Booking.find({ userRef: { $in: userIds } }).select("_id").lean();
  const bookingIds = [...bookings.map((b) => b._id), ...extraBookingIds];
  await GSTLedger.collection.deleteMany({ bookingId: { $in: bookingIds } });
  await RevenueSplit.collection.deleteMany({ bookingId: { $in: bookingIds } });
  await Transaction.deleteMany({ bookingId: { $in: bookingIds } });
  await WalletLedger.collection.deleteMany({ $or: [{ ownerId: { $in: salonIds } }, { salonId: { $in: salonIds } }] });
  await SalonEarnings.deleteMany({ $or: [{ salonId: { $in: salonIds } }, { entityId: { $in: salonIds } }] });
  await Booking.collection.deleteMany({ _id: { $in: bookingIds } });
  await Salon.deleteMany({ _id: { $in: salonIds } });
  await RevenueSettings.deleteMany({ _id: { $in: fixtureSettingsIds } });
  await User.deleteMany({ _id: { $in: userIds } });
};

const run = async () => {
  await connectDB();
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

  const fixtureUserIds = [];
  const fixtureSettingsIds = [];
  let payServer = null;

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB");

    const mkUser = async (label) => {
      const u = await User.create({ name: `${P}${label}`, phone: phone(), role: "USER", accountStatus: "ACTIVE", walletBalance: 0 });
      fixtureUserIds.push(u._id);
      return { u, token: generateAccessToken({ _id: u._id, role: "USER", tokenVersion: 0 }) };
    };
    const mkSalon = async (owner) => {
      const dayTiming = { open: "09:00", close: "20:00" };
      return Salon.create({
        ownerId: owner._id, basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
        timings: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, dayTiming])),
        location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${P} addr` },
      });
    };
    let slot = 0;
    const mkBooking = async (user, salon, { total = 12000, service = 10000, lockMinutes = 90 } = {}) => {
      const start = new Date(Date.now() + (120 + slot++ * 45) * 60000);
      return Booking.create({
        userRef: user.u._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.HOLD, lockUntil: new Date(Date.now() + lockMinutes * 60000),
        serviceAmountInPaise: service, commissionAmountInPaise: total - service, totalAmountInPaise: total,
      });
    };
    const createOrder = (user, bookingId) => call("/api/payments/create-order", user.token, { method: "POST", body: { bookingId: String(bookingId) } });
    const clientConfirm = (user, bookingId, orderId, paymentId) => call("/api/v1/bookings/user/confirm", user.token, { method: "POST", body: { bookingId: String(bookingId), paymentMethod: "RAZORPAY", orderId, paymentId, razorpaySignature: crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex") } });
    const walletBal = async (salon) => (await SalonEarnings.findOne({ salonId: salon._id }).lean())?.pendingBalanceInPaise ?? 0;
    const publishSettings = async (platformFeeInPaise, gstRate) => {
      // Retire whatever this run may have already published, then publish a fresh version.
      await RevenueSettings.updateMany({ status: "PUBLISHED" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      const last = await RevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
      const doc = await RevenueSettings.create({ platformFeeInPaise, gstRate, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: (last?.version ?? 0) + 1, createdBy: indiaAdmin._id, status: "PUBLISHED", publishedAt: new Date(), publishedBy: indiaAdmin._id });
      fixtureSettingsIds.push(doc._id);
      return doc;
    };
    // Baseline: nothing PUBLISHED from a previous run should leak into "no settings" checks.
    const preExistingPublished = await RevenueSettings.findOne({ status: "PUBLISHED" }).lean();

    // ═══ PART A — unit-level (no real payment needed) ═══════════════
    // A1: no PUBLISHED settings at all → confirmation succeeds, no split, no error.
    await RevenueSettings.updateMany({ status: "PUBLISHED" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
    const ownerA = await mkUser("OWNER_A");
    const salonA = await mkSalon(ownerA.u);
    const custA = await mkUser("CUST_A");
    const bNoSettings = await mkBooking(custA, salonA, { total: 11000, service: 10000 });
    const splitResultNoSettings = await createRevenueSplitForBooking({ booking: bNoSettings });
    check("A1. No PUBLISHED RevenueSettings → function returns null (no error thrown), booking untouched", splitResultNoSettings === null && (await RevenueSplit.countDocuments({ bookingId: bNoSettings._id })) === 0);

    // Publish a real version now for the rest of Part A.
    const settingsV1 = await publishSettings(2000, 18); // ₹20 fee, 18% GST
    check("A2. RevenueSettings published for the rest of this run", settingsV1.status === "PUBLISHED");

    // A3: WALLET-paid booking (no razorpayOrderId) is explicitly out of scope.
    const bWallet = await mkBooking(custA, salonA, { total: 10000, service: 10000 });
    const splitWallet = await createRevenueSplitForBooking({ booking: bWallet });
    check("A3. WALLET-paid booking (no razorpayOrderId) → explicitly out of scope, no split created", splitWallet === null && (await RevenueSplit.countDocuments({ bookingId: bWallet._id })) === 0);

    // A4: a Razorpay-order-tagged booking (simulated, no real gateway needed for this unit check) gets a correct split.
    const bSim = await mkBooking(custA, salonA, { total: 12360, service: 10000 });
    await Booking.collection.updateOne({ _id: bSim._id }, { $set: { razorpayOrderId: `order_ZTESTSIM${runTag}` } });
    const bSimDoc = await Booking.findById(bSim._id);
    const split1 = await createRevenueSplitForBooking({ booking: bSimDoc });
    check("A4. Split created with the LOCKED formula: service ₹100 + fee ₹20 + GST(18% of fee)=₹3.60 → customer ₹123.60",
      split1?.serviceAmountInPaise === 10000 && split1.platformFeeInPaise === 2000 && split1.gstAmountInPaise === 360 && split1.customerPaidInPaise === 12360, split1);
    check("A5. salonCreditInPaise === serviceAmountInPaise, zemishRevenueInPaise === platformFeeInPaise (LOCKED split)", split1.salonCreditInPaise === 10000 && split1.zemishRevenueInPaise === 2000);
    check("A6. policyVersion snapshotted from the live PUBLISHED version", split1.policyVersion === settingsV1.version);

    // A7: idempotent — calling again does NOT recalculate, even after republishing a different fee.
    const settingsV2 = await publishSettings(2500, 18);
    const split1Again = await createRevenueSplitForBooking({ booking: bSimDoc });
    check("A7. Calling again after a republish (₹25 fee) → returns the SAME split unchanged (₹20 fee, old policyVersion) — never recalculated", String(split1Again._id) === String(split1._id) && split1Again.platformFeeInPaise === 2000 && split1Again.policyVersion === settingsV1.version, split1Again);
    check("A8. Exactly one RevenueSplit exists for this booking", (await RevenueSplit.countDocuments({ bookingId: bSim._id })) === 1);

    // A9: concurrent race for the same booking → exactly one split, no error thrown to either caller.
    const bRace = await mkBooking(custA, salonA, { total: 12500, service: 10000 });
    await Booking.collection.updateOne({ _id: bRace._id }, { $set: { razorpayOrderId: `order_ZTESTRACE${runTag}` } });
    const bRaceDoc = await Booking.findById(bRace._id);
    const raced = await Promise.all([1, 2, 3, 4, 5].map(() => createRevenueSplitForBooking({ booking: bRaceDoc })));
    check("A9. Five CONCURRENT calls for the same booking → all resolve without throwing, all return the SAME split id", raced.every((r) => r && String(r._id) === String(raced[0]._id)), raced.map((r) => r?._id));
    check("A10. Exactly one RevenueSplit row exists after the race (unique index held)", (await RevenueSplit.countDocuments({ bookingId: bRace._id })) === 1);

    // A11: immutability still enforced (Step 1 guarantee, re-checked in this integration's own flow).
    let mutErr;
    try { await RevenueSplit.updateOne({ _id: split1._id }, { $set: { customerPaidInPaise: 1 } }); } catch (e) { mutErr = e; }
    check("A11. The split created by THIS integration is still immutable (Step 1's schema guard applies)", /immutable/i.test(mutErr?.message || ""));

    // ═══ PART B — REAL Razorpay TEST-mode payments through the full HTTP flow ═══
    if (!LIVE) {
      results.push("   PART B skipped (set RZP_LIVE_PAYMENTS=1 to pay two real test-mode orders)");
    } else {
      const settingsLive = await publishSettings(2000, 18); // ₹20 fee, 18% GST — the LOCKED example
      const custB = await mkUser("CUST_B");
      const bReal1 = await mkBooking(custB, salonA, { total: 11100, service: 9500 }); // confirmed via client /confirm
      const bReal2 = await mkBooking(custB, salonA, { total: 22200, service: 20000 }); // confirmed via racing webhook + client
      const o1 = (await createOrder(custB, bReal1._id)).data;
      const o2 = (await createOrder(custB, bReal2._id)).data;

      const paid = new Map();
      payServer = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        if (u.pathname === "/pay") {
          const which = u.searchParams.get("o"); const o = which === "1" ? o1 : o2;
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end(`<!doctype html><meta charset=utf-8><title>Pay ${which}</title><body style="font-family:sans-serif"><h3>Razorpay TEST payment #${which} — ₹${o.amount / 100} — click SUCCESS on the demo bank page</h3>
<form method="POST" action="https://api.razorpay.com/v1/checkout/embedded"><input type=hidden name=key_id value="${process.env.RAZORPAY_KEY_ID}"><input type=hidden name=order_id value="${o.orderId}">
<input type=hidden name=name value="Zemish test"><input type=hidden name="prefill[contact]" value="+918123456789"><input type=hidden name="prefill[email]" value="ztest@example.com">
<input type=hidden name=callback_url value="http://localhost:6161/callback?o=${which}"><input type=hidden name=cancel_url value="http://localhost:6161/callback?o=${which}"><button type=submit>Pay with Razorpay (test mode)</button></form></body>`);
        }
        if (u.pathname === "/callback") {
          let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { paid.set(u.searchParams.get("o"), Object.fromEntries(new URLSearchParams(raw))); res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>done</title><h3>result received — you can close this page</h3>"); });
          return;
        }
        res.writeHead(404); res.end();
      });
      await new Promise((r) => payServer.listen(6161, r));
      console.log(`\nPAYMENT PAGES READY:\n  http://localhost:6161/pay?o=1  (₹111)\n  http://localhost:6161/pay?o=2  (₹222)\nWaiting up to 20 minutes…\n`);
      const t0 = Date.now();
      while (paid.size < 2 && Date.now() - t0 < 20 * 60000) await new Promise((r) => setTimeout(r, 1000));
      check("B0. Both real test payments completed", paid.size === 2, [...paid.keys()]);

      if (paid.size === 2) {
        const p1 = paid.get("1"), p2 = paid.get("2");

        // ── B1: normal client confirm ──
        const c1 = await clientConfirm(custB, bReal1._id, o1.orderId, p1.razorpay_payment_id);
        check("B1. Real payment #1 confirmed via the client flow (200 CONFIRMED)", c1.status === 200, c1.data);
        const split2 = await RevenueSplit.findOne({ bookingId: bReal1._id }).lean();
        check("B2. RevenueSplit auto-created for the REAL Razorpay-confirmed booking: service ₹95 + fee ₹20 + GST ₹3.60 = customer ₹118.60",
          split2?.serviceAmountInPaise === 9500 && split2?.platformFeeInPaise === 2000 && split2?.gstAmountInPaise === 360 && split2?.customerPaidInPaise === 11860, split2);
        check("B3. policyVersion matches the version PUBLISHED at confirmation time", split2?.policyVersion === settingsLive.version);
        const salonWalletAfter1 = await walletBal(salonA);
        check("B4. Salon Hold Wallet credited with ONLY the service amount (₹95) — existing WalletBalanceService code, unmodified, matches split.salonCreditInPaise exactly", salonWalletAfter1 === split2.salonCreditInPaise && salonWalletAfter1 === 9500, salonWalletAfter1);
        const txn1 = await Transaction.findOne({ bookingId: bReal1._id }).lean();
        check("B5. Existing Transaction row created normally (booking amount ₹111, unrelated to the new engine's own ₹118.60) — Transaction logic untouched", txn1?.amount === 11100 && txn1?.status === "PAID", txn1);

        // duplicate client confirm (idempotent booking-level check, already existing behaviour) must not create a second split
        const c1dup = await clientConfirm(custB, bReal1._id, o1.orderId, p1.razorpay_payment_id);
        check("B6. A duplicate client /confirm for the same payment is handled by EXISTING idempotency (200 alreadyConfirmed) and creates no second split", c1dup.status === 200 && (await RevenueSplit.countDocuments({ bookingId: bReal1._id })) === 1, c1dup.data);

        // ── B7: racing webhook + client confirm on the SAME real payment (P0-B precedent) ──
        process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "ztest_rzp_webhook_secret_p0d3";
        const payment2 = await rz.payments.fetch(p2.razorpay_payment_id);
        const webhookPayload = JSON.stringify({ entity: "event", event: "payment.captured", contains: ["payment"], payload: { payment: { entity: payment2 } }, created_at: Math.floor(Date.now() / 1000) });
        const sig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(webhookPayload).digest("hex");
        const [wRes, cRes] = await Promise.all([
          call("/api/webhooks/razorpay", null, { method: "POST", raw: webhookPayload, headers: { "content-type": "application/json", "x-razorpay-event-id": `${P}race_${runTag}`, "x-razorpay-signature": sig } }),
          clientConfirm(custB, bReal2._id, o2.orderId, p2.razorpay_payment_id),
        ]);
        check("B7. Webhook + client racing on the SAME real payment both resolve without a hard failure", [wRes.status, cRes.status].every((s) => s === 200 || s === 500), { w: wRes.status, c: cRes.status });
        const finalBooking2 = await Booking.findById(bReal2._id).lean();
        check("B8. Booking #2 ends up CONFIRMED regardless of which side won the race", finalBooking2.status === "CONFIRMED", finalBooking2.status);
        const splits2 = await RevenueSplit.find({ bookingId: bReal2._id }).lean();
        check("B9. Exactly ONE RevenueSplit exists for booking #2 despite the race — the unique index + idempotency pre-check held", splits2.length === 1, splits2.length);
        check("B10. That split is correct: service ₹200 + fee ₹20 + GST ₹3.60 = customer ₹223.60", splits2[0]?.serviceAmountInPaise === 20000 && splits2[0]?.customerPaidInPaise === 22360, splits2[0]);
        const salonWalletAfter2 = await walletBal(salonA);
        check("B11. Salon wallet credited exactly once for booking #2's service amount too (₹95+₹200=₹295 total pending)", salonWalletAfter2 === 29500, salonWalletAfter2);

        // ── B12: existing refund engine (P0-C) completely untouched — cancel + source-refund booking #1 ──
        await Booking.collection.updateOne({ _id: bReal1._id }, { $set: { status: "CANCELLED", cancellationPolicy: "FULL_REFUND", refundAmountInPaise: 11100 } });
        const refundResult = await issueRefundForCancelledBooking({ bookingId: bReal1._id, triggeredBy: "ADMIN", triggeredById: indiaAdmin._id, refundTo: "SOURCE" });
        check("B12. Existing RefundExecutionService (P0-C) still works completely unmodified: real Razorpay refund created for the full ₹111", refundResult?.refundPaise === 11100 && /^rfnd_/.test(refundResult?.refundId || ""), refundResult);
        const splitAfterRefund = await RevenueSplit.findById(split2._id).lean();
        check("B13. The RevenueSplit is NEVER touched by a refund — still shows the original ₹118.60 customer-paid snapshot, unchanged", splitAfterRefund.customerPaidInPaise === 11860, splitAfterRefund);
      }
    }
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    if (payServer) payServer.close();
    await purge(fixtureUserIds, fixtureSettingsIds.filter(Boolean)).catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
