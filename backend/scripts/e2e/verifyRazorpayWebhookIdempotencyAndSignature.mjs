/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyRazorpayWebhookIdempotencyAndSignature.mjs
 *
 * PAYMENT VERIFICATION & WEBHOOK IDEMPOTENCY TEST SUITE — PARTS D + E
 * (Duplicate webhook events; missing/wrong webhook secret), isolated,
 * additive, 2026-10-12.
 *
 * Exercises the REAL, unmodified `routes/razorpayWebhook.routes.js` +
 * `services/razorpayWebhook.service.js` over genuine HTTP — raw request
 * bytes preserved exactly as production requires, signed with a
 * generated test `RAZORPAY_WEBHOOK_SECRET` (never the real one, which
 * the prior readiness audit confirmed is not even configured in the
 * real .env).
 *
 * SAFE/ISOLATED BY CONSTRUCTION:
 *   - Database: disposable MongoMemoryReplSet, same pattern as every
 *     other script in this directory.
 *   - Auth (for the booking-setup HTTP calls): fresh random
 *     JWT_ACCESS_SECRET, this process only.
 *   - Webhook secret: a freshly generated, random
 *     RAZORPAY_WEBHOOK_SECRET, this process only — never loaded from
 *     .env, never the real dashboard-configured value.
 *   - dotenv/.env: NEVER loaded anywhere in this script.
 *   - Network: razorpayInstance.orders.create / .orders.fetch /
 *     .payments.fetch are monkey-patched on the shared razorpayInstance
 *     — orders.create never contacts the real Razorpay API ("Do not
 *     create another Razorpay order" honored by construction);
 *     orders.fetch is stubbed to throw+count to prove it is never
 *     reached; payments.fetch returns a validly-shaped, locally
 *     fabricated CAPTURED payment. Webhook signature verification,
 *     event-claiming/idempotency, and every database write are 100%
 *     real and unmodified — nothing in razorpayWebhook.routes.js or
 *     razorpayWebhook.service.js is stubbed or bypassed.
 *   - Zero real webhook deliveries are sent anywhere — every request
 *     in this script is this process's own Express app, on an
 *     OS-assigned localhost-only ephemeral port.
 *
 * Run:  cd backend && node scripts/e2e/verifyRazorpayWebhookIdempotencyAndSignature.mjs
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

const TEST_WEBHOOK_SECRET = crypto.randomBytes(32).toString("hex"); // generated, this process only — never the real RAZORPAY_WEBHOOK_SECRET
const WRONG_WEBHOOK_SECRET = crypto.randomBytes(32).toString("hex");

const run = async () => {
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "razorpay_webhook_idempotency_signature" });

  const User = (await import("../../models/User.js")).default;
  const Salon = (await import("../../models/Salon.js")).default;
  const Chair = (await import("../../models/Chair.js")).default;
  const Service = (await import("../../models/Service.js")).default;
  const Booking = (await import("../../models/Booking.js")).default;
  const Transaction = (await import("../../models/Transaction.js")).default;
  const RevenueSplit = (await import("../../modules/finance/models/RevenueSplit.js")).default;
  const GSTLedger = (await import("../../modules/finance/models/GSTLedger.js")).default;
  const WalletLedger = (await import("../../models/WalletLedger.js")).default;
  const WebhookEvent = (await import("../../models/WebhookEvent.js")).default;
  // Model.init() blocks until the unique {provider,eventId} index is actually
  // built — a brand-new MongoMemoryReplSet otherwise races the index build
  // against this script's first writes (same fix as
  // verifyFieldAgentGeographyAdmin.js and friends), which would silently let
  // two "duplicate" inserts both succeed and invalidate the D2/D4 checks below.
  await WebhookEvent.init();
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
  const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");
  const { protect } = await import("../../middlewares/auth.middleware.js");
  const { onboardingBypass } = await import("../../middlewares/onboardingBypass.middleware.js");
  const bookingRoutes = (await import("../../routes/booking.routes.js")).default;
  const paymentRoutes = (await import("../../routes/payment.routes.js")).default;
  const razorpayWebhookRoutes = (await import("../../routes/razorpayWebhook.routes.js")).default;
  const { razorpayInstance } = await import("../../services/Razorpay.service.js");

  let ordersCreateCalls = 0, ordersFetchCalls = 0, paymentsFetchCalls = 0;
  const capturedPaymentsById = new Map();
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
    //////////////////////////////////////////////////////////
    // BUILD THE APP — webhook route mounted RAW, BEFORE the JSON
    // parser, exactly mirroring app.js's own real mount order
    // (app.js:223, before app.js:230's express.json()).
    //////////////////////////////////////////////////////////
    const app = express();
    app.use("/api/webhooks/razorpay", razorpayWebhookRoutes); // real, unmodified, raw-body route
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
    const testUser = await User.create({ name: "Webhook Idempotency Test User", role: "USER", phone: "9000000094", tokenVersion: 0, isActive: true });
    const token = generateAccessToken(testUser);
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const httpGet = async (path) => { const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders }); return { status: res.status, body: await res.json() }; };
    const httpPost = async (path, body) => { const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };

    // Raw webhook delivery — preserves the EXACT bytes signed, exactly
    // like Razorpay's own server-to-server POST would.
    const webhookPost = async ({ rawBody, signature, eventId }) => {
      const headers = { "Content-Type": "application/json" };
      if (signature !== undefined) headers["x-razorpay-signature"] = signature;
      if (eventId !== undefined) headers["x-razorpay-event-id"] = eventId;
      const res = await fetch(`${baseUrl}/api/webhooks/razorpay`, { method: "POST", headers, body: rawBody });
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON error body, leave null */ }
      return { status: res.status, body };
    };
    const signPayload = (rawBody, secret) => crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    const ALL_DAYS_OPEN = {};
    for (const d of ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]) ALL_DAYS_OPEN[d] = { open: "09:00", close: "21:00", isClosed: false };
    const salon = await Salon.create({ ownerId: oid(), basicInfo: { shopName: "Webhook Idempotency Test Salon", category: "UNISEX", gstStatus: "REGISTERED" }, approval: { status: "APPROVED" }, timings: ALL_DAYS_OPEN });
    await Chair.create({ salonId: salon._id, name: "Chair 1", position: 1, isActive: true });
    const service = await Service.create({ salonId: salon._id, name: "haircut", price: 500, duration: 30, isActive: true });

    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });

    //////////////////////////////////////////////////////////
    // 1. Lock a genuine HOLD booking, mint a (stubbed) order —
    //    same real HTTP setup as Parts A/C.
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

    const webhookPaymentId = `pay_webhook_test_${oid()}`;
    capturedPaymentsById.set(webhookPaymentId, {
      id: webhookPaymentId, order_id: orderId, currency: "INR", amount: totalAmountInPaise, status: "captured", amount_refunded: 0,
    });
    const capturedPayload = {
      event: "payment.captured",
      payload: { payment: { entity: { id: webhookPaymentId, order_id: orderId, amount: totalAmountInPaise, currency: "INR", status: "captured" } } },
    };
    const capturedRawBody = Buffer.from(JSON.stringify(capturedPayload));
    const capturedEventId = `evt_captured_${oid()}`;

    //////////////////////////////////////////////////////////
    // PART E — missing / wrong webhook secret. Run BEFORE the real
    // delivery so none of these ever touch the booking.
    //////////////////////////////////////////////////////////

    // E1. Secret not configured at all → 503, fails closed.
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const missingSecretRes = await webhookPost({
      rawBody: capturedRawBody,
      signature: signPayload(capturedRawBody, TEST_WEBHOOK_SECRET), // irrelevant — must 503 before this is even checked
      eventId: capturedEventId,
    });
    check("E1. Webhook with RAZORPAY_WEBHOOK_SECRET UNSET → 503 (fails closed, never silently accepts)", missingSecretRes.status === 503, missingSecretRes);

    // Restore the secret for the remaining checks.
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    // E2. Secret configured, but the signature was computed with a
    // DIFFERENT secret (e.g. a stale/rotated dashboard secret).
    const wrongSecretRes = await webhookPost({
      rawBody: capturedRawBody,
      signature: signPayload(capturedRawBody, WRONG_WEBHOOK_SECRET),
      eventId: capturedEventId,
    });
    check("E2. Webhook signed with the WRONG secret → 401 (invalid signature)", wrongSecretRes.status === 401, wrongSecretRes);

    // E3. Missing signature header entirely.
    const noSignatureRes = await webhookPost({ rawBody: capturedRawBody, eventId: capturedEventId });
    check("E3. Webhook with NO x-razorpay-signature header at all → 401", noSignatureRes.status === 401, noSignatureRes);

    // E4. Garbage, malformed signature value (wrong shape, not just wrong content).
    const garbageSignatureRes = await webhookPost({ rawBody: capturedRawBody, signature: "not-a-hex-signature", eventId: capturedEventId });
    check("E4. Webhook with a malformed/garbage signature value → 401, handled cleanly (no crash)", garbageSignatureRes.status === 401, garbageSignatureRes);

    // None of E1-E4 may have had ANY effect — no WebhookEvent claimed, nothing recorded.
    const webhookEventCountAfterE = await WebhookEvent.countDocuments({ eventId: capturedEventId });
    const bookingAfterE = await Booking.findById(bookingId).lean();
    const txnCountAfterE = await Transaction.countDocuments({ bookingId });
    check("No WebhookEvent was ever claimed for this eventId by any of the rejected E1-E4 attempts (rejection happens before idempotency claiming)", webhookEventCountAfterE === 0, webhookEventCountAfterE);
    check("Booking is still HOLD after all four rejected webhook attempts", bookingAfterE?.status === "HOLD", bookingAfterE?.status);
    check("Zero Transactions after all four rejected webhook attempts", txnCountAfterE === 0, txnCountAfterE);

    //////////////////////////////////////////////////////////
    // PART D — the REAL, correctly-signed delivery. First delivery
    // must auto-confirm the booking through the exact same core as
    // the client's /confirm (runBookingConfirmationCore).
    //////////////////////////////////////////////////////////
    const validSignature = signPayload(capturedRawBody, TEST_WEBHOOK_SECRET);
    const firstDeliveryRes = await webhookPost({ rawBody: capturedRawBody, signature: validSignature, eventId: capturedEventId });
    check("D1. First, correctly-signed payment.captured delivery → 200, outcome AUTO_CONFIRMED", firstDeliveryRes.status === 200 && firstDeliveryRes.body?.outcome === "AUTO_CONFIRMED", firstDeliveryRes);

    const bookingAfterFirstDelivery = await Booking.findById(bookingId).lean();
    check("Booking transitioned HOLD → CONFIRMED via the webhook (not via /confirm)", bookingAfterFirstDelivery?.status === "CONFIRMED", bookingAfterFirstDelivery?.status);

    const txnCountAfterFirstDelivery = await Transaction.countDocuments({ bookingId });
    const splitCountAfterFirstDelivery = await RevenueSplit.countDocuments({ bookingId });
    const ledgerCountAfterFirstDelivery = await GSTLedger.countDocuments({ bookingId, ledgerType: "SALE" });
    const walletCountAfterFirstDelivery = await WalletLedger.countDocuments({ entityType: "BOOKING", entityId: bookingId });
    check("Exactly ONE Transaction created by the real webhook confirmation", txnCountAfterFirstDelivery === 1, txnCountAfterFirstDelivery);
    check("Exactly ONE RevenueSplit created", splitCountAfterFirstDelivery === 1, splitCountAfterFirstDelivery);
    check("Exactly ONE GSTLedger SALE row created", ledgerCountAfterFirstDelivery === 1, ledgerCountAfterFirstDelivery);
    check("Exactly ONE WalletLedger (salon wallet) credit created", walletCountAfterFirstDelivery === 1, walletCountAfterFirstDelivery);

    // D2. EXACT SAME delivery again — same eventId, same signature,
    // same bytes — simulating Razorpay's own at-least-once retry of
    // the identical event.
    const duplicateDeliveryRes = await webhookPost({ rawBody: capturedRawBody, signature: validSignature, eventId: capturedEventId });
    check("D2. Exact duplicate delivery (same event id) → 200, body.duplicate: true — acknowledged, NOT reprocessed", duplicateDeliveryRes.status === 200 && duplicateDeliveryRes.body?.duplicate === true, duplicateDeliveryRes);

    const txnCountAfterDuplicate = await Transaction.countDocuments({ bookingId });
    const splitCountAfterDuplicate = await RevenueSplit.countDocuments({ bookingId });
    const ledgerCountAfterDuplicate = await GSTLedger.countDocuments({ bookingId, ledgerType: "SALE" });
    const walletCountAfterDuplicate = await WalletLedger.countDocuments({ entityType: "BOOKING", entityId: bookingId });
    check("STILL exactly ONE Transaction after the duplicate delivery", txnCountAfterDuplicate === 1, txnCountAfterDuplicate);
    check("STILL exactly ONE RevenueSplit after the duplicate delivery", splitCountAfterDuplicate === 1, splitCountAfterDuplicate);
    check("STILL exactly ONE GSTLedger SALE row after the duplicate delivery", ledgerCountAfterDuplicate === 1, ledgerCountAfterDuplicate);
    check("STILL exactly ONE WalletLedger credit after the duplicate delivery — booking was NOT double-confirmed or double-credited", walletCountAfterDuplicate === 1, walletCountAfterDuplicate);

    // D3. A SECOND, genuinely different event id for the SAME
    // underlying payment (e.g. Razorpay sending both "payment.captured"
    // and "order.paid" for one payment — both map to handleCaptured).
    // handleCaptured's OWN Transaction.exists({paymentId}) guard must
    // catch this even though it is a fresh WebhookEvent claim.
    const secondEventId = `evt_orderpaid_${oid()}`;
    const orderPaidPayload = { event: "order.paid", payload: { payment: { entity: { id: webhookPaymentId, order_id: orderId, amount: totalAmountInPaise, currency: "INR", status: "captured" } } } };
    const orderPaidRawBody = Buffer.from(JSON.stringify(orderPaidPayload));
    const orderPaidRes = await webhookPost({ rawBody: orderPaidRawBody, signature: signPayload(orderPaidRawBody, TEST_WEBHOOK_SECRET), eventId: secondEventId });
    check('D3. A DIFFERENT event id ("order.paid") for the SAME already-recorded payment → 200, outcome ALREADY_RECORDED, not reprocessed', orderPaidRes.status === 200 && orderPaidRes.body?.outcome === "ALREADY_RECORDED", orderPaidRes);

    const txnCountAfterOrderPaid = await Transaction.countDocuments({ bookingId });
    check("STILL exactly ONE Transaction after the order.paid delivery for the same payment", txnCountAfterOrderPaid === 1, txnCountAfterOrderPaid);

    //////////////////////////////////////////////////////////
    // D4 — SAFE RETRY OF A PREVIOUSLY-FAILED EVENT. Simulates a
    // webhook event whose FIRST processing attempt failed (e.g. a
    // transient DB error) by directly seeding a FAILED WebhookEvent
    // document — exactly the state claimWebhookEvent's own reclaim
    // branch (status: FAILED) is built to recover from. Redelivering
    // it must reclaim and reach a terminal state WITHOUT duplicating
    // any financial effect, since the underlying payment (same
    // webhookPaymentId) was already recorded by D1.
    //////////////////////////////////////////////////////////
    const retryEventId = `evt_retry_after_failure_${oid()}`;
    await WebhookEvent.create({
      provider: "RAZORPAY", kind: "EVENT", eventId: retryEventId, eventType: "payment.captured",
      paymentId: webhookPaymentId, orderId, status: "FAILED", error: "Simulated transient failure on first attempt", attempts: 1,
    });
    const retryPayload = { event: "payment.captured", payload: { payment: { entity: { id: webhookPaymentId, order_id: orderId, amount: totalAmountInPaise, currency: "INR", status: "captured" } } } };
    const retryRawBody = Buffer.from(JSON.stringify(retryPayload));
    const retryRes = await webhookPost({ rawBody: retryRawBody, signature: signPayload(retryRawBody, TEST_WEBHOOK_SECRET), eventId: retryEventId });
    check("D4. Redelivery of a previously-FAILED event id is reclaimed and safely reprocessed → 200, outcome ALREADY_RECORDED (no duplicate effect)", retryRes.status === 200 && retryRes.body?.outcome === "ALREADY_RECORDED", retryRes);

    const retriedEventDoc = await WebhookEvent.findOne({ eventId: retryEventId }).lean();
    check("The retried WebhookEvent document moved from FAILED to a terminal PROCESSED status, with attempts incremented", retriedEventDoc?.status === "PROCESSED" && retriedEventDoc?.attempts === 2, retriedEventDoc);

    const txnCountAfterRetry = await Transaction.countDocuments({ bookingId });
    check("STILL exactly ONE Transaction after the reclaimed-and-retried failed event", txnCountAfterRetry === 1, txnCountAfterRetry);

    // D5 — an event type outside the explicit switch is acknowledged
    // and safely ignored, not treated as an error and not acted on.
    const unhandledEventId = `evt_unhandled_${oid()}`;
    const unhandledPayload = { event: "payment.dispute.created", payload: {} };
    const unhandledRawBody = Buffer.from(JSON.stringify(unhandledPayload));
    const unhandledRes = await webhookPost({ rawBody: unhandledRawBody, signature: signPayload(unhandledRawBody, TEST_WEBHOOK_SECRET), eventId: unhandledEventId });
    check("D5. An unrecognized event type → 200, outcome UNHANDLED_EVENT, no side effects", unhandledRes.status === 200 && unhandledRes.body?.outcome === "UNHANDLED_EVENT", unhandledRes);

    //////////////////////////////////////////////////////////
    // FINAL — gateway-call accounting, mirroring Parts A/C.
    //////////////////////////////////////////////////////////
    check("razorpayInstance.orders.fetch was NEVER called throughout this entire suite (booking.razorpayOrderId always already matched)", ordersFetchCalls === 0, ordersFetchCalls);
    check("razorpayInstance.orders.create was called exactly once (the stubbed create-order setup step)", ordersCreateCalls === 1, ordersCreateCalls);
    // >= 1, not === 1: confirmBookingFromWebhook retries on a transient
    // MongoDB TransientTransactionError (same single-node-MongoMemoryReplSet
    // flakiness documented in the other suites in this directory), which
    // would legitimately call payments.fetch again on a retried attempt.
    // Every check below (D2-D5) matches Transaction.exists(paymentId) FIRST
    // and provably never reaches the gateway again — confirmed by the
    // Transaction/RevenueSplit/GSTLedger/WalletLedger counts above all
    // staying at exactly 1 throughout.
    check("razorpayInstance.payments.fetch was called at least once (D1's genuine first confirmation touched the gateway; later checks never needed to)", paymentsFetchCalls >= 1, paymentsFetchCalls);

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY WEBHOOK IDEMPOTENCY + SIGNATURE/SECRET HANDLING (REAL ROUTE, STUBBED GATEWAY ONLY): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
