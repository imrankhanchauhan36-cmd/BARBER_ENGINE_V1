/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyRazorpayInvalidSignatureRejection.mjs
 *
 * REAL (non-MOCK_RAZORPAY) SIGNATURE REJECTION — isolated, zero
 * network, additive, 2026-10-12. Exercises the REAL branch of
 * controllers/booking.controller.js#verifyRazorpaySignature (lines
 * 353-394) — the one every prior HTTP test in this engagement
 * deliberately skipped via the MOCK_RAZORPAY bypass. This script
 * does NOT set RAZORPAY_ALLOW_TEST_BYPASS at all, and sends
 * paymentMethod:"RAZORPAY" (never "MOCK_RAZORPAY"), so
 * isMockBypassAllowed is false regardless — the real HMAC check
 * below is what actually runs.
 *
 * SAFE/ISOLATED BY CONSTRUCTION:
 *   - Database: disposable MongoMemoryReplSet, same pattern as every
 *     other script here.
 *   - Auth: fresh random JWT_ACCESS_SECRET, this process only.
 *   - dotenv/.env: NEVER loaded. RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET
 *     are set to obvious placeholder strings ONLY so
 *     services/Razorpay.service.js's import-time guard doesn't throw
 *     (object construction only, no I/O) — never used for a real
 *     call, and never the real configured values.
 *   - Network: razorpayInstance.orders.fetch / .payments.fetch — the
 *     ONLY two methods that could ever cause outbound HTTP traffic in
 *     this flow (services/Razorpay.service.js:69,80) — are monkey-
 *     patched on the shared, already-constructed razorpayInstance
 *     object to throw immediately if called. This is the ONE
 *     instrumentation point this script touches, per the explicit
 *     instruction to stub only the external gateway-fetch boundary.
 *     Signature verification, confirmation logic, and every database
 *     write below are 100% real and unmodified.
 *
 * Run:  cd backend && node scripts/e2e/verifyRazorpayInvalidSignatureRejection.mjs
 */

import crypto from "crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_placeholder_not_real";
process.env.RAZORPAY_KEY_SECRET = "placeholder_not_real_secret";
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SKIP_REDIS_AUTOCONNECT = "true";
// Deliberately NOT setting RAZORPAY_ALLOW_TEST_BYPASS at all — this
// test must exercise the real branch, never the mock bypass.

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
  await mongoose.connect(mem.getUri(), { dbName: "razorpay_invalid_signature_rejection" });

  const User = (await import("../../models/User.js")).default;
  const Salon = (await import("../../models/Salon.js")).default;
  const Chair = (await import("../../models/Chair.js")).default;
  const Service = (await import("../../models/Service.js")).default;
  const Booking = (await import("../../models/Booking.js")).default;
  const Transaction = (await import("../../models/Transaction.js")).default;
  const RevenueSplit = (await import("../../modules/finance/models/RevenueSplit.js")).default;
  const GSTLedger = (await import("../../modules/finance/models/GSTLedger.js")).default;
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
  const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");
  const { protect } = await import("../../middlewares/auth.middleware.js");
  const { onboardingBypass } = await import("../../middlewares/onboardingBypass.middleware.js");
  const bookingRoutes = (await import("../../routes/booking.routes.js")).default;
  const { razorpayInstance } = await import("../../services/Razorpay.service.js");

  // ── THE ONE INSTRUMENTATION POINT — external gateway-fetch
  // boundary only. Anything else (signature check, confirm logic,
  // DB writes) is completely real and untouched. ──
  let gatewayFetchCallCount = 0;
  razorpayInstance.orders.fetch = async (...args) => {
    gatewayFetchCallCount++;
    throw new Error(`UNEXPECTED NETWORK CALL — razorpayInstance.orders.fetch(${JSON.stringify(args)}) was invoked; an invalid signature should short-circuit BEFORE any gateway fetch.`);
  };
  razorpayInstance.payments.fetch = async (...args) => {
    gatewayFetchCallCount++;
    throw new Error(`UNEXPECTED NETWORK CALL — razorpayInstance.payments.fetch(${JSON.stringify(args)}) was invoked; an invalid signature should short-circuit BEFORE any gateway fetch.`);
  };

  let server, baseUrl;

  try {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", protect, onboardingBypass, bookingRoutes); // real, unmodified

    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const adminId = oid();
    const testUser = await User.create({ name: "Signature Rejection Test User", role: "USER", phone: "9000000097", tokenVersion: 0, isActive: true });
    const token = generateAccessToken(testUser);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const httpGet = async (path) => { const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders }); return { status: res.status, body: await res.json() }; };
    const httpPost = async (path, body) => { const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };

    const ALL_DAYS_OPEN = {};
    for (const d of ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]) ALL_DAYS_OPEN[d] = { open: "09:00", close: "21:00", isClosed: false };
    const salon = await Salon.create({ ownerId: oid(), basicInfo: { shopName: "Signature Rejection Test Salon", category: "UNISEX", gstStatus: "REGISTERED" }, approval: { status: "APPROVED" }, timings: ALL_DAYS_OPEN });
    const chair = await Chair.create({ salonId: salon._id, name: "Chair 1", position: 1, isActive: true });
    const service = await Service.create({ salonId: salon._id, name: "haircut", price: 500, duration: 30, isActive: true });

    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });

    const today = new Date();
    const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth()+1).padStart(2,"0")}-${String(today.getUTCDate()).padStart(2,"0")}`;
    const slotsRes = await httpGet(`/api/v1/bookings/user/slots?salonId=${salon._id}&date=${dateStr}&serviceDuration=30`);
    check("Real HTTP GET /slots succeeded", slotsRes.status === 200 && slotsRes.body.slots?.length > 0, slotsRes);

    if (!slotsRes.body.slots?.length) {
      console.log(rows.join("\n"));
      console.log("\nSTOPPING — no available slot in the isolated test environment.");
      process.exit(1);
    }

    let lockRes;
    for (let attempt = 0; attempt < 5; attempt++) {
      lockRes = await httpPost("/api/v1/bookings/user/lock", {
        salonId: String(salon._id), date: dateStr, serviceDuration: 30, bufferTime: 0,
        requestedTime: slotsRes.body.slots[0].start, serviceRefs: [String(service._id)],
      });
      if (lockRes.status === 200) break; // same transient-conflict retry as the other suites
    }
    check("Real HTTP POST /lock created a genuine HOLD booking", lockRes.status === 200 && lockRes.body.success === true, lockRes);
    const bookingId = lockRes.body.bookingId;

    //////////////////////////////////////////////////////////
    // THE ACTUAL TEST — real paymentMethod:"RAZORPAY", plausible-
    // looking orderId/paymentId, DELIBERATELY WRONG signature.
    // verifyRazorpaySignature's real branch (booking.controller.js
    // lines 369-372) computes HMAC-SHA256(RAZORPAY_KEY_SECRET,
    // "orderId|paymentId") and timingSafeEqual-compares it against
    // the submitted signature — a random hex string of the same
    // length will not match, and must be rejected BEFORE
    // assertGatewayPaymentForBooking (and therefore before any
    // gateway fetch) ever runs.
    //////////////////////////////////////////////////////////
    const fakeOrderId = `order_fake_${oid()}`;
    const fakePaymentId = `pay_fake_${oid()}`;
    const wrongSignature = crypto.randomBytes(32).toString("hex"); // same length as a real hex-SHA256 digest, deliberately wrong content

    const confirmRes = await httpPost("/api/v1/bookings/user/confirm", {
      bookingId,
      paymentMethod: "RAZORPAY", // real branch — never MOCK_RAZORPAY
      paymentId: fakePaymentId,
      orderId: fakeOrderId,
      razorpaySignature: wrongSignature,
    });

    check("HTTP POST /v1/bookings/user/confirm with an invalid signature → 403 (real verifyRazorpaySignature branch rejected it)", confirmRes.status === 403, confirmRes);
    check('Rejection message indicates signature failure ("invalid signature")', /invalid signature/i.test(confirmRes.body?.message || ""), confirmRes.body);

    // ── Prove the gateway-fetch boundary was NEVER reached ──
    check("razorpayInstance.orders.fetch / .payments.fetch were NEVER called (gateway fetch boundary not reached — proves rejection happened before any network attempt)", gatewayFetchCallCount === 0, gatewayFetchCallCount);

    // ── Booking remains HOLD, completely unaffected ──
    const bookingAfter = await Booking.findById(bookingId).lean();
    check("Booking status is still HOLD (not CONFIRMED, not mutated by the rejected attempt)", bookingAfter?.status === "HOLD", bookingAfter?.status);
    check("Booking's razorpayOrderId remains null (assertGatewayPaymentForBooking's own order-persistence step never ran)", bookingAfter?.razorpayOrderId === null, bookingAfter?.razorpayOrderId);

    // ── Zero financial side effects anywhere ──
    const txnCount = await Transaction.countDocuments({});
    const splitCount = await RevenueSplit.countDocuments({});
    const ledgerCount = await GSTLedger.countDocuments({});
    check("Zero Transaction documents exist in the isolated DB", txnCount === 0, txnCount);
    check("Zero RevenueSplit documents exist in the isolated DB", splitCount === 0, splitCount);
    check("Zero GSTLedger documents exist in the isolated DB", ledgerCount === 0, ledgerCount);

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY INVALID SIGNATURE REJECTION (REAL BRANCH, ZERO NETWORK): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
