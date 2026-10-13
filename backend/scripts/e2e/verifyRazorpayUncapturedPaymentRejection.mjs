/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyRazorpayUncapturedPaymentRejection.mjs
 *
 * PAYMENT VERIFICATION & WEBHOOK IDEMPOTENCY TEST SUITE — PART A
 * (Uncaptured payment), isolated, additive, 2026-10-12.
 *
 * Exercises the REAL, non-MOCK_RAZORPAY confirmation path end-to-end
 * over genuine HTTP: a locally-generated VALID signature (same HMAC
 * formula as production, computed with this process's own placeholder
 * RAZORPAY_KEY_SECRET) passes verifyRazorpaySignature, so the request
 * reaches assertGatewayPaymentForBooking — the real gateway-verification
 * function — which then rejects the payment because Razorpay (stubbed)
 * reports it as NOT captured. This proves the capture check itself,
 * not just the signature check already covered by
 * verifyRazorpayInvalidSignatureRejection.mjs.
 *
 * SAFE/ISOLATED BY CONSTRUCTION:
 *   - Database: disposable MongoMemoryReplSet, same pattern as every
 *     other script in this directory.
 *   - Auth: fresh random JWT_ACCESS_SECRET, this process only.
 *   - dotenv/.env: NEVER loaded. RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET
 *     are obvious placeholder strings this script itself invents —
 *     never the real configured values — used ONLY to (a) satisfy
 *     Razorpay.service.js's import-time constructor guard and (b)
 *     locally compute the SAME HMAC a real client's browser SDK would
 *     produce, for a signature this test knows to be "valid" by
 *     construction.
 *   - Network: razorpayInstance.orders.create / .orders.fetch /
 *     .payments.fetch — the only three SDK methods this flow can call
 *     — are monkey-patched on the shared, already-constructed
 *     razorpayInstance object. orders.create returns a plausible,
 *     locally-fabricated order (never a real Razorpay order — "Do not
 *     create another Razorpay order" is honored by never making the
 *     real network call at all); payments.fetch returns a validly
 *     SHAPED but NOT-captured payment. orders.fetch is stubbed to
 *     throw+count, purely to PROVE it is never reached (booking.
 *     razorpayOrderId is already persisted via the real create-order
 *     endpoint below, so assertGatewayPaymentForBooking's own
 *     fetchRazorpayOrder branch is never taken). Signature
 *     verification, the capture-status check, and every database
 *     write are 100% real and unmodified.
 *
 * Run:  cd backend && node scripts/e2e/verifyRazorpayUncapturedPaymentRejection.mjs
 */

import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_placeholder_not_real";
process.env.RAZORPAY_KEY_SECRET = "placeholder_not_real_secret_" + crypto.randomBytes(8).toString("hex");
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SKIP_REDIS_AUTOCONNECT = "true";
// Deliberately NOT setting RAZORPAY_ALLOW_TEST_BYPASS — this test must
// exercise the real (non-mock) verification + gateway-check branch.

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
  await mongoose.connect(mem.getUri(), { dbName: "razorpay_uncaptured_payment_rejection" });

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

  // ── THE GATEWAY-FETCH BOUNDARY — the only three SDK methods this
  // flow can reach. Nothing else (signature check, capture-status
  // check, confirm logic, DB writes) is touched. ──
  let ordersCreateCalls = 0, ordersFetchCalls = 0, paymentsFetchCalls = 0;
  razorpayInstance.orders.create = async (params) => {
    ordersCreateCalls++;
    return { id: `order_test_${oid()}`, amount: params.amount, currency: params.currency, notes: params.notes, status: "created" };
  };
  razorpayInstance.orders.fetch = async (...args) => {
    ordersFetchCalls++;
    throw new Error(`UNEXPECTED — orders.fetch(${JSON.stringify(args)}) called; booking.razorpayOrderId should already be set, so this branch should never run.`);
  };
  let uncapturedPaymentShape = null; // set once the real orderId/paymentId are known
  razorpayInstance.payments.fetch = async (paymentId) => {
    paymentsFetchCalls++;
    if (!uncapturedPaymentShape || uncapturedPaymentShape.id !== paymentId) {
      throw new Error(`UNEXPECTED — payments.fetch("${paymentId}") called with no matching stub configured.`);
    }
    return uncapturedPaymentShape;
  };

  let server, baseUrl;

  try {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", protect, onboardingBypass, bookingRoutes);
    app.use("/api/payments", protect, onboardingBypass, paymentRoutes); // identical to app.js's own mount line

    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const adminId = oid();
    const testUser = await User.create({ name: "Uncaptured Payment Test User", role: "USER", phone: "9000000096", tokenVersion: 0, isActive: true });
    const token = generateAccessToken(testUser);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const httpGet = async (path) => { const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders }); return { status: res.status, body: await res.json() }; };
    const httpPost = async (path, body) => { const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };

    const ALL_DAYS_OPEN = {};
    for (const d of ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]) ALL_DAYS_OPEN[d] = { open: "09:00", close: "21:00", isClosed: false };
    const salon = await Salon.create({ ownerId: oid(), basicInfo: { shopName: "Uncaptured Payment Test Salon", category: "UNISEX", gstStatus: "REGISTERED" }, approval: { status: "APPROVED" }, timings: ALL_DAYS_OPEN });
    await Chair.create({ salonId: salon._id, name: "Chair 1", position: 1, isActive: true });
    const service = await Service.create({ salonId: salon._id, name: "haircut", price: 500, duration: 30, isActive: true });

    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });

    //////////////////////////////////////////////////////////
    // 1. REAL HTTP — lock a genuine HOLD booking.
    //////////////////////////////////////////////////////////
    // Tomorrow, not today — getSmartSlots filters out already-past
    // times for the CURRENT calendar day, so a run late in the day
    // (after the salon's 21:00 close) would otherwise see zero slots
    // for today regardless of any code defect. Tomorrow is immune to
    // the time-of-day this script happens to run at.
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

    //////////////////////////////////////////////////////////
    // 2. REAL HTTP — POST /api/payments/create-order. Real route,
    //    real DB persistence of booking.razorpayOrderId; the only
    //    stubbed piece is the outbound call to Razorpay itself
    //    (orders.create).
    //////////////////////////////////////////////////////////
    const createOrderRes = await httpPost("/api/payments/create-order", { bookingId });
    check("Real HTTP POST /api/payments/create-order → 200 (stubbed orders.create, real persistence)", createOrderRes.status === 200 && createOrderRes.body.success === true, createOrderRes);
    const orderId = createOrderRes.body.orderId;

    const bookingAfterOrder = await Booking.findById(bookingId).lean();
    check("Booking's razorpayOrderId was persisted by the REAL create-order endpoint", bookingAfterOrder?.razorpayOrderId === orderId, bookingAfterOrder?.razorpayOrderId);

    //////////////////////////////////////////////////////////
    // 3. THE ACTUAL TEST — a VALID signature (real HMAC, computed
    //    exactly like a real client SDK would) for a payment that
    //    Razorpay (stubbed) reports as NOT captured.
    //////////////////////////////////////////////////////////
    const paymentId = `pay_test_${oid()}`;
    const validSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    uncapturedPaymentShape = {
      id: paymentId,
      order_id: orderId,
      currency: "INR",
      amount: totalAmountInPaise,
      status: "created", // NOT "captured" — and not "authorized" either, so fetchAndEvaluateCapturedPayment's retry-on-authorized loop never triggers (deterministic, fast test)
      amount_refunded: 0,
    };

    const confirmRes = await httpPost("/api/v1/bookings/user/confirm", {
      bookingId,
      paymentMethod: "RAZORPAY", // real branch — never MOCK_RAZORPAY
      paymentId,
      orderId,
      razorpaySignature: validSignature,
    });

    check("A VALID signature is accepted (reaches the gateway check, not rejected as 403)", confirmRes.status !== 403, confirmRes);
    check("HTTP POST /confirm with a validly-shaped but UNCAPTURED payment → 400, rejected by the real capture check", confirmRes.status === 400, confirmRes);
    check('Rejection message reports the actual gateway status ("not captured (status: created)")', /not captured/i.test(confirmRes.body?.message || ""), confirmRes.body);

    //////////////////////////////////////////////////////////
    // 4. Zero side effects — booking stays HOLD, no financial
    //    records of any kind, no wallet credit.
    //////////////////////////////////////////////////////////
    const bookingAfterConfirm = await Booking.findById(bookingId).lean();
    check("Booking status is still HOLD (not CONFIRMED) after the rejected confirm attempt", bookingAfterConfirm?.status === "HOLD", bookingAfterConfirm?.status);

    const txnCount = await Transaction.countDocuments({ bookingId });
    const splitCount = await RevenueSplit.countDocuments({ bookingId });
    const ledgerCount = await GSTLedger.countDocuments({ bookingId });
    const walletCreditCount = await WalletLedger.countDocuments({ entityType: "BOOKING", entityId: bookingId });
    check("Zero Transaction documents exist for this booking", txnCount === 0, txnCount);
    check("Zero RevenueSplit documents exist for this booking", splitCount === 0, splitCount);
    check("Zero GSTLedger documents exist for this booking", ledgerCount === 0, ledgerCount);
    check("Zero WalletLedger (salon wallet credit) documents exist for this booking — no wallet credit for an uncaptured payment", walletCreditCount === 0, walletCreditCount);

    //////////////////////////////////////////////////////////
    // 5. Gateway-call accounting — orders.fetch must never have been
    //    reached (booking.razorpayOrderId already matched); exactly
    //    one orders.create (the setup step) and at least one
    //    payments.fetch (the capture check itself).
    //////////////////////////////////////////////////////////
    check("razorpayInstance.orders.fetch was NEVER called (booking.razorpayOrderId already matched orderId)", ordersFetchCalls === 0, ordersFetchCalls);
    check("razorpayInstance.orders.create was called exactly once (the stubbed create-order setup step, not a real Razorpay order)", ordersCreateCalls === 1, ordersCreateCalls);
    check("razorpayInstance.payments.fetch was called (the real capture-status check ran)", paymentsFetchCalls >= 1, paymentsFetchCalls);

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY UNCAPTURED PAYMENT REJECTION (REAL BRANCH, STUBBED GATEWAY ONLY): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
