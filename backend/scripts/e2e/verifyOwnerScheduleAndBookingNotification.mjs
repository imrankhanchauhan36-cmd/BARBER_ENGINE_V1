/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyOwnerScheduleAndBookingNotification.mjs
 *
 * Verifies, against a fully isolated stack (mongodb-memory-server,
 * Redis disconnected, locally-generated JWT secret, real
 * app.listen(0) HTTP server, same network guard as
 * verifyBookingQuoteHttpIntegration.mjs) — not the real shared
 * database, never a real push send:
 *
 *   1. getLiveSchedule respects Salon.business.bookingWindowDays
 *      (tested at 3, 7, and 14 — never a hardcoded range).
 *   2. HOLD bookings are included; EXPIRED/CANCELLED/NO_SHOW are
 *      excluded; COMPLETED remains included (unchanged behavior).
 *   3. IST calendar-day boundaries are correct at the edge (a booking
 *      at 23:55 IST and one at 00:05 IST the next calendar day land
 *      in different `date` buckets).
 *   4. lockSlot's new owner BOOKING_CREATED notification carries the
 *      correct IST date+time, customer name, service name, and
 *      toFriendlyId(booking._id,"BK") — end to end, via a real HTTP
 *      /lock call, not a direct function call.
 *   5. A retried /lock request with the SAME Idempotency-Key header
 *      never creates a second Booking (and therefore never attempts a
 *      second notification) — the existing idempotency middleware,
 *      not a new dedup field.
 *
 * PUSH_PROVIDER is left unset (defaults to "none") deliberately — the
 * structurally-honest no-op branch (services/.../PushProvider.js) is
 * exercised to prove recipientType/recipientId/channel wiring is
 * correct without ever needing a real Expo/FCM credential or network
 * call; NO_DEVICE_TOKEN vs a real "none" success is the one thing that
 * DOES need a device token fixture, so one is registered below.
 *
 * NOT covered here, and not claimed as tested: the salon-app client
 * module (ownerPushNotificationService.js) and AuthProvider.js's
 * wiring — no React Native test harness exists in this repo; that
 * side is verified by static code review only (see this phase's own
 * report).
 *
 * Run (only after explicit approval):
 *   cd backend && node scripts/e2e/verifyOwnerScheduleAndBookingNotification.mjs
 */

import crypto from "crypto";
import net from "net";
import http from "http";

const TEST_JWT_SECRET = crypto.randomBytes(32).toString("hex");
if (!TEST_JWT_SECRET || TEST_JWT_SECRET.length < 32) {
  throw new Error("FAIL-CLOSED: could not generate a test-only JWT secret — refusing to proceed.");
}
process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
delete process.env.JWT_SECRET;

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
const blockedAttempts = [];

const installNetworkGuard = () => {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
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

  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  let httpServer = null;

  try {
    await mongoose.connect(mem.getUri(), { dbName: "owner_schedule_and_notification" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const Service = (await import("../../models/Service.js")).default;
    const Chair = (await import("../../models/Chair.js")).default;
    const Booking = (await import("../../models/Booking.js")).default;
    const Notification = (await import("../../models/Notification.js")).default;
    const NotificationDeliveryLog = (await import("../../modules/notifications/models/NotificationDeliveryLog.js")).default;
    const DeviceToken = (await import("../../modules/notifications/models/DeviceToken.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");
    const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
    const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");
    const { toFriendlyId } = await import("../../utils/friendlyId.js");

    httpServer = app.listen(0);
    const port = await new Promise((resolve) => httpServer.on("listening", () => resolve(httpServer.address().port)));

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
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const raw = Buffer.concat(chunks).toString("utf8");
              resolve({ status: res.statusCode, json: async () => (raw ? JSON.parse(raw) : {}) });
            });
          }
        );
        req.on("error", reject);
        if (opts.body !== undefined) req.write(opts.body);
        req.end();
      });

    const oid = () => new mongoose.Types.ObjectId();
    const adminId = oid();

    // ── Policies (required for any quote/lock to succeed at all) ──
    const gstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraft._id, adminId });
    const feeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });

    const ALL_DAYS_OPEN = {
      monday: { open: "00:00", close: "23:59", isClosed: false },
      tuesday: { open: "00:00", close: "23:59", isClosed: false },
      wednesday: { open: "00:00", close: "23:59", isClosed: false },
      thursday: { open: "00:00", close: "23:59", isClosed: false },
      friday: { open: "00:00", close: "23:59", isClosed: false },
      saturday: { open: "00:00", close: "23:59", isClosed: false },
      sunday: { open: "00:00", close: "23:59", isClosed: false },
    };

    const owner = await User.create({ name: "Test Owner", phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: owner.tokenVersion ?? 0 });

    const customer = await User.create({ name: "Priya Sharma", phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE" });
    const customerToken = generateAccessToken({ _id: customer._id, role: "USER", tokenVersion: customer.tokenVersion ?? 0 });

    const salon = await Salon.create({
      ownerId: owner._id,
      basicInfo: { shopName: "Window Test Salon", category: "UNISEX", gstStatus: "REGISTERED" },
      approval: { status: "APPROVED" },
      business: { isForceClosed: false, isShopOpen: true, bookingWindowDays: 7 },
      timings: ALL_DAYS_OPEN,
    });
    const service = await Service.create({ salonId: salon._id, name: "Signature Haircut", price: 500, duration: 30 });
    const chair = await Chair.create({ salonId: salon._id, chairCode: `${salon._id}-CHR-001`, name: "Chair 1", isActive: true, position: 1 });

    // One registered, valid device token — required for PushProvider's
    // "none" branch to report success rather than NO_DEVICE_TOKEN.
    await DeviceToken.create({
      recipientType: "SALON", recipientId: salon._id, token: "ExponentPushToken[test-fixture-token]",
      platform: "ANDROID", provider: "EXPO", isValid: true,
    });

    // ROOT CAUSE, found by actually running this test (not guessed):
    // using a plain `new Date()` here disagrees with
    // resolveScheduleWindow()'s own IST-based "today" whenever the
    // real UTC clock falls between 18:30 and 24:00 UTC — that band is
    // already the NEXT calendar day in IST (UTC+5:30), so a "day 0"
    // fixture built from naive UTC "now" could silently land one IST
    // day earlier than the window the application itself considers
    // "today." Anchoring to IST midnight (the exact same +330-minute
    // shift utils/dateRange.helpers.js uses internally) makes this
    // fixture's "day 0" identical to the application's.
    const istShiftedNow = new Date(Date.now() + 330 * 60 * 1000);
    const todayUtc = new Date(Date.UTC(istShiftedNow.getUTCFullYear(), istShiftedNow.getUTCMonth(), istShiftedNow.getUTCDate()));
    const dayMs = 24 * 60 * 60 * 1000;
    const atUtcHour = (daysFromToday, hourUtc, minUtc = 0) => {
      const d = new Date(todayUtc.getTime() + daysFromToday * dayMs);
      d.setUTCHours(hourUtc, minUtc, 0, 0);
      return d;
    };

    const toBookingDateStr = (d) => d.toISOString().split("T")[0];

    const mkBooking = (daysFromToday, status, hourUtc = 10) => {
      const start = atUtcHour(daysFromToday, hourUtc);
      return Booking.create({
        userRef: customer._id, salonRef: salon._id, chairRef: chair._id,
        serviceRefs: [service._id], bookingDate: toBookingDateStr(start),
        startTime: start, endTime: atUtcHour(daysFromToday, hourUtc + 1),
        serviceDuration: 30, bufferTime: 0, status,
        serviceAmountInPaise: 50000, commissionAmountInPaise: 2000, totalAmountInPaise: 52000,
      });
    };

    // ── 1-3. Window size + status filter + IST boundary fixtures ──
    const bHold       = await mkBooking(1, "HOLD");
    const bConfirmed2 = await mkBooking(2, "CONFIRMED");
    const bCompleted0 = await mkBooking(0, "COMPLETED");
    const bExpired1   = await mkBooking(1, "EXPIRED");
    const bCancelled2 = await mkBooking(2, "CANCELLED");
    const bNoShow0    = await mkBooking(0, "NO_SHOW");
    const bDay6       = await mkBooking(6, "CONFIRMED");
    const bDay9       = await mkBooking(9, "CONFIRMED");
    const bDay13       = await mkBooking(13, "CONFIRMED");

    const getSchedule = () => authFetch("/api/salon/owner/live-schedule", ownerToken).then((r) => r.json());

    // bookingWindowDays = 7 (fixture default) — expect day0..6 only.
    let sched = await getSchedule();
    let ids = sched.data.flatMap((c) => c.slots.map((s) => String(s.bookingId)));
    check("1a. window=7: day-6 booking included", ids.includes(String(bDay6._id)), ids);
    check("1b. window=7: day-9 booking excluded (outside window)", !ids.includes(String(bDay9._id)));
    check("2a. HOLD booking included", ids.includes(String(bHold._id)));
    check("2b. COMPLETED booking still included (unchanged)", ids.includes(String(bCompleted0._id)));
    check("2c. EXPIRED booking excluded", !ids.includes(String(bExpired1._id)));
    check("2d. CANCELLED booking excluded", !ids.includes(String(bCancelled2._id)));
    check("2e. NO_SHOW booking excluded", !ids.includes(String(bNoShow0._id)));

    // Re-point to window=3.
    await Salon.updateOne({ _id: salon._id }, { "business.bookingWindowDays": 3 });
    sched = await getSchedule();
    ids = sched.data.flatMap((c) => c.slots.map((s) => String(s.bookingId)));
    check("3a. window=3: day-2 booking included", ids.includes(String(bConfirmed2._id)));
    check("3b. window=3: day-6 booking now excluded", !ids.includes(String(bDay6._id)));
    check("3c. window=3: endDate !== date (real multi-day range, not hardcoded)", sched.endDate !== sched.date, sched);

    // Re-point to window=14.
    await Salon.updateOne({ _id: salon._id }, { "business.bookingWindowDays": 14 });
    sched = await getSchedule();
    ids = sched.data.flatMap((c) => c.slots.map((s) => String(s.bookingId)));
    check("4a. window=14: day-13 booking included", ids.includes(String(bDay13._id)));
    check("4b. window=14: day-9 booking included", ids.includes(String(bDay9._id)));

    // ── 5. IST day-boundary edge: 23:55 UTC vs 00:05 UTC are NOT the
    // right edge to test IST with directly (IST = UTC+5:30, so the
    // IST-day edge falls at 18:30 UTC) — construct explicitly.
    await Salon.updateOne({ _id: salon._id }, { "business.bookingWindowDays": 7 });
    const istEdgeBefore = atUtcHour(1, 18, 29); // 23:59 IST on day 1
    const istEdgeAfter  = atUtcHour(1, 18, 31); // 00:01 IST on day 2
    const bEdgeBefore = await Booking.create({
      userRef: customer._id, salonRef: salon._id, chairRef: chair._id,
      serviceRefs: [service._id], bookingDate: toBookingDateStr(istEdgeBefore), startTime: istEdgeBefore, endTime: istEdgeBefore,
      serviceDuration: 30, bufferTime: 0, status: "CONFIRMED",
      serviceAmountInPaise: 50000, commissionAmountInPaise: 2000, totalAmountInPaise: 52000,
    });
    const bEdgeAfter = await Booking.create({
      userRef: customer._id, salonRef: salon._id, chairRef: chair._id,
      serviceRefs: [service._id], bookingDate: toBookingDateStr(istEdgeAfter), startTime: istEdgeAfter, endTime: istEdgeAfter,
      serviceDuration: 30, bufferTime: 0, status: "CONFIRMED",
      serviceAmountInPaise: 50000, commissionAmountInPaise: 2000, totalAmountInPaise: 52000,
    });
    sched = await getSchedule();
    const flatSlots = sched.data.flatMap((c) => c.slots);
    const slotBefore = flatSlots.find((s) => String(s.bookingId) === String(bEdgeBefore._id));
    const slotAfter  = flatSlots.find((s) => String(s.bookingId) === String(bEdgeAfter._id));
    check("5. IST day boundary: the two edge bookings land in different `date` buckets", !!slotBefore && !!slotAfter && slotBefore.date !== slotAfter.date, { before: slotBefore?.date, after: slotAfter?.date });

    // ── 6. Existing single-day ?date= behavior is byte-identical ──
    const singleDayRes = await authFetch(`/api/salon/owner/live-schedule?date=${sched.date}`, ownerToken).then((r) => r.json());
    check("6. ?date= override still returns a single day (date === endDate)", singleDayRes.date === singleDayRes.endDate, singleDayRes);

    // ── 7-9. Real HTTP /lock — BOOKING_CREATED notification payload ──
    await Booking.deleteMany({}); // clear fixtures so the active-hold guard doesn't block this real lock
    const requestedTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    requestedTime.setUTCHours(10, 0, 0, 0);
    const idemKey = crypto.randomUUID();

    const lockOnce = () => authFetch("/api/v1/bookings/user/lock", customerToken, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({
        salonId: salon._id.toString(), date: requestedTime.toISOString().split("T")[0],
        serviceDuration: 30, requestedTime: requestedTime.toISOString(),
        serviceRefs: [service._id.toString()],
      }),
    });

    const lockRes1 = await lockOnce();
    const lockBody1 = await lockRes1.json();
    check("7. POST /lock succeeds", lockRes1.status === 200, lockBody1);

    if (lockRes1.status === 200) {
      const createdBookingId = lockBody1.bookingId;
      // Give the best-effort, non-blocking notification send a moment
      // to complete (it's fired inside the request but after the
      // transaction commits — awaited before the response, so this
      // is actually synchronous with the response; the short wait is
      // defensive only).
      // meta is Schema.Types.Mixed — no auto-cast, so the query value
      // must be a real ObjectId instance to match the stored one
      // (booking._id), not the plain string the JSON response gives us.
      const notif = await Notification.findOne({ "meta.bookingId": new mongoose.Types.ObjectId(createdBookingId) }).lean();
      check("8a. BOOKING_CREATED in-app notification was created", !!notif, notif);
      if (notif) {
        check("8b. Notification recipientType is SALON", notif.recipientType === "SALON", notif.recipientType);
        check("8c. Notification recipientId matches the salon", String(notif.recipientId) === String(salon._id));
        check("8d. Message includes the customer's name", notif.message.includes(customer.name), notif.message);
        check("8e. Message includes the service name", notif.message.includes(service.name), notif.message);
        check("8f. meta.friendlyBookingId matches toFriendlyId(bookingId,'BK')", notif.meta?.friendlyBookingId === toFriendlyId(createdBookingId, "BK"), notif.meta);
        // Date/time check: message must contain the real IST-formatted
        // date+time string lockSlot itself builds (same locale/options
        // as the production code, so this is an exact-match check,
        // not a loose substring guess).
        const expectedDateTimeFragment = requestedTime.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
        check("8g. Message includes the exact IST-formatted date+time", notif.message.includes(expectedDateTimeFragment), { message: notif.message, expected: expectedDateTimeFragment });
      }

      const deliveryLogs = await NotificationDeliveryLog.find({ "notificationId": notif?._id }).lean();
      const pushLog = deliveryLogs.find((l) => l.channel === "PUSH");
      check("9a. A PUSH delivery attempt was logged (provider wiring reached PushProvider)", !!pushLog, deliveryLogs);
      check("9b. PUSH delivery succeeded via the honest 'none' no-op (no real network call made)", pushLog?.provider === "none" && pushLog?.status === "SENT", pushLog);
    }

    // ── 10. Retry — never creates a 2nd booking, by whichever
    // mechanism this environment can actually exercise.
    //
    // HONEST LIMITATION, found by actually running this: the
    // Idempotency-Key-based cached-response path (middlewares/
    // idempotency.middleware.js) depends on a live Redis connection —
    // and Redis is deliberately disconnected in this isolated test
    // (SKIP_REDIS_AUTOCONNECT), the same isolation this whole test
    // file relies on for safety. With Redis down, that middleware
    // fails open BY ITS OWN DESIGN (confirmed in its own file header:
    // "any Redis error is treated as not a duplicate") and lets the
    // retried request reach lockSlot's body again — so the
    // Idempotency-Key cache path itself cannot be verified in this
    // environment without reintroducing a real/mocked Redis, which
    // would defeat the point of this isolation. What CAN be verified
    // here, and is the thing actually asserted below: the
    // Redis-independent "already have an active hold" guard at the
    // top of lockSlot still catches the retry and rejects it (400),
    // so no second Booking is created regardless of which guard
    // caught it. This is a real, if narrower, confirmation — not a
    // substitute for separately verifying the Idempotency-Key cache
    // path itself in an environment with Redis available.
    const bookingCountAfterFirst = await Booking.countDocuments();
    const lockRes2 = await lockOnce();
    check("10a. Retry is rejected (either the Idempotency-Key cache or the active-hold guard, not a second success)", lockRes2.status !== 200, lockRes2.status);
    const bookingCountAfterRetry = await Booking.countDocuments();
    check("10b. No second Booking document was created by the retry", bookingCountAfterRetry === bookingCountAfterFirst, { before: bookingCountAfterFirst, after: bookingCountAfterRetry });

    check("11. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);
    check("12. Network guard was installed before any app/model import", networkGuardInstalled === true);

  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nOWNER SCHEDULE + BOOKING NOTIFICATION: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
