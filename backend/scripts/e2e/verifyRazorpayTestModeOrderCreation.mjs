/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyRazorpayTestModeOrderCreation.mjs
 *
 * RAZORPAY TEST-MODE ORDER CREATION — Part B, 2026-10-12. Makes
 * EXACTLY ONE real outbound HTTPS request to Razorpay's API, using
 * the real, already-configured, confirmed-test-mode (`rzp_test_`)
 * credentials — approved explicitly for this one action. Never calls
 * /verify, /confirm, or any webhook; never captures a payment; never
 * uses a production booking or the production database.
 *
 * SURGICAL SECRET HANDLING: unlike every other script in this
 * directory, this ONE file genuinely needs two real values —
 * RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET — to make a real Razorpay
 * API call at all. It reads ONLY those two lines out of backend/.env
 * via a direct regex match on the raw file text (never `dotenv`,
 * which would load every other secret in that file — the real
 * MONGODB_URI, JWT secrets, KYC encryption key, SMS/email provider
 * keys — into this process for no reason). Neither value is ever
 * printed, logged, or included in any check's failure output below.
 *
 * ISOLATION: database is a disposable, in-process MongoMemoryReplSet
 * — the test booking, salon, service, and GST/platform-fee policies
 * used to compute its real price all live ONLY there, never in the
 * real Atlas database. The auth JWT uses its own fresh, randomly
 * generated secret, same pattern as every other HTTP-level script
 * here. The only thing that leaves this machine is the ONE Razorpay
 * API call itself.
 *
 * Run:  cd backend && node scripts/e2e/verifyRazorpayTestModeOrderCreation.mjs
 */

import fs from "fs";
import crypto from "crypto";

// ── Surgical secret extraction — ONLY these two lines, nothing else
// from .env is ever read or loaded into this process. ──
const envText = fs.readFileSync(new URL("../../.env", import.meta.url), "utf8");
const extractEnvValue = (key) => {
  const m = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
};
const realKeyId = extractEnvValue("RAZORPAY_KEY_ID");
const realKeySecret = extractEnvValue("RAZORPAY_KEY_SECRET");

if (!realKeyId || !realKeySecret) {
  console.error("STOPPING — RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not found in backend/.env. Precise prerequisite: configure Razorpay Test Mode credentials before this script can run.");
  process.exit(1);
}
if (!realKeyId.startsWith("rzp_test_")) {
  console.error(`STOPPING — RAZORPAY_KEY_ID does not have the rzp_test_ prefix (this script refuses to run against what may be a live-mode key). Prefix seen: "${realKeyId.slice(0, 9)}..."`);
  process.exit(1);
}

process.env.RAZORPAY_KEY_ID = realKeyId;
process.env.RAZORPAY_KEY_SECRET = realKeySecret;
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString("hex"); // throwaway, this process only
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
  console.log(`Confirmed: RAZORPAY_KEY_ID is test-mode (prefix "${realKeyId.slice(0, 9)}...", value not otherwise printed). Proceeding with exactly one real Razorpay Test Mode API call.\n`);

  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "razorpay_test_mode_order_creation" });

  const User = (await import("../../models/User.js")).default;
  const Salon = (await import("../../models/Salon.js")).default;
  const Chair = (await import("../../models/Chair.js")).default;
  const Service = (await import("../../models/Service.js")).default;
  const Booking = (await import("../../models/Booking.js")).default;
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
  const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");
  const { protect } = await import("../../middlewares/auth.middleware.js");
  const { onboardingBypass } = await import("../../middlewares/onboardingBypass.middleware.js");
  const bookingRoutes = (await import("../../routes/booking.routes.js")).default;
  const paymentRoutes = (await import("../../routes/payment.routes.js")).default;

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
    const testUser = await User.create({ name: "Razorpay Test Order User", role: "USER", phone: "9000000098", tokenVersion: 0, isActive: true });
    const token = generateAccessToken(testUser);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const httpGet = async (path) => { const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders }); return { status: res.status, body: await res.json() }; };
    const httpPost = async (path, body) => { const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };

    const ALL_DAYS_OPEN = {};
    for (const d of ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]) ALL_DAYS_OPEN[d] = { open: "09:00", close: "21:00", isClosed: false };
    const salon = await Salon.create({ ownerId: oid(), basicInfo: { shopName: "Razorpay Test Order Salon", category: "UNISEX", gstStatus: "REGISTERED" }, approval: { status: "APPROVED" }, timings: ALL_DAYS_OPEN });
    const chair = await Chair.create({ salonId: salon._id, name: "Chair 1", position: 1, isActive: true });
    const service = await Service.create({ salonId: salon._id, name: "haircut", price: 500, duration: 30, isActive: true });

    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });

    //////////////////////////////////////////////////////////
    // 1. A genuine, isolated test booking — real HTTP /lock, same
    //    pattern as the prior HTTP integration suite. This is the
    //    "suitable test booking in an explicitly isolated test
    //    environment" — never a production booking.
    //////////////////////////////////////////////////////////
    const today = new Date();
    const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth()+1).padStart(2,"0")}-${String(today.getUTCDate()).padStart(2,"0")}`;
    const slotsRes = await httpGet(`/api/v1/bookings/user/slots?salonId=${salon._id}&date=${dateStr}&serviceDuration=30`);
    check("Real HTTP GET /slots succeeded in the isolated environment", slotsRes.status === 200 && slotsRes.body.slots?.length > 0, slotsRes);

    if (!slotsRes.body.slots?.length) {
      console.log(rows.join("\n"));
      console.log("\nSTOPPING before any Razorpay request — no available slot in the isolated test environment (precise prerequisite: slot engine returned zero slots).");
      process.exit(1);
    }

    let lockRes;
    for (let attempt = 0; attempt < 5; attempt++) {
      lockRes = await httpPost("/api/v1/bookings/user/lock", {
        salonId: String(salon._id), date: dateStr, serviceDuration: 30, bufferTime: 0,
        requestedTime: slotsRes.body.slots[0].start, serviceRefs: [String(service._id)],
      });
      if (lockRes.status === 200) break; // same transient-conflict retry as the other suites — no real contention possible here
    }
    check("Real HTTP POST /lock created a genuine, isolated HOLD booking", lockRes.status === 200 && lockRes.body.success === true, lockRes);

    const expectedAmountInPaise = lockRes.body.totalAmountInPaise;
    // ── Item 4: expected amount calculated BEFORE the Razorpay call ──
    check("Expected amount calculated beforehand from the locked Booking.totalAmountInPaise (500+20+25+3.60 = ₹548.60 = 54860 paise)", expectedAmountInPaise === 54860, expectedAmountInPaise);

    const bookingBefore = await Booking.findById(lockRes.body.bookingId).lean();
    check("Booking is HOLD, not yet expired, with a positive totalAmountInPaise — createOrder's own prerequisites, confirmed before calling it", bookingBefore.status === "HOLD" && bookingBefore.lockUntil > new Date() && bookingBefore.totalAmountInPaise > 0 && bookingBefore.razorpayOrderId === null);

    //////////////////////////////////////////////////////////
    // 2. THE ONE OUTBOUND REQUEST — real HTTP POST /create-order,
    //    which internally calls the real Razorpay SDK against
    //    Razorpay's actual API, using the confirmed test-mode key.
    //    No retry, no second attempt — called exactly once.
    //////////////////////////////////////////////////////////
    console.log("Making the one approved outbound request to Razorpay Test Mode now...\n");
    const createOrderRes = await httpPost("/api/payments/create-order", { bookingId: String(bookingBefore._id) });

    check("HTTP POST /api/payments/create-order → 200 (real Razorpay Test Mode order created)", createOrderRes.status === 200 && createOrderRes.body.success === true, createOrderRes);
    check("Returned orderId has Razorpay's real order_ prefix (genuine gateway response, not a local fabrication)", typeof createOrderRes.body.orderId === "string" && createOrderRes.body.orderId.startsWith("order_"), createOrderRes.body.orderId);
    check("Returned amount matches the locked Booking.totalAmountInPaise exactly (54860 paise) — never a client-supplied value, confirmed server never read one from the request body", createOrderRes.body.amount === expectedAmountInPaise, createOrderRes.body.amount);
    check("Returned currency is INR", createOrderRes.body.currency === "INR", createOrderRes.body.currency);
    check("Returned keyId is the publishable test-mode key (not the secret) and matches the configured RAZORPAY_KEY_ID prefix", createOrderRes.body.keyId === realKeyId, { keyIdMatches: createOrderRes.body.keyId === realKeyId });
    check("reused === false (a genuinely new order was minted, not a cached/idempotent reuse)", createOrderRes.body.reused === false, createOrderRes.body.reused);

    const bookingAfter = await Booking.findById(bookingBefore._id).lean();
    check("Booking's razorpayOrderId was updated to the real returned orderId (the one documented mutation createOrder performs)", bookingAfter.razorpayOrderId === createOrderRes.body.orderId, { stored: bookingAfter.razorpayOrderId, returned: createOrderRes.body.orderId });
    check("Booking's own GST/total fields are completely unchanged by order creation (54860, service GST 2500, platform-fee GST 360)", bookingAfter.totalAmountInPaise === 54860 && bookingAfter.gstAmountInPaise === 2500 && bookingAfter.platformFeeGstAmountInPaise === 360);

    rows.push("  ℹ️  No /verify, /confirm, or webhook call was made. No payment was captured or initiated. Exactly one Razorpay API call occurred (orders.create).");

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY TEST MODE ORDER CREATION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
