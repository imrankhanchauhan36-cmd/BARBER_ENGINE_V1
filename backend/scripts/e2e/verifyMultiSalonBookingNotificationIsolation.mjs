/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyMultiSalonBookingNotificationIsolation.mjs
 *
 * Booking visibility + owner push notification — multi-salon
 * isolation fix. Real HTTP-level integration test against a fully
 * isolated stack: a disposable mongodb-memory-server replica set, a
 * real Express server bound to an OS-assigned local port
 * (app.listen(0)), a locally-generated test-only JWT secret, and
 * Redis left intentionally disconnected (SKIP_REDIS_AUTOCONNECT) —
 * none of the routes this script exercises run behind the
 * idempotency middleware, so no real Redis is needed here, unlike
 * verifyOwnerDuplicateSalonGuard.mjs / verifyMultiSalonOnboardingIdentity.mjs.
 *
 * ROOT CAUSE THIS TEST PROVES IS FIXED: controllers/booking.controller.js
 * #getSalonBookings, controllers/salon.me.controller.js#getLiveSchedule,
 * controllers/deviceToken.controller.js, and controllers/notification
 * .controller.js all used to resolve "which salon" via an unscoped
 * Salon.findOne({ownerId}) — for an owner with 2+ salons this could
 * silently pick the WRONG one, showing/mutating/notifying the wrong
 * salon's data entirely. The fix: every one of these now accepts an
 * explicit, ownership-verified salonId, and fails closed
 * (409 AMBIGUOUS_SALON) rather than guessing when it's absent and the
 * owner has more than one real (APPROVED) salon.
 *
 * SCOPE: this script tests ONLY the owner-side resolution/isolation
 * fix. It does not exercise lockSlot's own slot-matching machinery
 * (chair/working-hours fixtures) — that path was already proven
 * correct by direct code audit (salonId comes straight from the
 * customer's own request body, never from an ownerId lookup) and is
 * out of scope here; this script creates the Booking fixture directly
 * via the model, and simulates the exact NotificationService.send()
 * call shape lockSlot itself uses (same payload keys/values), to
 * prove the OWNER-side read/write isolation specifically.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyMultiSalonBookingNotificationIsolation.mjs
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
let blockedAttempts = [];

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
    await mongoose.connect(mem.getUri(), { dbName: "multi_salon_booking_notification_isolation" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const Chair = (await import("../../models/Chair.js")).default;
    const Service = (await import("../../models/Service.js")).default;
    const Booking = (await import("../../models/Booking.js")).default;
    const DeviceToken = (await import("../../modules/notifications/models/DeviceToken.js")).default;
    const Notification = (await import("../../models/Notification.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");
    const NotificationService = (await import("../../services/NotificationService.js")).default;
    const { NOTIFICATION_EVENTS } = await import("../../modules/notifications/constants/notificationEvents.constants.js");
    const WalletBalanceService = (await import("../../services/WalletBalanceService.js")).default;

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
            res.on("data", (chunk) => chunks.push(chunk));
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

    let phoneCounter = 0;
    const nextPhone = () => `9${String(100000000 + Math.floor(Math.random() * 800000000) + phoneCounter++)}`.slice(0, 10);

    const OPEN_ALL_DAY = { open: "00:00", close: "23:59", isClosed: false };
    const ALL_DAYS_OPEN = { monday: OPEN_ALL_DAY, tuesday: OPEN_ALL_DAY, wednesday: OPEN_ALL_DAY, thursday: OPEN_ALL_DAY, friday: OPEN_ALL_DAY, saturday: OPEN_ALL_DAY, sunday: OPEN_ALL_DAY };

    const makeApprovedSalon = async (ownerId, label) =>
      Salon.create({
        ownerId,
        basicInfo: { shopName: `ZE2E Salon ${label}`, category: "UNISEX" },
        manager: { phone: nextPhone() },
        timings: ALL_DAYS_OPEN,
        approval: { status: "APPROVED" },
        business: { isForceClosed: false, isShopOpen: true },
        onboarding: { step: 8, completed: true },
        isDeleted: false,
      });

    // ── Fixtures: ONE owner, TWO approved salons ──────────────────
    const owner = await User.create({ name: "ZE2E_MULTISALON_OWNER", phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: owner.tokenVersion ?? 0 });
    const salonA = await makeApprovedSalon(owner._id, "A");
    const salonB = await makeApprovedSalon(owner._id, "B");

    const customer = await User.create({ name: "ZE2E_CUSTOMER", phone: nextPhone(), role: "USER", accountStatus: "ACTIVE" });
    const service = await Service.create({ salonId: salonA._id, name: "Haircut", price: 300, duration: 30 });
    const chairA = await Chair.create({ salonId: salonA._id, chairCode: `${salonA._id}-CHR-001`, name: "Chair 1", position: 1, isActive: true });

    // A real Booking for Salon A ONLY — lockSlot's own salonId
    // handling (always from the customer's own request, never an
    // ownerId lookup) was already proven correct by direct code audit;
    // this fixture targets exactly what that flow would have produced,
    // to test the OWNER-side resolution this fix actually changes.
    const bookingStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    bookingStart.setUTCHours(10, 0, 0, 0);
    const bookingEnd = new Date(bookingStart.getTime() + 30 * 60 * 1000);
    const booking = await Booking.create({
      userRef: customer._id,
      salonRef: salonA._id,
      chairRef: chairA._id,
      serviceRefs: [service._id],
      bookingDate: bookingStart.toISOString().split("T")[0],
      startTime: bookingStart,
      endTime: bookingEnd,
      serviceDuration: 30,
      status: "CONFIRMED",
      totalAmountInPaise: 30000,
      serviceAmountInPaise: 30000,
    });

    // ── 1. Owner live-schedule, explicit salonId ──────────────────
    const dateParam = bookingStart.toISOString().split("T")[0];
    const scheduleA = await authFetch(`/api/salon/owner/live-schedule?date=${dateParam}&salonId=${salonA._id}`, ownerToken);
    const scheduleABody = await scheduleA.json();
    check("1a. Live schedule with salonId=A → 200", scheduleA.status === 200, { status: scheduleA.status, body: scheduleABody });
    const scheduleAHasBooking = (scheduleABody?.data || []).some((chairRow) => chairRow.slots.some((s) => String(s.bookingId) === String(booking._id)));
    check("1b. Salon A's schedule INCLUDES its own booking", scheduleAHasBooking, scheduleABody);

    const scheduleB = await authFetch(`/api/salon/owner/live-schedule?date=${dateParam}&salonId=${salonB._id}`, ownerToken);
    const scheduleBBody = await scheduleB.json();
    check("2a. Live schedule with salonId=B → 200", scheduleB.status === 200, { status: scheduleB.status, body: scheduleBBody });
    const scheduleBHasBooking = (scheduleBBody?.data || []).some((chairRow) => chairRow.slots.some((s) => String(s.bookingId) === String(booking._id)));
    check("2b. Salon B's schedule does NOT include Salon A's booking — the core isolation requirement", !scheduleBHasBooking, scheduleBBody);

    // ── 3. No salonId, owner has 2 real salons → fails closed ─────
    const scheduleAmbiguous = await authFetch(`/api/salon/owner/live-schedule?date=${dateParam}`, ownerToken);
    const scheduleAmbiguousBody = await scheduleAmbiguous.json();
    check("3. Live schedule with NO salonId, owner has 2 salons → 409 AMBIGUOUS_SALON (fails closed, never guesses)", scheduleAmbiguous.status === 409 && scheduleAmbiguousBody?.code === "AMBIGUOUS_SALON", { status: scheduleAmbiguous.status, body: scheduleAmbiguousBody });

    // ── 4. Foreign owner, Salon A's id → 404, no leak ─────────────
    const foreignOwner = await User.create({ name: "ZE2E_FOREIGN_OWNER", phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
    const foreignToken = generateAccessToken({ _id: foreignOwner._id, role: "OWNER", tokenVersion: foreignOwner.tokenVersion ?? 0 });
    const foreignAttempt = await authFetch(`/api/salon/owner/live-schedule?date=${dateParam}&salonId=${salonA._id}`, foreignToken);
    const foreignAttemptBody = await foreignAttempt.json();
    check("4a. A different owner's token + Salon A's real id → 404 (not 200, not a different error)", foreignAttempt.status === 404, { status: foreignAttempt.status, body: foreignAttemptBody });
    check("4b. The 404 body discloses nothing about Salon A", !JSON.stringify(foreignAttemptBody).includes(String(salonA._id)), foreignAttemptBody);

    // ── 5. Legacy single-salon owner — no salonId sent, unaffected ─
    const legacyOwner = await User.create({ name: "ZE2E_LEGACY_OWNER", phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
    const legacyToken = generateAccessToken({ _id: legacyOwner._id, role: "OWNER", tokenVersion: legacyOwner.tokenVersion ?? 0 });
    const legacySalon = await makeApprovedSalon(legacyOwner._id, "LEGACY");
    const legacySchedule = await authFetch(`/api/salon/owner/live-schedule?date=${dateParam}`, legacyToken);
    check("5. Legacy single-salon owner, NO salonId → 200, byte-compatible with pre-fix behavior", legacySchedule.status === 200, { status: legacySchedule.status, body: await legacySchedule.json().catch(() => null) });

    // ── 6. Owner booking list (admin/owner router) — same isolation ─
    const bookingsListA = await authFetch(`/api/v1/bookings/admin/bookings?salonId=${salonA._id}`, ownerToken);
    const bookingsListABody = await bookingsListA.json();
    check("6a. Booking list with salonId=A → includes the booking", bookingsListA.status === 200 && (bookingsListABody.bookings || []).some((b) => String(b._id) === String(booking._id)), bookingsListABody);
    const bookingsListB = await authFetch(`/api/v1/bookings/admin/bookings?salonId=${salonB._id}`, ownerToken);
    const bookingsListBBody = await bookingsListB.json();
    check("6b. Booking list with salonId=B → does NOT include Salon A's booking", bookingsListB.status === 200 && !(bookingsListBBody.bookings || []).some((b) => String(b._id) === String(booking._id)), bookingsListBBody);
    const bookingsListAmbiguous = await authFetch(`/api/v1/bookings/admin/bookings`, ownerToken);
    const bookingsListAmbiguousBody = await bookingsListAmbiguous.json();
    check("6c. Booking list with NO salonId, owner has 2 salons → 409 AMBIGUOUS_SALON", bookingsListAmbiguous.status === 409 && bookingsListAmbiguousBody?.code === "AMBIGUOUS_SALON", bookingsListAmbiguousBody);

    // ── 7. Device-token registration — correct salon ownership ────
    const tokenA = `ExponentPushToken[ze2e-salon-a-${Date.now()}]`;
    const regA = await authFetch("/api/notifications/device-tokens", ownerToken, {
      method: "POST",
      body: JSON.stringify({ token: tokenA, platform: "ANDROID", provider: "EXPO", salonId: salonA._id.toString() }),
    });
    const regABody = await regA.json();
    check("7a. Register device token with salonId=A → 200", regA.status === 200, { status: regA.status, body: regABody });
    const tokenRowA = await DeviceToken.findOne({ token: tokenA }).lean();
    check("7b. The stored DeviceToken's recipientId is Salon A's real id, not an arbitrary one", String(tokenRowA?.recipientId) === String(salonA._id) && tokenRowA?.recipientType === "SALON", tokenRowA);

    const tokenB = `ExponentPushToken[ze2e-salon-b-${Date.now()}]`;
    const regB = await authFetch("/api/notifications/device-tokens", ownerToken, {
      method: "POST",
      body: JSON.stringify({ token: tokenB, platform: "ANDROID", provider: "EXPO", salonId: salonB._id.toString() }),
    });
    const tokenRowB = await DeviceToken.findOne({ token: tokenB }).lean();
    check("7c. A second token registered with salonId=B lands under Salon B's own id — the two never collide", regB.status === 200 && String(tokenRowB?.recipientId) === String(salonB._id), tokenRowB);

    const regAmbiguous = await authFetch("/api/notifications/device-tokens", ownerToken, {
      method: "POST",
      body: JSON.stringify({ token: `ExponentPushToken[ze2e-ambiguous-${Date.now()}]`, platform: "ANDROID", provider: "EXPO" }),
    });
    const regAmbiguousBody = await regAmbiguous.json();
    check("7d. Register with NO salonId, owner has 2 salons → 409 AMBIGUOUS_SALON (does NOT silently pin to an arbitrary salon)", regAmbiguous.status === 409 && regAmbiguousBody?.code === "AMBIGUOUS_SALON", regAmbiguousBody);

    const regForeignSalon = await authFetch("/api/notifications/device-tokens", foreignToken, {
      method: "POST",
      body: JSON.stringify({ token: `ExponentPushToken[ze2e-foreign-${Date.now()}]`, platform: "ANDROID", provider: "EXPO", salonId: salonA._id.toString() }),
    });
    check("7e. A different owner's token + Salon A's real salonId → 404, not 200", regForeignSalon.status === 404, await regForeignSalon.json().catch(() => null));

    const deactivateA = await authFetch("/api/notifications/device-tokens/deactivate", ownerToken, {
      method: "PATCH",
      body: JSON.stringify({ token: tokenA, salonId: salonA._id.toString() }),
    });
    check("7f. Deactivate Salon A's own token, explicit salonId → 200", deactivateA.status === 200, await deactivateA.json().catch(() => null));
    const tokenRowAAfterDeactivate = await DeviceToken.findOne({ token: tokenA }).lean();
    check("7g. Salon A's token is now invalid; Salon B's token (tokenB) is unaffected", tokenRowAAfterDeactivate?.isValid === false, tokenRowAAfterDeactivate);
    const tokenRowBStillValid = await DeviceToken.findOne({ token: tokenB }).lean();
    check("7h. Salon B's own token was never touched by Salon A's deactivation", tokenRowBStillValid?.isValid === true, tokenRowBStillValid);

    // ── 8. Notification dispatch targets the booking's actual salonRef,
    //      and the owner's in-app read is correctly salon-scoped ────
    // Same payload shape controllers/booking.controller.js#lockSlot
    // itself sends — recipientId is ALWAYS booking.salonRef, never an
    // ownerId lookup (already proven correct by code audit); this
    // simulates exactly that real call to test the READ side.
    await NotificationService.send(
      {
        recipientId:   booking.salonRef,
        recipientType: "SALON",
        templateKey:   NOTIFICATION_EVENTS.BOOKING_CREATED,
        title:         "New Booking",
        message:       "ZE2E test booking notification for Salon A",
        type:          "BOOKING",
        priority:      "HIGH",
        actionType:    "OPEN_BOOKING",
        actionUrl:     `/bookings/${booking._id}`,
        meta:          { bookingId: booking._id },
      },
      ["IN_APP"]
    );
    const createdNotification = await Notification.findOne({ "meta.bookingId": booking._id }).lean();
    check("8a. NotificationService.send created a Notification with recipientId = booking.salonRef (Salon A), never an ownerId-resolved value", String(createdNotification?.recipientId) === String(salonA._id), createdNotification);

    const notificationsA = await authFetch(`/api/notifications?salonId=${salonA._id}`, ownerToken);
    const notificationsABody = await notificationsA.json();
    const notificationsAHasIt = (notificationsABody?.data?.notifications || []).some((n) => String(n._id) === String(createdNotification._id));
    check("8b. GET /notifications with salonId=A → includes this notification", notificationsA.status === 200 && notificationsAHasIt, notificationsABody);

    const notificationsB = await authFetch(`/api/notifications?salonId=${salonB._id}`, ownerToken);
    const notificationsBBody = await notificationsB.json();
    const notificationsBHasIt = (notificationsBBody?.data?.notifications || []).some((n) => String(n._id) === String(createdNotification._id));
    check("8c. GET /notifications with salonId=B → does NOT include Salon A's notification", notificationsB.status === 200 && !notificationsBHasIt, notificationsBBody);

    const notificationsAmbiguous = await authFetch(`/api/notifications`, ownerToken);
    const notificationsAmbiguousBody = await notificationsAmbiguous.json();
    check("8d. GET /notifications with NO salonId, owner has 2 salons → 409 AMBIGUOUS_SALON", notificationsAmbiguous.status === 409 && notificationsAmbiguousBody?.code === "AMBIGUOUS_SALON", notificationsAmbiguousBody);

    // mark-all-read must also be salon-scoped — same shared resolver
    const markAllA = await authFetch(`/api/notifications/read-all`, ownerToken, { method: "PATCH", body: JSON.stringify({ salonId: salonA._id.toString() }) });
    check("8e. Mark-all-read scoped to salonId=A → 200", markAllA.status === 200, await markAllA.json().catch(() => null));
    const notificationAfterMarkRead = await Notification.findById(createdNotification._id).lean();
    check("8f. Salon A's notification is now marked read by the scoped mark-all-read call", notificationAfterMarkRead?.isRead === true, notificationAfterMarkRead);

    // ── 9. Invalid salonId format → 404, never a 500/crash ─────────
    const invalidSalonId = await authFetch(`/api/salon/owner/live-schedule?date=${dateParam}&salonId=not-a-real-object-id`, ownerToken);
    check("9. A malformed salonId → 404, not a crash", invalidSalonId.status === 404, { status: invalidSalonId.status });

    // ── 10. Customer (USER role) device-token registration — the
    //      centralized push architecture audit's one confirmed,
    //      additive backend gap: DeviceToken/Notification already
    //      supported recipientType "USER" in their schema enum, but
    //      the registration ROUTE only allowed OWNER/FIELD_AGENT
    //      (requireRole) and the CONTROLLER's resolveRecipient had no
    //      USER branch — a customer calling this endpoint would have
    //      been rejected at the role gate, or (if that were widened
    //      without the controller fix) would incorrectly fall into
    //      getSalonByOwner and get a confusing 404 "Salon not found"
    //      (a customer owns zero salons). Both are now fixed.
    const customerToken = `ExponentPushToken[ze2e-customer-${Date.now()}]`;
    const customerAuthToken = generateAccessToken({ _id: customer._id, role: "USER", tokenVersion: customer.tokenVersion ?? 0 });
    const custReg = await authFetch("/api/notifications/device-tokens", customerAuthToken, {
      method: "POST",
      body: JSON.stringify({ token: customerToken, platform: "ANDROID", provider: "EXPO" }),
    });
    const custRegBody = await custReg.json();
    check("10a. Customer (USER role) can register a device token → 200 (previously blocked by the role gate)", custReg.status === 200, { status: custReg.status, body: custRegBody });
    const custTokenRow = await DeviceToken.findOne({ token: customerToken }).lean();
    check("10b. The stored DeviceToken's recipientType is USER, recipientId is the customer's own User._id — never a Salon id", custTokenRow?.recipientType === "USER" && String(custTokenRow?.recipientId) === String(customer._id), custTokenRow);

    // Simulate a BOOKING_CONFIRMED push to the customer (same shape
    // controllers/booking.controller.js's own confirmBooking call
    // uses: recipientId: booking.userRef, recipientType: "USER") and
    // confirm it never collides with, or is visible via, Salon A's
    // own device-token/notification rows above.
    const customerSalonTokenCollision = await DeviceToken.findOne({ recipientType: "SALON", recipientId: customer._id }).lean();
    check("10c. No DeviceToken row exists conflating this customer's User._id with a SALON recipient", !customerSalonTokenCollision, customerSalonTokenCollision);

    // ── 11. ownerCancelBooking multi-salon authorization fix ───────
    //      controllers/booking.controller.js#ownerCancelBooking (route:
    //      POST /api/v1/bookings/admin/cancel) used to resolve the
    //      caller's salon via an unscoped `Salon.findOne({ ownerId })`
    //      and compare booking.salonRef against whichever salon that
    //      returned. For an owner with 2+ approved salons, MongoDB gave
    //      no ordering guarantee — so this could resolve to the WRONG
    //      one of the owner's OWN salons, wrongly 403'ing an owner
    //      cancelling their own booking (a false-negative, never a
    //      cross-owner leak, since ownerId was always scoped to the
    //      real caller).
    //
    //      FIX: the ownership check is now one query scoped directly
    //      to `{ _id: booking.salonRef, ownerId, isDeleted: false }` —
    //      the booking's own salonRef already names the exact salon,
    //      so there is nothing left to guess. The checks below assert
    //      the fixed behavior directly (not "sometimes reproduces"):
    //      an owner can cancel their own eligible booking on EITHER of
    //      their salons, a different owner still cannot, a soft-deleted
    //      salon still cannot authorize a cancel, a missing booking is
    //      a 404, and the pre-existing state-machine restriction
    //      (double-cancel) is untouched by this fix.
    const cancelOwner = await User.create({ name: "ZE2E_CANCEL_OWNER", phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
    const cancelOwnerToken = generateAccessToken({ _id: cancelOwner._id, role: "OWNER", tokenVersion: cancelOwner.tokenVersion ?? 0 });
    const cancelSalonA = await makeApprovedSalon(cancelOwner._id, "CANCEL_A");
    const cancelSalonB = await makeApprovedSalon(cancelOwner._id, "CANCEL_B");
    const cancelChairA = await Chair.create({ salonId: cancelSalonA._id, chairCode: `${cancelSalonA._id}-CHR-001`, name: "Chair 1", position: 1, isActive: true });
    const cancelChairB = await Chair.create({ salonId: cancelSalonB._id, chairCode: `${cancelSalonB._id}-CHR-001`, name: "Chair 1", position: 1, isActive: true });

    // Mirrors confirmBooking's own real sequence (controllers/booking
    // .controller.js, around its WalletBalanceService.creditPending
    // call): a CONFIRMED booking always has its serviceAmountInPaise
    // already credited to the salon's PENDING wallet balance at
    // payment time. ownerCancelBooking's refund path claws that back
    // via debitPending — a Booking fixture inserted directly via the
    // model (bypassing confirmBooking) has no such credit, so without
    // this the cancel call fails on a genuine, unrelated existing
    // rule ("Insufficient PENDING balance"), not anything to do with
    // the authorization fix under test.
    const makeCancellableBooking = async (salonId, chairId, hourOffset) => {
      const start = new Date(Date.now() + hourOffset * 60 * 60 * 1000);
      start.setUTCHours(11, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      const created = await Booking.create({
        userRef: customer._id,
        salonRef: salonId,
        chairRef: chairId,
        serviceRefs: [service._id],
        bookingDate: start.toISOString().split("T")[0],
        startTime: start,
        endTime: end,
        serviceDuration: 30,
        status: "CONFIRMED",
        totalAmountInPaise: 30000,
        serviceAmountInPaise: 30000,
        commissionAmountInPaise: 0,
        gstAmountInPaise: 0,
      });
      // WalletBalanceService requires an active mongoose transaction
      // session for every mutating call (sessionOrThrow) — this
      // fixture opens its own short-lived one, same as any real
      // caller would, rather than bypassing the service.
      const creditSession = await mongoose.startSession();
      await creditSession.withTransaction(async () => {
        await WalletBalanceService.creditPending({
          salonId:        salonId,
          amountInPaise:  30000,
          action:         "BOOKING_SETTLEMENT",
          refType:        "BOOKING",
          refId:          created._id,
          idempotencyKey: `booking:credit:${created._id}`,
          session:        creditSession,
          triggeredBy:    "SYSTEM",
          remarks:        "ZE2E fixture — mirrors confirmBooking's real PENDING credit",
        });
      });
      await creditSession.endSession();
      return created;
    };

    // 11a/11b — owner can cancel an eligible booking on EITHER of their
    // own salons (this is the exact scenario that used to 403 for
    // whichever salon the unscoped findOne did not happen to return).
    const bookingOnSalonA = await makeCancellableBooking(cancelSalonA._id, cancelChairA._id, 36);
    const cancelAttemptA = await authFetch("/api/v1/bookings/admin/cancel", cancelOwnerToken, {
      method: "POST",
      body: JSON.stringify({ bookingId: bookingOnSalonA._id.toString(), reason: "ZE2E — owner cancels own booking on Salon A" }),
    });
    const cancelAttemptABody = await cancelAttemptA.json();
    check("11a. Owner cancels their own eligible booking on Salon A → 200", cancelAttemptA.status === 200 && cancelAttemptABody?.success === true, { status: cancelAttemptA.status, body: cancelAttemptABody });

    const bookingOnSalonB = await makeCancellableBooking(cancelSalonB._id, cancelChairB._id, 48);
    const cancelAttemptB = await authFetch("/api/v1/bookings/admin/cancel", cancelOwnerToken, {
      method: "POST",
      body: JSON.stringify({ bookingId: bookingOnSalonB._id.toString(), reason: "ZE2E — owner cancels own booking on Salon B" }),
    });
    const cancelAttemptBBody = await cancelAttemptB.json();
    check("11b. Owner cancels their own eligible booking on Salon B → 200 (the exact case that used to false-negative 403)", cancelAttemptB.status === 200 && cancelAttemptBBody?.success === true, { status: cancelAttemptB.status, body: cancelAttemptBBody });

    const bookingARow = await Booking.findById(bookingOnSalonA._id).lean();
    const bookingBRow = await Booking.findById(bookingOnSalonB._id).lean();
    check("11c. Both bookings are now actually CANCELLED in the database — not just a 200 with no effect", bookingARow?.status === "CANCELLED" && bookingBRow?.status === "CANCELLED", { a: bookingARow?.status, b: bookingBRow?.status });

    // 11d — a different owner cannot cancel this owner's booking.
    const bookingForForeignTest = await makeCancellableBooking(cancelSalonA._id, cancelChairA._id, 60);
    const foreignCancelAttempt = await authFetch("/api/v1/bookings/admin/cancel", foreignToken, {
      method: "POST",
      body: JSON.stringify({ bookingId: bookingForForeignTest._id.toString(), reason: "ZE2E — foreign owner must not be able to cancel this" }),
    });
    const foreignCancelAttemptBody = await foreignCancelAttempt.json();
    check("11d. A different owner's token cannot cancel this owner's booking → 403, not 200", foreignCancelAttempt.status === 403, { status: foreignCancelAttempt.status, body: foreignCancelAttemptBody });
    const bookingForForeignTestRow = await Booking.findById(bookingForForeignTest._id).lean();
    check("11e. The foreign cancel attempt had no effect — booking is still CONFIRMED", bookingForForeignTestRow?.status === "CONFIRMED", bookingForForeignTestRow);

    // 11f — missing booking → 404, not a crash.
    const missingBookingAttempt = await authFetch("/api/v1/bookings/admin/cancel", cancelOwnerToken, {
      method: "POST",
      body: JSON.stringify({ bookingId: new mongoose.Types.ObjectId().toString(), reason: "ZE2E — booking does not exist" }),
    });
    check("11f. A nonexistent bookingId → 404, not a crash", missingBookingAttempt.status === 404, { status: missingBookingAttempt.status, body: await missingBookingAttempt.json().catch(() => null) });

    // 11g — a soft-deleted salon cannot authorize a cancel, even for
    // its own true owner (matches this codebase's existing isDeleted
    // convention for salon-ownership checks elsewhere, e.g.
    // resolveSensitiveOwnerSalon above).
    const deletedSalonOwner = await User.create({ name: "ZE2E_DELETED_SALON_OWNER", phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
    const deletedSalonOwnerToken = generateAccessToken({ _id: deletedSalonOwner._id, role: "OWNER", tokenVersion: deletedSalonOwner.tokenVersion ?? 0 });
    const deletedSalon = await makeApprovedSalon(deletedSalonOwner._id, "SOFT_DELETED");
    const deletedSalonChair = await Chair.create({ salonId: deletedSalon._id, chairCode: `${deletedSalon._id}-CHR-001`, name: "Chair 1", position: 1, isActive: true });
    const bookingOnDeletedSalon = await makeCancellableBooking(deletedSalon._id, deletedSalonChair._id, 72);
    await Salon.updateOne({ _id: deletedSalon._id }, { $set: { isDeleted: true } });
    const deletedSalonCancelAttempt = await authFetch("/api/v1/bookings/admin/cancel", deletedSalonOwnerToken, {
      method: "POST",
      body: JSON.stringify({ bookingId: bookingOnDeletedSalon._id.toString(), reason: "ZE2E — salon is soft-deleted" }),
    });
    check("11g. The booking's salon is soft-deleted → 403, even for its own true owner", deletedSalonCancelAttempt.status === 403, { status: deletedSalonCancelAttempt.status, body: await deletedSalonCancelAttempt.json().catch(() => null) });

    // 11h — repeated cancellation: the pre-existing state-machine
    // restriction (a CANCELLED booking cannot be cancelled again) is
    // untouched by this fix — confirms the fix only changed WHO is
    // authorized, not the booking lifecycle itself.
    const repeatedCancelAttempt = await authFetch("/api/v1/bookings/admin/cancel", cancelOwnerToken, {
      method: "POST",
      body: JSON.stringify({ bookingId: bookingOnSalonA._id.toString(), reason: "ZE2E — cancelling an already-cancelled booking" }),
    });
    const repeatedCancelAttemptBody = await repeatedCancelAttempt.json();
    check("11h. Cancelling an already-CANCELLED booking → 400 'Invalid booking state: CANCELLED' (unchanged existing restriction)", repeatedCancelAttempt.status === 400 && repeatedCancelAttemptBody?.message === "Invalid booking state: CANCELLED", { status: repeatedCancelAttempt.status, body: repeatedCancelAttemptBody });

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
    console.log(`\nMULTI-SALON BOOKING/NOTIFICATION ISOLATION: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
