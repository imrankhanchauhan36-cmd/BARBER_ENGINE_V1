/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyOwnerDuplicateSalonGuard.mjs
 *
 * Multi-salon support, Phase 0 — controllers/salon.controller.js
 * #onboardSalon (POST /api/salon/owner/submit-onboarding).
 *
 * PREMISE REVERSED FROM THIS FILE'S ORIGINAL VERSION: an earlier
 * revision of onboardSalon blocked a second Salon.create() while the
 * owner already had one PENDING/APPROVED salon, and this file tested
 * that guard. ZEMISH's confirmed business rule is the OPPOSITE: one
 * owner may legitimately own multiple independent salons (e.g. Salon
 * Agra + Salon Delhi), each with its own salonId, bookings, schedule,
 * staff, and wallet — same model as one restaurant owner managing
 * several restaurants on a platform like Zomato. The ownerId-based
 * guard has been REMOVED from onboardSalon. This file now verifies
 * the opposite of what it used to: that an owner with an existing
 * PENDING/APPROVED/REJECTED salon CAN successfully create another,
 * and that the only remaining duplicate-submission signal — the
 * pre-existing, untouched manager.phone check — still works
 * correctly and independently of salon count.
 *
 * Real HTTP-level integration test against a fully isolated stack: a
 * disposable mongodb-memory-server replica set, a real Express server
 * bound to an OS-assigned local port (app.listen(0)), a locally-
 * generated test-only JWT secret, and a REAL ephemeral local Redis
 * (see STEP 2 below) — same proven isolation pattern as
 * scripts/e2e/verifyBookingQuoteHttpIntegration.mjs and
 * scripts/e2e/verifyOwnerScheduleAndBookingNotification.mjs.
 *
 * GEO FIXTURE: onboardSalon's real path requires a full
 * Country→State→District→City→Pincode hierarchy (geoService
 * .detectLocation does a real $near query against Pincode, then
 * utils/validateGeoHierarchy.js walks State→District→City). The
 * State/District/City fixture shape is copied from the already-proven
 * scripts/e2e/fieldAgentE2EHelpers.js#makeGeoFixture (FA-16); the
 * Pincode document is new fixture code (no prior script in this repo
 * builds one) — this is the first real exercise of onboardSalon's
 * geo path in this codebase's test history.
 *
 * SCOPE: this script tests ONLY onboardSalon's now-guard-free
 * duplicate-submission behavior. It does not touch, and makes no
 * claim about, booking/schedule/notification behavior, and does NOT
 * attempt the Phase-1-dependent saveBasicInfo overwrite-bug fix (see
 * controllers/salon.onboarding.controller.js's own header note on
 * that — out of scope for Phase 0, confirmed unreachable by any
 * current client flow per RootNavigator.js's routing, so leaving it
 * untouched carries no new risk).
 *
 * PRE-EXISTING BUGS FOUND EARLIER IN THIS ENGAGEMENT, STILL TRUE,
 * UNCHANGED BY THIS PHASE:
 *   - onboardSalon's salonData defaults every day's timings to
 *     {isClosed:true} (fixed in an earlier phase — not an invented
 *     working-hours value; the active onboarding wizard's saveTimings
 *     step can set real hours afterward, once Phase 1 gives it a
 *     salonId to target).
 *   - Salon.js's ownerId is schema `required: true`, so a temp-owner
 *     session (onboardSalon's own payload.ownerId = null) still
 *     cannot reach a 201 — see case 5 below.
 *
 * CORRECTED FRAMING vs. an earlier run of this file: two concurrent
 * FIRST-time submissions from one new owner, each with a DIFFERENT
 * manager.phone, previously succeeding and creating 2 Salon documents
 * was reported as a confirmed "race"/vulnerability. Under the now-
 * confirmed business rule, that outcome is CORRECT, not a bug — two
 * different phone numbers describe two different real businesses.
 * The only duplicate-submission race that still matters is whether
 * two concurrent requests sharing the SAME manager.phone can both
 * slip past that check — see case 6 below.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyOwnerDuplicateSalonGuard.mjs
 */

import crypto from "crypto";
import net from "net";
import http from "http";
import { spawn } from "child_process";

// ─── STEP 1 — test-only JWT secret, before any other import ────────
const TEST_JWT_SECRET = crypto.randomBytes(32).toString("hex");
if (!TEST_JWT_SECRET || TEST_JWT_SECRET.length < 32) {
  throw new Error("FAIL-CLOSED: could not generate a test-only JWT secret — refusing to proceed.");
}
process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
delete process.env.JWT_SECRET;

// ─── STEP 2 — Redis: a REAL, ephemeral, loopback-only redis-server
// for THIS run, instead of every other script in this suite's
// SKIP_REDIS_AUTOCONNECT opt-out. This script specifically needs to
// verify middlewares/idempotency.middleware.js's actual Redis-backed
// NX lock behavior (checks 7a-7d) — that cannot be proven against a
// disconnected Redis, same reason
// verifyOwnerScheduleAndBookingNotification.mjs had to document that
// exact path as untestable. A throwaway redis-server bound to
// 127.0.0.1 on a freshly-allocated port, spawned and torn down
// entirely within this script's own process tree, is not the shared/
// production Redis — same isolation principle as MongoMemoryReplSet
// for Mongo. Started and connected to BEFORE the network guard is
// installed below is fine either way: it's always loopback.
const findFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

const startEphemeralRedis = (port) =>
  new Promise((resolve, reject) => {
    const proc = spawn("redis-server", [
      "--port", String(port),
      "--bind", "127.0.0.1",
      "--save", "",
      "--appendonly", "no",
      "--daemonize", "no",
    ]);
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; proc.kill(); reject(new Error("redis-server did not become ready within 5s")); }
    }, 5000);
    proc.stdout.on("data", (chunk) => {
      if (!settled && chunk.toString().includes("Ready to accept connections")) {
        settled = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });
    proc.on("error", (err) => { if (!settled) { settled = true; clearTimeout(timeout); reject(err); } });
    proc.on("exit", (code) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`redis-server exited early (code ${code})`)); } });
  });

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
  let redisProc = null;

  try {
    await mongoose.connect(mem.getUri(), { dbName: "owner_duplicate_salon_guard" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    // Real, ephemeral, loopback-only Redis for this run — see STEP 2
    // comment above. Must be set up BEFORE app.js is imported, since
    // config/redis.js eagerly connects at import time.
    const redisPort = await findFreePort();
    redisProc = await startEphemeralRedis(redisPort);
    process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
    delete process.env.SKIP_REDIS_AUTOCONNECT;

    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const Country = (await import("../../models/Country.js")).default;
    const State = (await import("../../models/State.js")).default;
    const District = (await import("../../models/District.js")).default;
    const City = (await import("../../models/City.js")).default;
    const Pincode = (await import("../../models/Pincode.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");
    const jwt = (await import("jsonwebtoken")).default;

    httpServer = app.listen(0);
    const port = await new Promise((resolve) => httpServer.on("listening", () => resolve(httpServer.address().port)));

    const oid = () => new mongoose.Types.ObjectId();

    // Same http.request()-based helper as verifyBookingQuoteHttpIntegration.mjs —
    // global fetch() (Undici) is empirically confirmed to bypass the
    // net.Socket.prototype.connect guard above; http.request() does not.
    const authFetch = (path, token, opts = {}) =>
      new Promise((resolve, reject) => {
        const headers = {
          "Content-Type": "application/json",
          ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers || {}),
        };
        const req = http.request(
          { host: "127.0.0.1", port, path, method: opts.method || "POST", headers },
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

    // ── Geo fixture ───────────────────────────────────────────────
    // State/District/City shape copied verbatim from
    // fieldAgentE2EHelpers.js#makeGeoFixture (FA-16, already proven).
    // Pincode is new: geo.coordinates deliberately match the lat/lng
    // every onboardSalon request below sends, inside Pincode's own
    // primary 5km search radius (services/geo.service.js RADIUS.primary).
    const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
    const country = await Country.create({
      name: "ZEMISH TESTLAND",
      code: "ZT",
      dialCode: "+91",
      currencyCode: "INR",
      timezones: ["Asia/Kolkata"],
      centroid: { type: "Point", coordinates: [77, 20] },
    });
    const state = await State.create({ name: "ZE2E_STATE_OWNERGUARD", normalizedName: "ze2e_state_ownerguard", code: randLetters(), slug: "ze2e-state-ownerguard", type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    const district = await District.create({ name: "ZE2E_DISTRICT_OWNERGUARD", code: `ZD${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
    const city = await City.create({ name: "ZE2E_CITY_OWNERGUARD", districtRef: district._id, stateRef: state._id, isActive: true, isDeleted: false });
    const TEST_LAT = 28.6;
    const TEST_LNG = 77.2;
    await Pincode.create({
      code: "110001",
      countryRef: country._id,
      stateRef: state._id,
      districtRef: district._id,
      cityRef: city._id,
      geo: { type: "Point", coordinates: [TEST_LNG, TEST_LAT] },
      isActive: true,
      isDeleted: false,
    });
    // Mongoose builds declared indexes (including the 2dsphere index
    // geoService.detectLocation's $near query relies on, via an
    // explicit .hint({geo:"2dsphere"})) asynchronously in the
    // background after a model is first compiled — not guaranteed to
    // exist yet by the time the Pincode fixture's own insert above
    // resolves. Forcing it explicitly here avoids a real race, not a
    // cosmetic one: without this, the very first $near query below
    // failed with "hint provided does not correspond to an existing
    // index" during this script's first actual run.
    await Pincode.createIndexes();

    let phoneCounter = 0;
    const nextPhone = () => `9${String(100000000 + Math.floor(Math.random() * 800000000) + phoneCounter++)}`.slice(0, 10);

    const submitOnboarding = (token, phone) =>
      authFetch("/api/salon/owner/submit-onboarding", token, {
        body: JSON.stringify({
          managerPhone: phone,
          basicInfo: { shopName: `ZE2E Salon ${phone}` },
          location: { coordinates: [TEST_LNG, TEST_LAT] },
        }),
      });

    const makeOwnerToken = async (label) => {
      const owner = await User.create({ name: `ZE2E_OWNER_${label}`, phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
      const token = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: owner.tokenVersion ?? 0 });
      return { owner, token };
    };

    // The only remaining duplicate-submission message on this route —
    // pre-existing legacy code, untouched by Phase 0's guard removal.
    const PHONE_DUPLICATE_MESSAGE = "Salon already exists for this number";
    const isPhoneDuplicateBlock = (res, body) => res.status === 409 && body?.message === PHONE_DUPLICATE_MESSAGE;

    // [VALID FIXTURE] A pre-existing Salon document created directly
    // via the model — NOT through onboardSalon's own HTTP endpoint,
    // which (see file header) cannot currently succeed for anyone due
    // to the separate, pre-existing missing-`timings` bug. Includes a
    // full open week so the fixture itself is schema-valid; this does
    // not exercise onboardSalon and makes no claim about it.
    const OPEN_ALL_DAY = { open: "09:00", close: "20:00" };
    const ALL_DAYS_OPEN = { monday: OPEN_ALL_DAY, tuesday: OPEN_ALL_DAY, wednesday: OPEN_ALL_DAY, thursday: OPEN_ALL_DAY, friday: OPEN_ALL_DAY, saturday: OPEN_ALL_DAY, sunday: OPEN_ALL_DAY };
    const makeExistingSalonFixture = async (ownerId, approvalStatus, phone) =>
      Salon.create({
        ownerId,
        basicInfo: { shopName: `ZE2E Existing Salon ${phone}`, category: "UNISEX" },
        manager: { phone },
        location: {
          address: "ZE2E fixture address",
          geo: { type: "Point", coordinates: [TEST_LNG, TEST_LAT] },
          territory: { countryRef: country._id, stateRef: state._id, districtRef: district._id, cityRef: city._id },
        },
        timings: ALL_DAYS_OPEN,
        approval: { status: approvalStatus },
        onboarding: { step: 1 },
        isDeleted: false,
      });

    // ── 1. New owner, no existing salon → succeeds end-to-end ─────
    const { token: newOwnerToken } = await makeOwnerToken("NEW");
    const newOwnerRes = await submitOnboarding(newOwnerToken, nextPhone());
    const newOwnerBody = await newOwnerRes.json();
    check("1a. New owner (no existing salon) → 201 Created", newOwnerRes.status === 201, { status: newOwnerRes.status, body: newOwnerBody });
    check("1b. New owner response carries a salonId with approvalStatus PENDING", !!newOwnerBody?.data?.salonId && newOwnerBody?.data?.approvalStatus === "PENDING", newOwnerBody);
    if (newOwnerRes.status === 201) {
      const createdSalon = await Salon.findById(newOwnerBody.data.salonId).select("timings.monday").lean();
      check("1c. Created salon's default timings are isClosed (not an invented working-hours value)", createdSalon?.timings?.monday?.isClosed === true, createdSalon);
    }

    // ── 2. Existing PENDING salon → owner CAN register a second,
    //      independent salon (confirmed business rule — this is the
    //      direct, previously-missing proof the rule is honored) ───
    const { owner: pendingOwner, token: pendingOwnerToken } = await makeOwnerToken("PENDING");
    const pendingFixture = await makeExistingSalonFixture(pendingOwner._id, "PENDING", nextPhone());
    const secondSalonRes = await submitOnboarding(pendingOwnerToken, nextPhone());
    const secondSalonBody = await secondSalonRes.json();
    check("2a. Owner with an existing PENDING salon → second submission (different phone) → 201 Created", secondSalonRes.status === 201, { status: secondSalonRes.status, body: secondSalonBody });
    check("2b. The second salon has a DIFFERENT salonId from the existing PENDING one", !!secondSalonBody?.data?.salonId && String(secondSalonBody.data.salonId) !== String(pendingFixture._id), secondSalonBody);
    const salonCountAfterSecond = await Salon.countDocuments({ ownerId: pendingOwner._id });
    check("2c. Owner now has exactly 2 independent Salon documents — expected, not a defect", salonCountAfterSecond === 2, salonCountAfterSecond);

    // ── 3. Existing APPROVED salon → same: a second, independent
    //      salon can be created ────────────────────────────────────
    const { owner: approvedOwner, token: approvedOwnerToken } = await makeOwnerToken("APPROVED");
    const approvedFixture = await makeExistingSalonFixture(approvedOwner._id, "APPROVED", nextPhone());
    const approvedSecondRes = await submitOnboarding(approvedOwnerToken, nextPhone());
    const approvedSecondBody = await approvedSecondRes.json();
    check("3a. Owner with an existing APPROVED salon → second submission (different phone) → 201 Created", approvedSecondRes.status === 201, { status: approvedSecondRes.status, body: approvedSecondBody });
    check("3b. The second salon has a DIFFERENT salonId from the existing APPROVED one", !!approvedSecondBody?.data?.salonId && String(approvedSecondBody.data.salonId) !== String(approvedFixture._id), approvedSecondBody);
    const approvedSalonCount = await Salon.countDocuments({ ownerId: approvedOwner._id });
    check("3c. Owner now has exactly 2 independent Salon documents — expected, not a defect", approvedSalonCount === 2, approvedSalonCount);

    // ── 4. Existing salon is REJECTED → resubmission succeeds ─────
    const { owner: rejectedOwner, token: rejectedOwnerToken } = await makeOwnerToken("REJECTED");
    await makeExistingSalonFixture(rejectedOwner._id, "REJECTED", nextPhone());
    const rejectedResubmitRes = await submitOnboarding(rejectedOwnerToken, nextPhone());
    const rejectedResubmitBody = await rejectedResubmitRes.json();
    check("4a. Resubmission when the only existing salon is REJECTED → 201 Created", rejectedResubmitRes.status === 201, { status: rejectedResubmitRes.status, body: rejectedResubmitBody });
    const rejectedOwnerSalonCount = await Salon.countDocuments({ ownerId: rejectedOwner._id });
    check("4b. Owner now has exactly 2 Salon documents (1 REJECTED + 1 new PENDING) — expected, not a defect", rejectedOwnerSalonCount === 2, rejectedOwnerSalonCount);

    // ── 5. payload.ownerId is null (temp-owner / assisted onboarding
    //      session) ─────────────────────────────────────────────────
    // protect's TEMP OWNER branch (middlewares/auth.middleware.js)
    // requires decoded.tempOwner === true, a claim generateAccessToken()
    // does not support — signed directly with the same test secret.
    // PRE-EXISTING, UNFIXED, OUT-OF-SCOPE DEFECT (unrelated to Phase 0,
    // unaffected by the guard removal above): Salon.js's ownerId field
    // is `required: true` — so Salon.create({ownerId: null, ...})
    // always throws "ownerId: Path `ownerId` is required." Confirmed
    // by direct execution (500, not 201).
    const tempOwnerToken = jwt.sign({ tempOwner: true, phone: nextPhone(), role: "OWNER" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    const tempRes = await submitOnboarding(tempOwnerToken, nextPhone());
    const tempBody = await tempRes.json();
    check("5. Temp-owner session (ownerId null) still fails with the known, unrelated ownerId-required defect (500, not 201)", tempRes.status === 500, { status: tempRes.status, body: tempBody });

    // ── 6. The duplicate-submission race that still matters: two
    //      concurrent requests sharing the SAME manager.phone ──────
    // Under the confirmed business rule, two concurrent requests with
    // DIFFERENT phone numbers both succeeding (case 7 below) is the
    // CORRECT outcome, not a race to worry about. The only remaining
    // genuine duplicate-submission concern is whether the pre-existing
    // manager.phone check (lines ~60-81 of onboardSalon, untouched by
    // this phase) can be bypassed by two requests racing with the
    // IDENTICAL phone number.
    const { token: phoneRaceOwnerToken } = await makeOwnerToken("PHONE_RACE");
    const sharedPhone = nextPhone();
    const [phoneRaceA, phoneRaceB] = await Promise.all([
      submitOnboarding(phoneRaceOwnerToken, sharedPhone),
      submitOnboarding(phoneRaceOwnerToken, sharedPhone),
    ]);
    const [phoneRaceABody, phoneRaceBBody] = await Promise.all([phoneRaceA.json(), phoneRaceB.json()]);
    const phoneRaceSalonCount = await Salon.countDocuments({ "manager.phone": sharedPhone });
    const phoneRaceStatuses = [phoneRaceA.status, phoneRaceB.status].sort();
    rows.push(`  ℹ️  6a. Same manager.phone, two concurrent requests — ACTUAL result: statuses=${JSON.stringify(phoneRaceStatuses)}, salonsCreatedWithThisPhone=${phoneRaceSalonCount}`);
    check("6b. The number of Salon documents sharing this phone matches the number of 201 responses (no silent extra/missing create)", phoneRaceSalonCount === [phoneRaceA.status, phoneRaceB.status].filter((s) => s === 201).length, { statuses: [phoneRaceA.status, phoneRaceB.status], salonCount: phoneRaceSalonCount });
    if (phoneRaceSalonCount > 1) {
      rows.push("  ⚠️  CONFIRMED, NOT A TEST BUG: both concurrent requests passed the manager.phone pre-check before either Salon.create() committed — the same class of TOCTOU race previously found on the (now-removed) ownerId guard also applies to this pre-existing phone check. A plain pre-check never eliminates this; only a DB-level unique index on manager.phone would (not proposed — out of scope here, and the current field is deliberately non-unique per the earlier duplicate-protection audit).");
    } else {
      rows.push("  ℹ️  6c. Under this run's actual concurrency, only one of the two same-phone requests succeeded — the race did not manifest this time. Not a guarantee it cannot happen.");
    }

    // ── 7. Two concurrent FIRST-time submissions from one new owner,
    //      each with a DIFFERENT phone — now the EXPECTED, CORRECT
    //      outcome (two real, independent salons), not a vulnerability ─
    const { owner: multiOwner, token: multiOwnerToken } = await makeOwnerToken("MULTI_SALON");
    const multiPhones = [nextPhone(), nextPhone()];
    const [multiA, multiB] = await Promise.all([
      submitOnboarding(multiOwnerToken, multiPhones[0]),
      submitOnboarding(multiOwnerToken, multiPhones[1]),
    ]);
    const [multiABody, multiBBody] = await Promise.all([multiA.json(), multiB.json()]);
    const multiSalonCount = await Salon.countDocuments({ ownerId: multiOwner._id });
    check("7a. Two concurrent first-time submissions with DIFFERENT phones both succeed (201) for the same new owner", multiA.status === 201 && multiB.status === 201, { a: { status: multiA.status, body: multiABody }, b: { status: multiB.status, body: multiBBody } });
    check("7b. The owner now has exactly 2 independent Salon documents — the confirmed business rule, working under real concurrency", multiSalonCount === 2, multiSalonCount);

    // ── 8. Idempotency middleware, now applied to this route ──────
    // routes/salon.routes.js: ownerRouter.post("/submit-onboarding",
    // idempotency, onboardSalon). Verifying exactly what it does and
    // does NOT close, per the read-only audit's conclusion — this is a
    // partial, client-cooperative improvement, not a complete fix.
    const submitOnboardingWithKey = (token, phone, idempotencyKey) =>
      authFetch("/api/salon/owner/submit-onboarding", token, {
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          managerPhone: phone,
          basicInfo: { shopName: `ZE2E Salon ${phone}` },
          location: { coordinates: [TEST_LNG, TEST_LAT] },
        }),
      });

    // 7a. Two concurrent requests sharing the SAME Idempotency-Key —
    // the scenario the middleware is actually designed for (a client
    // that generates one key per logical attempt and reuses it on a
    // double-tap/retry, same convention as user-app's
    // BookingHoldScreen.js via shared/utils/idempotencyKey.js).
    const { owner: idemOwner, token: idemOwnerToken } = await makeOwnerToken("IDEMPOTENT");
    const sharedKey = `ze2e-idem-${Date.now()}`;
    const idemPhones = [nextPhone(), nextPhone()];
    const [idemA, idemB] = await Promise.all([
      submitOnboardingWithKey(idemOwnerToken, idemPhones[0], sharedKey),
      submitOnboardingWithKey(idemOwnerToken, idemPhones[1], sharedKey),
    ]);
    const [idemABody, idemBBody] = await Promise.all([idemA.json(), idemB.json()]);
    const idemSalonCount = await Salon.countDocuments({ ownerId: idemOwner._id });
    check("8a. With a SHARED Idempotency-Key, exactly one Salon document is created for two concurrent requests", idemSalonCount === 1, { a: { status: idemA.status, body: idemABody }, b: { status: idemB.status, body: idemBBody }, salonCount: idemSalonCount });
    const idemStatuses = [idemA.status, idemB.status].sort();
    check("8b. One request got 201, the other got either 409-in-progress or a 200-cached-replay (never a second independent 201)", idemStatuses[0] === 201 ? (idemStatuses[1] === 200 || idemStatuses[1] === 409) : false, idemStatuses);

    // 7c. Confirming the honest limitation: a DIFFERENT key per
    // concurrent request gets NO protection from this middleware —
    // behaves identically to case 6c (no header at all).
    const { owner: idemGapOwner, token: idemGapOwnerToken } = await makeOwnerToken("IDEMPOTENT_GAP");
    const idemGapPhones = [nextPhone(), nextPhone()];
    const [gapA, gapB] = await Promise.all([
      submitOnboardingWithKey(idemGapOwnerToken, idemGapPhones[0], `ze2e-idem-gap-a-${Date.now()}`),
      submitOnboardingWithKey(idemGapOwnerToken, idemGapPhones[1], `ze2e-idem-gap-b-${Date.now()}`),
    ]);
    const idemGapSalonCount = await Salon.countDocuments({ ownerId: idemGapOwner._id });
    rows.push(`  ℹ️  8c. Two concurrent requests with DIFFERENT Idempotency-Keys — ACTUAL result: statuses=${JSON.stringify([gapA.status, gapB.status].sort())}, salonsCreatedForOwner=${idemGapSalonCount} (honest limitation: different keys get no shared protection, confirming the audit's conclusion)`);

    // 7d. No header at all → behavior must be byte-identical to before
    // this middleware was added (pure opt-in, never breaks a caller
    // that doesn't participate).
    const { token: noHeaderToken } = await makeOwnerToken("NO_IDEM_HEADER");
    const noHeaderRes = await submitOnboarding(noHeaderToken, nextPhone());
    const noHeaderBody = await noHeaderRes.json();
    check("8d. A request with no Idempotency-Key header is completely unaffected (still a plain 201)", noHeaderRes.status === 201, { status: noHeaderRes.status, body: noHeaderBody });

    // ── Network guard sanity ─────────────────────────────────────
    check("9. Network guard was installed before any app/model import", networkGuardInstalled === true, networkGuardInstalled);
    check("10. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    try {
      const redisClient = (await import("../../config/redis.js")).default;
      if (redisClient?.isOpen) await redisClient.quit();
    } catch (_) { /* best-effort — the ephemeral process is killed below regardless */ }
    if (redisProc) redisProc.kill();
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nOWNER MULTI-SALON ONBOARDING (Phase 0): ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
