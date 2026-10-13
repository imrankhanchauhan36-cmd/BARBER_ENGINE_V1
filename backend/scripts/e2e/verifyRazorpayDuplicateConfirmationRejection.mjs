/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyRazorpayDuplicateConfirmationRejection.mjs
 *
 * PAYMENT VERIFICATION & WEBHOOK IDEMPOTENCY TEST SUITE — PART C
 * (Duplicate confirmation), isolated, additive, 2026-10-12.
 *
 * Drives a REAL, successful RAZORPAY confirmation (locally-generated
 * valid signature + a stubbed-but-validly-shaped CAPTURED payment —
 * never MOCK_RAZORPAY, per the explicit instruction not to use the
 * mock bypass as the sole proof of real payment verification), then
 * replays the confirm call against the now-CONFIRMED booking in two
 * different ways a real retry/double-tap/webhook-race could produce:
 *   (i)  the exact same paymentId again (the client's own retry), and
 *   (ii) a DIFFERENT paymentId against the same already-confirmed
 *        booking (e.g. a second, distinct payment attempt landing
 *        late) — proving the booking's own state machine is the
 *        backstop even when the paymentId-based idempotency check
 *        does not apply.
 * Verifies neither replay credits the salon wallet or creates a
 * second Transaction / RevenueSplit / GSTLedger SALE row.
 *
 * SAFE/ISOLATED BY CONSTRUCTION: same pattern as
 * verifyRazorpayUncapturedPaymentRejection.mjs — disposable
 * MongoMemoryReplSet, throwaway JWT/Razorpay placeholder secrets,
 * zero dotenv/.env, zero real network (orders.create/fetch and
 * payments.fetch are monkey-patched on the shared razorpayInstance;
 * orders.create never contacts the real Razorpay API — "Do not
 * create another Razorpay order" is honored by construction).
 *
 * Run:  cd backend && node scripts/e2e/verifyRazorpayDuplicateConfirmationRejection.mjs
 */

import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_placeholder_not_real";
process.env.RAZORPAY_KEY_SECRET = "placeholder_not_real_secret_" + crypto.randomBytes(8).toString("hex");
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SKIP_REDIS_AUTOCONNECT = "true";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};
const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "razorpay_duplicate_confirmation_rejection" });

  const User = (await import("../../models/User.js")).default;
  const Salon = (await import("../../models/Salon.js")).default;
  const Chair = (await import("../../models/Chair.js")).default;
  const Service = (await import("../../models/Service.js")).default;
  const Booking = (await import("../../models/Booking.js")).default;
  const Transaction = (await import("../../models/Transaction.js")).default;
  const RevenueSplit = (await import("../../modules/finance/models/RevenueSplit.js")).default;
  const GSTLedger = (await import("../../modules/finance/models/GSTLedger.js")).default;
  const WalletLedger = (await import("../../models/WalletLedger.js")).default;
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
  const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");
  const { protect } = await import("../../middlewares/auth.middleware.js");
  const { onboardingBypass } = await import("../../middlewares/onboardingBypass.middleware.js");
  const bookingRoutes = (await import("../../routes/booking.routes.js")).default;
  const paymentRoutes = (await import("../../routes/payment.routes.js")).default;
  const { razorpayInstance } = await import("../../services/Razorpay.service.js");

  let ordersCreateCalls = 0, ordersFetchCalls = 0, paymentsFetchCalls = 0;
  const capturedPaymentsById = new Map(); // paymentId -> validly-shaped captured payment
  razorpayInstance.orders.create = async (params) => {
    ordersCreateCalls++;
    return { id: `order_test_${oid()}`, amount: params.amount, currency: params.currency, notes: params.notes, status: "created" };
  };
  razorpayInstance.orders.fetch = async (...args) => {
    ordersFetchCalls++;
    throw new Error(`UNEXPECTED — orders.fetch(${JSON.stringify(args)}) called; booking.razorpayOrderId should already be set.`);
  };
  razorpayInstance.payments.fetch = async (paymentId) => {
    paymentsFetchCalls++;
    const p = capturedPaymentsById.get(paymentId);
    if (!p) throw new Error(`UNEXPECTED — payments.fetch("${paymentId}") called with no matching stub configured.`);
    return p;
  };

  let server, baseUrl;

  try {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", protect, onboardingBypass, bookingRoutes);
    app.use("/api/payments", protect, onboardingBypass, paymentRoutes);

    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const adminId = oid();
    const testUser = await User.create({ name: "Duplicate Confirmation Test User", role: "USER", phone: "9000000095", tokenVersion: 0, isActive: true });
    const token = generateAccessToken(testUser);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const httpGet = async (path) => { const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders }); return { status: res.status, body: await res.json() }; };
    const httpPost = async (path, body) => { const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };

    const ALL_DAYS_OPEN = {};
    for (const d of ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]) ALL_DAYS_OPEN[d] = { open: "09:00", close: "21:00", isClosed: false };
    const salon = await Salon.create({ ownerId: oid(), basicInfo: { shopName: "Duplicate Confirmation Test Salon", category: "UNISEX", gstStatus: "REGISTERED" }, approval: { status: "APPROVED" }, timings: ALL_DAYS_OPEN });
    await Chair.create({ salonId: salon._id, name: "Chair 1", position: 1, isActive: true });
    const service = await Service.create({ salonId: salon._id, name: "haircut", price: 500, duration: 30, isActive: true });

    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });

    //////////////////////////////////////////////////////////
    // 1. Lock a genuine HOLD booking, mint a (stubbed) order.
    //////////////////////////////////////////////////////////
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth()+1).padStart(2,"0")}-${String(tomorrow.getUTCDate()).padStart(2,"0")}`;
    const slotsRes = await httpGet(`/api/v1/bookings/user/slots?salonId=${salon._id}&date=${dateStr}&serviceDuration=30`);
    if (!slotsRes.body.slots?.length) {
      check("HTTP GET /slots returned at least one available slot", false, slotsRes.body);
      console.log(rows.join("\n"));
      process.exit(1);
    }

    let lockRes;
    for (let attempt = 0; attempt < 5; attempt++) {
      lockRes = await httpPost("/api/v1/bookings/user/lock", {
        salonId: String(salon._id), date: dateStr, serviceDuration: 30, bufferTime: 0,
        requestedTime: slotsRes.body.slots[0].start, serviceRefs: [String(service._id)],
      });
      if (lockRes.status === 200) break;
    }
    check("Real HTTP POST /lock created a genuine HOLD booking", lockRes.status === 200 && lockRes.body.success === true, lockRes);
    const bookingId = lockRes.body.bookingId;
    const totalAmountInPaise = lockRes.body.totalAmountInPaise;

    const createOrderRes = await httpPost("/api/payments/create-order", { bookingId });
    check("Real HTTP POST /api/payments/create-order → 200", createOrderRes.status === 200 && createOrderRes.body.success === true, createOrderRes);
    const orderId = createOrderRes.body.orderId;

    //////////////////////////////////////////////////////////
    // 2. FIRST, genuine confirmation — real signature, real
    //    captured-payment shape, never MOCK_RAZORPAY.
    //////////////////////////////////////////////////////////
    const firstPaymentId = `pay_test_first_${oid()}`;
    const firstSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${firstPaymentId}`).digest("hex");
    capturedPaymentsById.set(firstPaymentId, {
      id: firstPaymentId, order_id: orderId, currency: "INR", amount: totalAmountInPaise, status: "captured", amount_refunded: 0,
    });

    const firstConfirmRes = await httpPost("/api/v1/bookings/user/confirm", {
      bookingId, paymentMethod: "RAZORPAY", paymentId: firstPaymentId, orderId, razorpaySignature: firstSignature,
    });
    check("First confirm: real signature + real CAPTURED payment shape (never MOCK_RAZORPAY) → 200, booking CONFIRMED", firstConfirmRes.status === 200 && firstConfirmRes.body.success === true, firstConfirmRes);

    const bookingAfterFirst = await Booking.findById(bookingId).lean();
    check("Booking transitioned HOLD → CONFIRMED", bookingAfterFirst?.status === "CONFIRMED", bookingAfterFirst?.status);

    const txnCountAfterFirst = await Transaction.countDocuments({ bookingId });
    const splitCountAfterFirst = await RevenueSplit.countDocuments({ bookingId });
    const ledgerCountAfterFirst = await GSTLedger.countDocuments({ bookingId, ledgerType: "SALE" });
    const walletCountAfterFirst = await WalletLedger.countDocuments({ entityType: "BOOKING", entityId: bookingId });
    check("Exactly ONE Transaction created by the genuine confirmation", txnCountAfterFirst === 1, txnCountAfterFirst);
    check("Exactly ONE RevenueSplit created", splitCountAfterFirst === 1, splitCountAfterFirst);
    check("Exactly ONE GSTLedger SALE row created", ledgerCountAfterFirst === 1, ledgerCountAfterFirst);
    check("Exactly ONE WalletLedger (salon wallet) credit created — the real, single, legitimate PENDING credit", walletCountAfterFirst === 1, walletCountAfterFirst);

    //////////////////////////////////////////////////////////
    // 3. REPLAY (i) — the EXACT same paymentId again (client
    //    retry / double-tap / duplicate webhook race landing on the
    //    direct /confirm endpoint too).
    //////////////////////////////////////////////////////////
    const replaySamePaymentRes = await httpPost("/api/v1/bookings/user/confirm", {
      bookingId, paymentMethod: "RAZORPAY", paymentId: firstPaymentId, orderId, razorpaySignature: firstSignature,
    });
    check('Replay with the SAME paymentId → either 200 "already confirmed" (idempotent) or 409 "duplicate" — never reprocessed', (replaySamePaymentRes.status === 200 && replaySamePaymentRes.body?.alreadyConfirmed === true) || replaySamePaymentRes.status === 409, replaySamePaymentRes);

    //////////////////////////////////////////////////////////
    // 4. REPLAY (ii) — a DIFFERENT, genuinely distinct paymentId
    //    against the SAME already-confirmed booking (the
    //    paymentId-based idempotency check at the top of
    //    confirmBooking does not even apply here — the booking's
    //    own state-machine guard is what must catch this).
    //////////////////////////////////////////////////////////
    const secondPaymentId = `pay_test_second_${oid()}`;
    const secondSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${secondPaymentId}`).digest("hex");
    capturedPaymentsById.set(secondPaymentId, {
      id: secondPaymentId, order_id: orderId, currency: "INR", amount: totalAmountInPaise, status: "captured", amount_refunded: 0,
    });
    const replayDifferentPaymentRes = await httpPost("/api/v1/bookings/user/confirm", {
      bookingId, paymentMethod: "RAZORPAY", paymentId: secondPaymentId, orderId, razorpaySignature: secondSignature,
    });
    check("Replay with a DIFFERENT paymentId on an already-CONFIRMED booking is rejected (400 invalid state), not reprocessed as a second real payment", replayDifferentPaymentRes.status === 400, replayDifferentPaymentRes);

    //////////////////////////////////////////////////////////
    // 5. FINAL COUNTS — neither replay produced a second record of
    //    any kind, and the salon wallet was never double-credited.
    //////////////////////////////////////////////////////////
    const txnCountFinal = await Transaction.countDocuments({ bookingId });
    const splitCountFinal = await RevenueSplit.countDocuments({ bookingId });
    const ledgerCountFinal = await GSTLedger.countDocuments({ bookingId, ledgerType: "SALE" });
    const walletCountFinal = await WalletLedger.countDocuments({ entityType: "BOOKING", entityId: bookingId });
    check("STILL exactly ONE Transaction after both replay attempts", txnCountFinal === 1, txnCountFinal);
    check("STILL exactly ONE RevenueSplit after both replay attempts", splitCountFinal === 1, splitCountFinal);
    check("STILL exactly ONE GSTLedger SALE row after both replay attempts", ledgerCountFinal === 1, ledgerCountFinal);
    check("STILL exactly ONE WalletLedger credit after both replay attempts — the salon wallet was NOT double-credited", walletCountFinal === 1, walletCountFinal);

    // The second payment's Transaction.findOne({paymentId}) idempotency
    // check never even ran a DB write for it — confirm structurally
    // that no Transaction references the second (rejected) paymentId.
    const txnForSecondPayment = await Transaction.findOne({ paymentId: secondPaymentId }).lean();
    check("No Transaction exists for the rejected second paymentId — it was never recorded as paid", !txnForSecondPayment, txnForSecondPayment);

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY DUPLICATE CONFIRMATION REJECTION (REAL BRANCH, STUBBED GATEWAY ONLY): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
