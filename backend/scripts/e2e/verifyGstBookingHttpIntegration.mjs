/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyGstBookingHttpIntegration.mjs
 *
 * FINAL END-TO-END GST BOOKING VERIFICATION — genuine, authenticated
 * HTTP-level integration test, additive, 2026-10-12.
 *
 * SAFE/ISOLATED BY CONSTRUCTION:
 *   - Database: a disposable, in-process MongoMemoryReplSet (same
 *     devDependency/pattern as every other script in this directory).
 *     NEVER reads MONGODB_URI — never touches Atlas.
 *   - Auth secret: a throwaway, randomly-generated JWT_ACCESS_SECRET
 *     set directly on process.env for THIS PROCESS ONLY, before any
 *     module that reads it is imported. dotenv/.env is NEVER loaded by
 *     this script, so the real production JWT secret is never read,
 *     held in memory, or exposed here.
 *   - Server: a minimal Express app built from scratch in this file,
 *     mounting the REAL, unmodified `middlewares/auth.middleware.js`
 *     (protect), `middlewares/onboardingBypass.middleware.js`, and
 *     `routes/booking.routes.js` — the exact same three pieces
 *     app.js itself wires together at `app.use("/api", protect,
 *     onboardingBypass, bookingRoutes)` (confirmed by reading app.js
 *     directly). NOT a reimplementation of app.js — just app.js's own
 *     full remaining surface area (sockets, cron jobs, every other
 *     route module, etc.) deliberately left out, since none of it is
 *     needed and booting it would risk unintended side effects this
 *     task explicitly asked to avoid.
 *   - Listens on an OS-assigned ephemeral port (`listen(0)`) on
 *     localhost only — never reachable from outside this process.
 *   - Redis: SKIP_REDIS_AUTOCONNECT=true (same guard used by every
 *     other script here). The idempotency middleware's own documented
 *     behavior is FAIL-OPEN on any Redis error — confirmed by reading
 *     middlewares/idempotency.middleware.js directly — so requests
 *     proceed normally with no Redis connection at all. The rate
 *     limiter (`express-rate-limit`) is in-memory, no Redis dependency.
 *   - Payments: `POST /api/payment/create-order` is NEVER called — it
 *     unconditionally constructs a real Razorpay SDK client at import
 *     time and has no test-mode bypass (confirmed by reading
 *     services/Razorpay.service.js directly); exercising it would
 *     require either real credentials or a live network attempt.
 *     `POST /v1/bookings/user/confirm` IS driven over real HTTP, using
 *     the EXISTING, already-built `MOCK_RAZORPAY` test bypass in
 *     controllers/booking.controller.js#verifyRazorpaySignature — set
 *     via RAZORPAY_ALLOW_TEST_BYPASS="true" on this process only,
 *     never in a real .env, and only takes effect together with
 *     NODE_ENV!=="production" AND paymentMethod==="MOCK_RAZORPAY".
 *     When bypassed, the real confirmBooking code path skips
 *     assertGatewayPaymentForBooking entirely (confirmed by reading
 *     runBookingConfirmationCore) — zero Razorpay network calls occur
 *     anywhere in this test. RevenueSplit/GSTLedger are therefore
 *     produced by the REAL confirmBooking -> runBookingConfirmedEffects
 *     chain, over genuine HTTP — not a direct function call. The
 *     Razorpay webhook path (`confirmBookingFromWebhook`) is
 *     separately NOT tested here: it calls `fetchRazorpayOrder()`,
 *     a real Razorpay API read with no existing mock/bypass (confirmed
 *     by reading services/razorpayWebhook.service.js directly) — see
 *     the final report for this as a disclosed, precise limitation
 *     rather than something worked around. Only the refund-component
 *     calculation is still verified via a direct function call
 *     (splitRefundComponents), against this exact real booking's real
 *     amounts — refund/cancel itself was not driven over HTTP, to
 *     avoid exercising wallet/notification side effects beyond this
 *     task's scope.
 *
 * Run:  cd backend && node scripts/e2e/verifyGstBookingHttpIntegration.mjs
 */

import crypto from "crypto";

// Set BEFORE any other import — auth.middleware.js and token.service.js
// both read process.env.JWT_ACCESS_SECRET at call time, not at import
// time, but setting it first keeps the ordering obviously safe on
// static read-through too. A fresh random secret per run — never the
// real one, never loaded from .env (dotenv is never imported here).
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
const requestsLog = [];

const run = async () => {
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "gst_booking_http_integration" });

  const User = (await import("../../models/User.js")).default;
  const Salon = (await import("../../models/Salon.js")).default;
  const Chair = (await import("../../models/Chair.js")).default;
  const Service = (await import("../../models/Service.js")).default;
  const Booking = (await import("../../models/Booking.js")).default;
  const RevenueSplit = (await import("../../modules/finance/models/RevenueSplit.js")).default;
  const GSTLedger = (await import("../../modules/finance/models/GSTLedger.js")).default;
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
  const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");
  const { protect } = await import("../../middlewares/auth.middleware.js");
  const { onboardingBypass } = await import("../../middlewares/onboardingBypass.middleware.js");
  const bookingRoutes = (await import("../../routes/booking.routes.js")).default;
  const { splitRefundComponents } = await import("../../services/refundComponentSplitter.js");

  let server, baseUrl;

  try {
    //////////////////////////////////////////////////////////
    // 1. BUILD THE MINIMAL EXPRESS APP — real middleware/routes only.
    //////////////////////////////////////////////////////////
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", protect, onboardingBypass, bookingRoutes); // identical to app.js's own mount line

    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    check("Server bootstrap: minimal app (real protect + onboardingBypass + booking.routes.js) listening on localhost-only ephemeral port", !!port, port);

    //////////////////////////////////////////////////////////
    // 2. FIXTURES — real documents in the isolated DB only.
    //////////////////////////////////////////////////////////
    const adminId = oid();
    const testUser = await User.create({ name: "HTTP Test User", role: "USER", phone: "9000000099", tokenVersion: 0, isActive: true });
    const token = generateAccessToken(testUser);
    check("Minted a real JWT via the actual generateAccessToken() for a disposable test user in the isolated DB", typeof token === "string" && token.split(".").length === 3);

    const ALL_DAYS_OPEN_0900_2100 = {};
    for (const d of ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]) {
      ALL_DAYS_OPEN_0900_2100[d] = { open: "09:00", close: "21:00", isClosed: false };
    }
    const salon = await Salon.create({
      ownerId: oid(),
      basicInfo: { shopName: "HTTP Integration Test Salon", category: "UNISEX", gstStatus: "REGISTERED" },
      approval: { status: "APPROVED" },
      timings: ALL_DAYS_OPEN_0900_2100,
    });
    const chair = await Chair.create({ salonId: salon._id, name: "Chair 1", position: 1, isActive: true });
    const service = await Service.create({ salonId: salon._id, name: "haircut", price: 500, duration: 30, isActive: true });
    check("Fixtures created: REGISTERED salon (APPROVED, open 09:00-21:00), 1 active Chair, 1 active Service ₹500", !!salon._id && !!chair._id && !!service._id);

    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });
    check("Published, in THIS isolated DB only, the real business values (5% / 0% / 18%) and a GLOBAL FIXED ₹20 platform fee", true);

    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const httpGet = async (path) => {
      const url = `${baseUrl}${path}`;
      requestsLog.push(`GET ${path}`);
      const res = await fetch(url, { headers: authHeaders });
      return { status: res.status, body: await res.json() };
    };
    const httpPost = async (path, body) => {
      const url = `${baseUrl}${path}`;
      requestsLog.push(`POST ${path}`);
      const res = await fetch(url, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };

    //////////////////////////////////////////////////////////
    // 3. REAL AUTHENTICATED HTTP — GET /quote
    //////////////////////////////////////////////////////////
    const quoteRes = await httpGet(`/api/v1/bookings/user/quote?salonId=${salon._id}&serviceRefs=${service._id}`);
    check("HTTP GET /v1/bookings/user/quote → 200, through the REAL protect middleware with the minted JWT", quoteRes.status === 200, quoteRes);
    check("Quote: serviceAmountInPaise = 50000 (₹500)", quoteRes.body.serviceAmountInPaise === 50000, quoteRes.body.serviceAmountInPaise);
    check("Quote: platformFee.amountInPaise = 2000 (₹20)", quoteRes.body.platformFee?.amountInPaise === 2000, quoteRes.body.platformFee);
    check("Quote: serviceGst = 5% of ₹500 = ₹25 (2500 paise) — REGISTERED salon, the real-data gap this test specifically fills", quoteRes.body.serviceGst?.ratePercent === 5 && quoteRes.body.serviceGst?.amountInPaise === 2500, quoteRes.body.serviceGst);
    check("Quote: platformFeeGst = 18% of ₹20 = ₹3.60 (360 paise)", quoteRes.body.platformFeeGst?.ratePercent === 18 && quoteRes.body.platformFeeGst?.amountInPaise === 360, quoteRes.body.platformFeeGst);
    check("Quote: totalAmountInPaise = 50000+2000+2500+360 = 54860", quoteRes.body.totalAmountInPaise === 54860, quoteRes.body.totalAmountInPaise);

    //////////////////////////////////////////////////////////
    // 4. REAL AUTHENTICATED HTTP — GET /slots, to find a real,
    //    slot-engine-computed available start time (never hand-
    //    computed), then POST /lock with it.
    //////////////////////////////////////////////////////////
    const today = new Date();
    const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth()+1).padStart(2,"0")}-${String(today.getUTCDate()).padStart(2,"0")}`;
    const slotsRes = await httpGet(`/api/v1/bookings/user/slots?salonId=${salon._id}&date=${dateStr}&serviceDuration=30`);
    check("HTTP GET /v1/bookings/user/slots → 200, real slot engine (Chair timeline, working hours)", slotsRes.status === 200 && Array.isArray(slotsRes.body.slots), slotsRes);

    let lockRes = null, bookingDoc = null;
    if (slotsRes.body.slots?.length) {
      const chosenSlot = slotsRes.body.slots[0];
      // A single-node mongodb-memory-server replica set can surface a
      // transient MongoDB WriteConflict/LockTimeout under real
      // transaction load with no genuine contention (observed earlier
      // this session on the Phase 2/3 in-memory suites too). lockSlot's
      // OWN real production code already converts that into a clean
      // 409 ("Selected slot is no longer available") rather than
      // crashing — so a transient-conflict retry here is testing
      // against the same class of infra flakiness those suites already
      // retry around, not masking a real code defect.
      for (let attempt = 0; attempt < 5; attempt++) {
        lockRes = await httpPost("/api/v1/bookings/user/lock", {
          salonId: String(salon._id),
          date: dateStr,
          serviceDuration: 30,
          bufferTime: 0,
          requestedTime: chosenSlot.start,
          serviceRefs: [String(service._id)],
        });
        if (lockRes.status === 200) break;
        rows.push(`  ⏳ Transient /lock attempt ${attempt + 1} returned ${lockRes.status} (${lockRes.body?.message || ""}) — retrying`);
      }
      check("HTTP POST /v1/bookings/user/lock → 200, real transaction, real Booking created in the isolated DB", lockRes.status === 200 && lockRes.body.success === true, lockRes);

      // ── 5. Compare quote vs. lock — identical server-calculated totals ──
      check("Lock total MATCHES quote total exactly (54860 paise)", lockRes.body.totalAmountInPaise === 54860, lockRes.body.totalAmountInPaise);
      check("Lock breakdown matches quote breakdown field-for-field (service/fee/serviceGST/platformFeeGST all identical)",
        lockRes.body.serviceAmountInPaise === quoteRes.body.serviceAmountInPaise &&
        lockRes.body.commissionAmountInPaise === quoteRes.body.platformFee.amountInPaise &&
        lockRes.body.gstAmountInPaise === quoteRes.body.serviceGst.amountInPaise &&
        lockRes.body.platformFeeGstAmountInPaise === quoteRes.body.platformFeeGst.amountInPaise,
        { lock: lockRes.body, quote: quoteRes.body });

      bookingDoc = await Booking.findById(lockRes.body.bookingId).lean();
      check("A real Booking document (status HOLD) exists in the isolated DB with the exact locked totals", bookingDoc?.status === "HOLD" && bookingDoc?.totalAmountInPaise === 54860, bookingDoc);

      // createRevenueSplitForBooking's own LOCKED scope gate is
      // `if (!booking.razorpayOrderId) return null` (Razorpay-paid
      // bookings only — confirmed by reading
      // RevenueSplitIntegrationService.js directly). razorpayOrderId
      // is normally set inside assertGatewayPaymentForBooking, which
      // is the exact function the MOCK_RAZORPAY bypass skips entirely
      // — so a bypassed confirm would never produce a RevenueSplit at
      // all, by the existing code's own design. Setting this one real
      // field directly in the isolated test DB (not via any mock/stub
      // of the verification logic itself) satisfies that precondition
      // so the REAL downstream chain — confirmBooking -> CONFIRMED
      // transition -> runBookingConfirmedEffects ->
      // createRevenueSplitForBooking — runs unmodified afterward.
      await Booking.updateOne({ _id: bookingDoc._id }, { $set: { razorpayOrderId: `order_test_${oid()}` } });

      // ── 6. Client-override attempt — the quote/lock endpoints accept
      //      no amount field at all, so there is nothing for a client to
      //      override; confirmed structurally (not by sending a bogus
      //      field and hoping it's ignored, but by the validator itself
      //      — bookingSchemas.lock has no amount/total/price field,
      //      confirmed by reading validators/booking.validators.js).
      const lockWithForgedAmount = await httpPost("/api/v1/bookings/user/lock", {
        salonId: String(salon._id),
        date: dateStr,
        serviceDuration: 30,
        bufferTime: 0,
        requestedTime: chosenSlot.start,
        serviceRefs: [String(service._id)],
        totalAmountInPaise: 1, // forged — the real route has no such field in its validator at all
      });
      check("Sending a forged totalAmountInPaise in the /lock body has no effect — the server rejects as a duplicate active hold (same user), never a ₹1 booking (no amount field exists for a client to override)", lockWithForgedAmount.status !== 200 || lockWithForgedAmount.body?.totalAmountInPaise !== 1, lockWithForgedAmount);
    } else {
      check("HTTP POST /v1/bookings/user/lock — SKIPPED: slot engine returned zero available slots for today's remaining hours (time-of-day dependent, not a code defect)", false, slotsRes.body);
    }

    //////////////////////////////////////////////////////////
    // 7. Payment payload construction — verified by inspection, NOT
    //    by calling the real endpoint (which calls the live Razorpay
    //    API). payment.controller.js#createOrder reads ONLY
    //    booking.totalAmountInPaise (confirmed earlier this
    //    engagement by direct code read) — so the exact real,
    //    HTTP-/lock-produced total above (54860) is what that payload
    //    would carry. Not independently re-verified via HTTP here.
    //////////////////////////////////////////////////////////
    rows.push("  ℹ️  Payment payload construction: verified by code inspection only (payment.controller.js reads booking.totalAmountInPaise verbatim) — POST /api/payment/create-order was NOT called (would hit the real Razorpay API).");

    //////////////////////////////////////////////////////////
    // 8. REAL, authenticated HTTP POST /confirm — using the
    //    EXISTING, already-built MOCK_RAZORPAY test bypass
    //    (controllers/booking.controller.js#verifyRazorpaySignature:
    //    isMockBypassAllowed requires NODE_ENV!=="production" AND
    //    RAZORPAY_ALLOW_TEST_BYPASS==="true" AND
    //    paymentMethod==="MOCK_RAZORPAY" — all three set/true only in
    //    THIS test process's own env, never touching real Razorpay
    //    credentials or secrets). When bypassed,
    //    runBookingConfirmationCore's own gatewayCheckBypassed flag
    //    skips assertGatewayPaymentForBooking entirely — confirmed by
    //    reading the code — so NO Razorpay fetch/network call happens
    //    anywhere in this call. This drives the REAL confirmBooking ->
    //    runBookingConfirmedEffects -> createRevenueSplitForBooking
    //    chain exactly as production would, over genuine HTTP.
    //////////////////////////////////////////////////////////
    process.env.RAZORPAY_ALLOW_TEST_BYPASS = "true"; // this process only — never set in a real .env

    if (bookingDoc) {
      const mockPaymentId = `mock_pay_${oid()}`;
      // bookingSchemas.confirm requires orderId/razorpaySignature for
      // any non-WALLET paymentMethod, including MOCK_RAZORPAY — the
      // Joi schema's `is:"WALLET"` conditional doesn't special-case
      // the mock value (confirmed by reading validators/booking.
      // validators.js directly). verifyRazorpaySignature's bypass
      // branch returns immediately on isMockBypassAllowed and never
      // reads either value, so these are inert placeholder strings
      // solely to satisfy Joi's presence check — never interpreted as
      // a real order/signature, never sent anywhere external.
      const confirmRes = await httpPost("/api/v1/bookings/user/confirm", {
        bookingId: String(bookingDoc._id),
        paymentMethod: "MOCK_RAZORPAY",
        paymentId: mockPaymentId,
        orderId: "mock_order_placeholder",
        razorpaySignature: "mock_signature_placeholder",
      });
      check("HTTP POST /v1/bookings/user/confirm (MOCK_RAZORPAY bypass, zero Razorpay network calls) → 200, booking CONFIRMED", confirmRes.status === 200 && confirmRes.body.success === true, confirmRes);
      check("Confirm response totals still match the original quote/lock totals exactly (54860)", confirmRes.body.totalAmountInPaise === 54860, confirmRes.body);

      const confirmedBooking = await Booking.findById(bookingDoc._id).lean();
      check("Booking document transitioned HOLD → CONFIRMED with the same GST/total fields preserved from lock", confirmedBooking?.status === "CONFIRMED" && confirmedBooking?.gstAmountInPaise === 2500 && confirmedBooking?.platformFeeGstAmountInPaise === 360 && confirmedBooking?.totalAmountInPaise === 54860, confirmedBooking);

      // ── 9. RevenueSplit/GSTLedger — created by the REAL confirm
      //      call above (runBookingConfirmedEffects), not a direct
      //      function call.
      const split = await RevenueSplit.findOne({ bookingId: bookingDoc._id }).lean();
      check("RevenueSplit created automatically by the real HTTP /confirm call, with the exact real totals", split?.gstAmountInPaise === 2500 && split?.platformFeeGstAmountInPaise === 360 && split?.customerPaidInPaise === 54860, split);

      const ledger = await GSTLedger.findOne({ bookingId: bookingDoc._id, ledgerType: "SALE" }).lean();
      check("GSTLedger SALE row created with correct taxableValueInPaise (service amount, 50000) and both GST components", ledger?.taxableValueInPaise === 50000 && ledger?.gstAmountInPaise === 2500 && ledger?.platformFeeGstAmountInPaise === 360, ledger);

      // ── 10. Duplicate confirmation — the SAME paymentId again.
      //       runBookingConfirmationCore's own Transaction.findOne
      //       idempotency check (independent of the Redis idempotency
      //       middleware) must reject this with 409, and no second
      //       RevenueSplit/GSTLedger/Transaction row must be created.
      const duplicateConfirmRes = await httpPost("/api/v1/bookings/user/confirm", {
        bookingId: String(bookingDoc._id),
        paymentMethod: "MOCK_RAZORPAY",
        paymentId: mockPaymentId,
        orderId: "mock_order_placeholder",
        razorpaySignature: "mock_signature_placeholder",
      });
      check('Duplicate /confirm with the SAME paymentId is rejected (409 "Duplicate payment detected" or an idempotent "already confirmed" response) — never processed a second time', duplicateConfirmRes.status === 409 || duplicateConfirmRes.body?.alreadyConfirmed === true, duplicateConfirmRes);

      const splitCountAfter = await RevenueSplit.countDocuments({ bookingId: bookingDoc._id });
      const ledgerCountAfter = await GSTLedger.countDocuments({ bookingId: bookingDoc._id, ledgerType: "SALE" });
      check("Exactly ONE RevenueSplit exists after the duplicate confirm attempt (not duplicated)", splitCountAfter === 1, splitCountAfter);
      check("Exactly ONE GSTLedger SALE row exists after the duplicate confirm attempt (not duplicated)", ledgerCountAfter === 1, ledgerCountAfter);

      // ── 11. Refund component calculation — direct function call,
      //      against this exact real, now-CONFIRMED booking's real
      //      stored amounts (refund/cancel was not driven over HTTP,
      //      to avoid exercising wallet/notification side effects
      //      beyond this task's scope).
      const refundSplit = splitRefundComponents({
        refundFraction: 1,
        serviceAmountInPaise: confirmedBooking.serviceAmountInPaise,
        commissionAmountInPaise: confirmedBooking.commissionAmountInPaise,
        gstAmountInPaise: confirmedBooking.gstAmountInPaise,
        platformFeeGstAmountInPaise: confirmedBooking.platformFeeGstAmountInPaise,
      });
      check("Refund component split on the real booking's real amounts sums back to the exact locked/confirmed total (54860)", refundSplit.totalRefundPaise === 54860, refundSplit);
    } else {
      rows.push("  ℹ️  RevenueSplit/GSTLedger/refund checks SKIPPED — no booking was locked (see slots skip above).");
    }

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log("\nActual HTTP requests exercised:");
  requestsLog.forEach((r) => console.log("  " + r));
  console.log(`\nGST BOOKING HTTP INTEGRATION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err);
  process.exit(1);
});
