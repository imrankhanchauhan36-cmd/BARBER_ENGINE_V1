/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyBookingQuoteHttpIntegration.mjs
 *
 * PHASE 3 — real HTTP-level integration for GET /v1/bookings/user/quote
 * and POST /v1/bookings/user/lock, against a fully isolated stack:
 * a disposable mongodb-memory-server replica set, a real Express
 * server bound to an OS-assigned local port (app.listen(0)), a
 * locally-generated test-only JWT secret, and Redis left intentionally
 * disconnected. This is the full-HTTP follow-up Phase 2
 * (verifyBookingPricingQuoteFoundation.mjs) explicitly deferred as
 * "Phase 3 work" — it does not duplicate Phase 2's function-level
 * checks, it drives the actual routes end-to-end.
 *
 * ISOLATION, IN ORDER (each step gates the next — read before editing):
 *
 * 1. JWT_ACCESS_SECRET is overwritten with a freshly generated,
 *    random, in-process-only value BEFORE anything else runs. Neither
 *    jwt.sign() nor jwt.verify() read this at import time (both are
 *    plain function bodies that read process.env.JWT_ACCESS_SECRET
 *    only when called) — overwriting it here, before any model or
 *    route file is imported, guarantees every token this script mints
 *    and every token the real `protect` middleware verifies use the
 *    exact same test-only value, never whatever may be configured in
 *    the real environment. FAILS CLOSED: if the generated value is
 *    somehow empty/falsy, this throws immediately rather than
 *    silently proceeding with an unset secret.
 *
 * 2. SKIP_REDIS_AUTOCONNECT = "true" is set before any import — same
 *    guard already ported into config/redis.js and already proven
 *    (Phase 2's own run) to prevent the eager connect that module
 *    performs at load time. Also unsets REDIS_URL defensively: even
 *    if some future code path were to call redis.connect() again
 *    directly, there would be no real URL left in this process for it
 *    to target.
 *
 * 3. MongoMemoryReplSet is created and mongoose is connected to ITS
 *    URI FIRST — before app.js or any model/service file is imported.
 *    config/db.js#connectDB (the only function that ever reads
 *    MONGODB_URI) is never imported or called anywhere in this file's
 *    chain — same as Phase 2. Defensively, MONGODB_URI is deleted from
 *    process.env immediately after connecting: if anything unexpected
 *    ever did call connectDB(), it would throw ("MONGODB_URI not
 *    defined"), not silently reach the real database.
 *
 * 4. A NETWORK GUARD is installed immediately after the memory
 *    replica set is created (never before — MongoMemoryReplSet.create()
 *    itself may need one real network access on a machine without the
 *    MongoDB binary already cached, which this script must not break)
 *    and stays installed for the rest of the run. It monkey-patches
 *    net.Socket.prototype.connect — the primitive every Node network
 *    client (http, https, the MongoDB driver, redis) ultimately calls
 *    through — and synchronously throws for any destination that is
 *    not 127.0.0.1/::1/localhost. This is a real PREVENTION mechanism,
 *    not a log-based inference: per the Phase 3 review, "no Redis/Atlas
 *    log lines appeared" is not treated as proof of isolation anywhere
 *    in this file.
 *
 * 5. Only after 1-4 are in place does this script import app.js, the
 *    Mongoose models, and the token/policy services it needs.
 *
 * TEARDOWN: wrapped in try/finally — the HTTP server is closed, the
 * Mongoose connection is disconnected, and the memory replica set is
 * stopped on every exit path, including a thrown assertion failure.
 *
 * KNOWN GAP, STATED HONESTLY (see the Phase 3 report this script
 * accompanies): the POST /lock checks in this file are the first time
 * anything in this codebase drives a real, full HTTP lockSlot call
 * through isSalonReadyForBooking() + the real chair/working-hours/
 * slot-matching path (utils/salonReady.guard.js + services/
 * slotEngine.service.js) — neither existing real-DB script
 * (verifySalonGstEngine.js, verifyGlobalPlatformFeeLaunch.js) does
 * this; both construct Booking documents directly instead. The fixture
 * salon/chair/working-hours shape below is built from direct reads of
 * isSalonReadyForBooking()'s own requirements, but — unlike every
 * check in this file inherited from an already-proven pattern — it has
 * never actually been executed. Do not treat a pass here as equivalent
 * in confidence to the rest of this file until it has actually been run.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyBookingQuoteHttpIntegration.mjs
 */

import crypto from "crypto";
import net from "net";
import http from "http";

// ─── STEP 1 — test-only JWT secret, before any other import ────────
const TEST_JWT_SECRET = crypto.randomBytes(32).toString("hex");
if (!TEST_JWT_SECRET || TEST_JWT_SECRET.length < 32) {
  throw new Error("FAIL-CLOSED: could not generate a test-only JWT secret — refusing to proceed.");
}
process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
// JWT_SECRET is auth.middleware.js's own fallback if JWT_ACCESS_SECRET
// were ever unset — clearing it too so there is no second, possibly
// real, value for verification to fall back to.
delete process.env.JWT_SECRET;

// ─── STEP 2 — Redis: opt out of the eager auto-connect, and remove
// the real URL as a defensive second layer ──────────────────────────
process.env.SKIP_REDIS_AUTOCONNECT = "true";
delete process.env.REDIS_URL;

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);
let networkGuardInstalled = false;
let blockedAttempts = [];

const installNetworkGuard = () => {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // net.Socket#connect supports several call shapes; normalize to
    // find the intended host, defaulting to "allow" only when the
    // destination is unambiguously loopback.
    let host = null;
    if (typeof args[0] === "object" && args[0] !== null) {
      host = args[0].host ?? args[0].address ?? null;
    } else if (typeof args[1] === "string") {
      host = args[1];
    }
    const isLoopback = host === null || LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
    if (!isLoopback) {
      blockedAttempts.push(host);
      throw new Error(`NETWORK GUARD: blocked outbound connection attempt to non-loopback host "${host}"`);
    }
    return originalConnect.apply(this, args);
  };
  networkGuardInstalled = true;
};

const run = async () => {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const mongoose = (await import("mongoose")).default;

  // STEP 3 — connect to the disposable replica set FIRST, before any
  // app/model import. Network guard installed right after this call
  // succeeds, deliberately — MongoMemoryReplSet.create() itself may
  // need one real network access on a machine without the MongoDB
  // binary already cached.
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });

  let httpServer = null;

  try {
    // Connecting and everything after it is inside this try block
    // (not before) so that ANY failure from this point on — including
    // a failed mongoose.connect() against the just-created replica
    // set — still reaches the finally block below and stops `mem`.
    await mongoose.connect(mem.getUri(), { dbName: "booking_quote_http_integration" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    // STEP 5 — only now import app.js and everything it needs.
    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const Service = (await import("../../models/Service.js")).default;
    const Chair = (await import("../../models/Chair.js")).default;
    const Booking = (await import("../../models/Booking.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");
    const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
    const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");

    httpServer = app.listen(0);
    const port = await new Promise((resolve) => httpServer.on("listening", () => resolve(httpServer.address().port)));

    const oid = () => new mongoose.Types.ObjectId();
    const adminId = oid();

    // Uses Node's core http.request() — not the global fetch() —
    // specifically because fetch() (Undici) was empirically confirmed
    // during review to bypass the net.Socket.prototype.connect guard
    // below entirely, while http.request() was empirically confirmed
    // to go through it. Every call here targets host:"127.0.0.1" and
    // this script's own bound `port` explicitly (never a URL string
    // that could be misparsed into a different host) — nothing else
    // this script generates can reach any other address. Preserves
    // authFetch(path, token, opts)'s existing interface and the
    // {status, json()} shape every call site already expects.
    const authFetch = (path, token, opts = {}) =>
      new Promise((resolve, reject) => {
        const headers = {
          "Content-Type": "application/json",
          ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers || {}),
        };
        const req = http.request(
          { host: "127.0.0.1", port, path, method: opts.method || "GET", headers },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              const raw = Buffer.concat(chunks).toString("utf8");
              resolve({
                status: res.statusCode,
                json: async () => (raw ? JSON.parse(raw) : {}),
              });
            });
          }
        );
        req.on("error", reject);
        if (opts.body !== undefined) req.write(opts.body);
        req.end();
      });

    // ── Fixtures ────────────────────────────────────────────────
    const user = await User.create({
      name: "HTTP_INTEGRATION_USER",
      phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
      role: "USER",
      accountStatus: "ACTIVE",
    });
    const userToken = generateAccessToken({ _id: user._id, role: "USER", tokenVersion: user.tokenVersion ?? 0 });

    const OPEN_ALL_DAY = { open: "00:00", close: "23:59", isClosed: false };
    const ALL_DAYS_OPEN = {
      monday: OPEN_ALL_DAY, tuesday: OPEN_ALL_DAY, wednesday: OPEN_ALL_DAY, thursday: OPEN_ALL_DAY,
      friday: OPEN_ALL_DAY, saturday: OPEN_ALL_DAY, sunday: OPEN_ALL_DAY,
    };

    const salon = await Salon.create({
      ownerId: oid(),
      basicInfo: { shopName: "HTTP Integration Salon", category: "UNISEX", gstStatus: "REGISTERED" },
      approval: { status: "APPROVED" },
      business: { isForceClosed: false, isShopOpen: true },
      timings: ALL_DAYS_OPEN,
    });
    const service = await Service.create({ salonId: salon._id, name: "HTTP Integration Service", price: 500, duration: 30 });
    await Chair.create({ salonId: salon._id, chairCode: `${salon._id}-CHR-001`, name: "Chair 1", isActive: true, position: 1 });

    // Required policies — created directly via the service layer
    // (not HTTP) purely for setup speed, same convention Phase 1/2
    // already use for their own fixture policies.
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });
    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });

    const quotePath = `/api/v1/bookings/user/quote?salonId=${salon._id}&serviceRefs=${service._id}`;

    // ── Authenticated quote ──────────────────────────────────────
    const bookingCountBefore = await Booking.countDocuments();
    const quoteRes = await authFetch(quotePath, userToken);
    const quoteBody = await quoteRes.json();
    check("1. Authenticated GET /quote returns 200", quoteRes.status === 200, quoteRes.status);
    check("2. Quote response is success with a numeric totalAmountInPaise", quoteBody.success === true && Number.isFinite(quoteBody.totalAmountInPaise), quoteBody);
    const bookingCountAfterQuote = await Booking.countDocuments();
    check("3. No Booking document was created by the quote call", bookingCountAfterQuote === bookingCountBefore, { before: bookingCountBefore, after: bookingCountAfterQuote });

    // ── Missing / invalid authentication ─────────────────────────
    const noAuthRes = await authFetch(quotePath, null);
    check("4. GET /quote with no Authorization header returns 401", noAuthRes.status === 401, noAuthRes.status);

    const badTokenRes = await authFetch(quotePath, "not-a-real-token");
    check("5. GET /quote with a malformed token returns 401", badTokenRes.status === 401, badTokenRes.status);

    const otherSecretToken = (await import("jsonwebtoken")).default.sign(
      { id: user._id.toString(), role: "USER", tokenVersion: user.tokenVersion ?? 0 },
      "a-different-secret-this-process-never-set",
      { expiresIn: "15m" }
    );
    const wrongSecretRes = await authFetch(quotePath, otherSecretToken);
    check("6. GET /quote with a token signed by a different secret returns 401", wrongSecretRes.status === 401, wrongSecretRes.status);

    // ── Quote vs lock pricing consistency (HTTP layer) ───────────
    // KNOWN GAP — see file header: this is the first real HTTP-level
    // lockSlot exercise in this codebase's test history. Fixtures
    // above were built directly from utils/salonReady.guard.js's own
    // requirements, but never executed before this run.
    // slotEngine.service.js generates candidate slots every 5 minutes
    // (SLOT_INTERVAL) starting exactly at the fixture's opening time
    // (00:00, from ALL_DAYS_OPEN above) — requestedTime must land
    // exactly on one of those 5-minute boundaries, with zero seconds/
    // ms, or getSmartSlots() never produces a matching candidate.
    // Picked well inside the day (10:00 UTC) to stay unambiguous
    // regardless of IST-vs-UTC calendar-day parsing in getSmartSlots.
    const requestedTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    requestedTime.setUTCHours(10, 0, 0, 0);
    const lockRes = await authFetch(`/api/v1/bookings/user/lock`, userToken, {
      method: "POST",
      body: JSON.stringify({
        salonId: salon._id.toString(),
        date: requestedTime.toISOString().split("T")[0],
        serviceDuration: 30,
        requestedTime: requestedTime.toISOString(),
        serviceRefs: [service._id.toString()],
      }),
    });
    const lockBody = await lockRes.json();
    check("7. POST /lock returns 200 for a ready salon with matching fixtures", lockRes.status === 200, { status: lockRes.status, body: lockBody });
    if (lockRes.status === 200) {
      check("8. /lock's totalAmountInPaise matches /quote's totalAmountInPaise exactly", lockBody.totalAmountInPaise === quoteBody.totalAmountInPaise, { lock: lockBody.totalAmountInPaise, quote: quoteBody.totalAmountInPaise });
      check("9. /lock's serviceAmountInPaise matches /quote's serviceAmountInPaise exactly", lockBody.serviceAmountInPaise === quoteBody.serviceAmountInPaise, { lock: lockBody.serviceAmountInPaise, quote: quoteBody.serviceAmountInPaise });
    } else {
      rows.push("  ⚠️  Checks 8-9 skipped: /lock did not return 200, nothing to compare against the quote.");
    }

    // ── Fail-closed: missing platform-fee-GST policy ────────────
    // The GLOBAL platform fee published during fixture setup above is
    // never retired by anything in this test, so it is still PUBLISHED
    // here — no action needed to "keep" it published.
    const legacyGstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 7, unregisteredRatePercent: 1 }); // no platformFeeGstRatePercent
    await publishGstPolicy({ versionId: legacyGstDraft._id, adminId }); // retires the valid one published above

    const failClosedRes = await authFetch(quotePath, userToken);
    const failClosedBody = await failClosedRes.json();
    check("10. GET /quote returns 503 once the published GST policy lacks platformFeeGstRatePercent", failClosedRes.status === 503, failClosedRes.status);
    check("11. The 503 carries code PLATFORM_FEE_GST_NOT_CONFIGURED", failClosedBody.code === "PLATFORM_FEE_GST_NOT_CONFIGURED", failClosedBody);

    // ── Network guard sanity ─────────────────────────────────────
    check("12. Network guard was installed before any app/model import", networkGuardInstalled === true, networkGuardInstalled);
    check("13. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nBOOKING QUOTE HTTP INTEGRATION: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
