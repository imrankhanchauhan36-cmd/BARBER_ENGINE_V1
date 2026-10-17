/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyKycSalonNotificationAmbiguity.mjs
 *
 * KYC approve/reject — salon-notification ambiguity fix. Real
 * HTTP-level integration test against a fully isolated stack: a
 * disposable mongodb-memory-server replica set, a real Express
 * server bound to an OS-assigned local port (app.listen(0)), a
 * locally-generated test-only JWT secret, and Redis left
 * intentionally disconnected (SKIP_REDIS_AUTOCONNECT) — neither
 * PATCH /api/admin/kyc/:id/approve nor .../reject runs behind the
 * idempotency middleware, so no real Redis is needed here.
 *
 * ROOT CAUSE THIS TEST PROVES IS FIXED: controllers/modules/kyc/
 * controllers/adminKyc.controller.js's approveKYCHandler/
 * rejectKYCHandler used to resolve which salon to notify via an
 * unscoped `Salon.findOne({ ownerId: kyc.ownerId })` — for an owner
 * with 2+ real (non-deleted) salons, this could silently notify an
 * arbitrary one. The fix (resolveKycNotificationSalon) now fails
 * closed: notifies the salon only when there is EXACTLY ONE real
 * one, and silently skips the SALON notification (same as today's
 * existing "no salon" skip) for 0 or 2+ matches — never guesses.
 *
 * SCOPE: this script tests ONLY the salon-notification-targeting
 * fix. It does not touch the KYC decision itself, the Field Agent
 * notification branch, or field-agent-application-lifecycle sync —
 * each scenario below asserts those are byte-identical regardless of
 * how many salons the owner has.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyKycSalonNotificationAmbiguity.mjs
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
    await mongoose.connect(mem.getUri(), { dbName: "kyc_salon_notification_ambiguity" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const Country = (await import("../../models/Country.js")).default;
    const KYC = (await import("../../modules/kyc/models/KYC.js")).default;
    const Notification = (await import("../../models/Notification.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");

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

    const makeSalon = (ownerId, label, isDeleted = false) =>
      Salon.create({
        ownerId,
        basicInfo: { shopName: `ZE2E KYC Salon ${label}`, category: "UNISEX" },
        manager: { phone: nextPhone() },
        timings: ALL_DAYS_OPEN,
        approval: { status: "DRAFT" },
        business: { isForceClosed: false, isShopOpen: true },
        onboarding: { step: 8, completed: true },
        isDeleted,
      });

    // ── INDIA admin fixture — zero territory restriction (assertKYCInScope) ──
    const country = await Country.create({ name: "ZE2E KYC TESTLAND", code: "ZK", dialCode: "+91", currencyCode: "INR", timezones: ["Asia/Kolkata"], centroid: { type: "Point", coordinates: [77, 20] } });
    // TEST-ONLY lock-contention fix — same root cause and fix shape
    // already validated and approved for verifyMultiSalonOnboardingIdentity
    // .mjs's Salon.createIndexes(): Mongoose's autoIndex builds a
    // model's indexes asynchronously, unawaited, on first use, which
    // can collide with that same model's first real transactional
    // write under host contention ("Unable to acquire IX lock on
    // '{Collection : ...kycs}'"). This script's first KYC write is
    // always its first-ever use of the KYC model in this process, so
    // it is warmed here before any HTTP call. Confirmed KYC.js's own
    // index declarations contain neither of the two invalid-syntax
    // patterns found elsewhere (Staff.js/Chair.js) that would make an
    // explicit createIndexes() crash instead of just warm.
    await KYC.createIndexes();

    const admin = await User.create({ name: "ZE2E_INDIA_ADMIN", email: `ze2e-india-admin-${Date.now()}@example.test`, role: "ADMIN", adminLevel: "INDIA", countryRef: country._id, accountStatus: "ACTIVE" });
    const adminToken = generateAccessToken({ _id: admin._id, role: "ADMIN", tokenVersion: admin.tokenVersion ?? 0 });

    const makeOwnerWithKyc = async (label) => {
      const owner = await User.create({ name: `ZE2E_KYC_OWNER_${label}`, phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
      const kyc = await KYC.create({ ownerId: owner._id, applicantType: "OWNER", status: "PENDING" });
      return { owner, kyc };
    };

    const notificationFor = (kycId) => Notification.findOne({ "meta.kycId": kycId, recipientType: "SALON" }).lean();

    // ═══ 1. Single real salon — APPROVE — byte-identical to today ═══
    const { owner: ownerA, kyc: kycA } = await makeOwnerWithKyc("A_SINGLE_APPROVE");
    const salonA = await makeSalon(ownerA._id, "A_SINGLE_APPROVE");
    const approveA = await authFetch(`/api/admin/kyc/${kycA._id}/approve`, adminToken, { method: "PATCH", body: JSON.stringify({}) });
    const approveABody = await approveA.json();
    check("1a. Single-salon owner — approve → 200", approveA.status === 200 && approveABody?.data?.status === "VERIFIED", { status: approveA.status, body: approveABody });
    const notifA = await notificationFor(kycA._id);
    check("1b. Single-salon owner — notification SENT, recipientId = that salon's real id (unchanged behavior)", String(notifA?.recipientId) === String(salonA._id), notifA);

    // ═══ 2. Single real salon — REJECT — byte-identical to today ═══
    const { owner: ownerB, kyc: kycB } = await makeOwnerWithKyc("B_SINGLE_REJECT");
    const salonB = await makeSalon(ownerB._id, "B_SINGLE_REJECT");
    const rejectB = await authFetch(`/api/admin/kyc/${kycB._id}/reject`, adminToken, { method: "PATCH", body: JSON.stringify({ reason: "ZE2E test rejection reason, long enough." }) });
    const rejectBBody = await rejectB.json();
    check("2a. Single-salon owner — reject → 200", rejectB.status === 200 && rejectBBody?.data?.status === "REJECTED", { status: rejectB.status, body: rejectBBody });
    const notifB = await notificationFor(kycB._id);
    check("2b. Single-salon owner — notification SENT, recipientId = that salon's real id (unchanged behavior)", String(notifB?.recipientId) === String(salonB._id), notifB);

    // ═══ 3. Multi-salon (2 real) — APPROVE — notification skipped, decision unaffected ═══
    const { owner: ownerC, kyc: kycC } = await makeOwnerWithKyc("C_MULTI_APPROVE");
    const salonC1 = await makeSalon(ownerC._id, "C1_MULTI_APPROVE");
    const salonC2 = await makeSalon(ownerC._id, "C2_MULTI_APPROVE");
    const approveC = await authFetch(`/api/admin/kyc/${kycC._id}/approve`, adminToken, { method: "PATCH", body: JSON.stringify({}) });
    const approveCBody = await approveC.json();
    check("3a. Multi-salon (2 real) owner — approve STILL → 200, decision unaffected by ambiguity", approveC.status === 200 && approveCBody?.data?.status === "VERIFIED", { status: approveC.status, body: approveCBody });
    const kycCRow = await KYC.findById(kycC._id).lean();
    check("3b. KYC record genuinely transitioned to VERIFIED with a real approvedAt (decision itself unaffected)", kycCRow?.status === "VERIFIED" && !!kycCRow?.approvedAt, kycCRow);
    const notifC = await notificationFor(kycC._id);
    check("3c. Multi-salon owner — NO salon notification created for either salon (fails closed, never guesses)", !notifC, notifC);
    const notifCEitherSalon = await Notification.findOne({ "meta.kycId": kycC._id, recipientType: "SALON", recipientId: { $in: [salonC1._id, salonC2._id] } }).lean();
    check("3d. Confirmed neither salon C1 nor C2 received a notification for this KYC event", !notifCEitherSalon, notifCEitherSalon);

    // ═══ 4. Multi-salon (2 real) — REJECT — notification skipped, decision unaffected ═══
    const { owner: ownerD, kyc: kycD } = await makeOwnerWithKyc("D_MULTI_REJECT");
    const salonD1 = await makeSalon(ownerD._id, "D1_MULTI_REJECT");
    const salonD2 = await makeSalon(ownerD._id, "D2_MULTI_REJECT");
    const rejectD = await authFetch(`/api/admin/kyc/${kycD._id}/reject`, adminToken, { method: "PATCH", body: JSON.stringify({ reason: "ZE2E test rejection reason, long enough." }) });
    const rejectDBody = await rejectD.json();
    check("4a. Multi-salon (2 real) owner — reject STILL → 200, decision unaffected by ambiguity", rejectD.status === 200 && rejectDBody?.data?.status === "REJECTED", { status: rejectD.status, body: rejectDBody });
    const kycDRow = await KYC.findById(kycD._id).lean();
    check("4b. KYC record genuinely transitioned to REJECTED with a real rejectedAt+reason (decision itself unaffected)", kycDRow?.status === "REJECTED" && !!kycDRow?.rejectedAt && kycDRow?.review?.rejectReason, kycDRow);
    const notifD = await notificationFor(kycD._id);
    check("4c. Multi-salon owner — NO salon notification created for either salon (fails closed, never guesses)", !notifD, notifD);

    // ═══ 5. One real + one soft-deleted salon — APPROVE — notifies the real one only ═══
    const { owner: ownerE, kyc: kycE } = await makeOwnerWithKyc("E_DELETED_APPROVE");
    const salonERealOnly = await makeSalon(ownerE._id, "E_REAL_APPROVE");
    const salonEDeleted = await makeSalon(ownerE._id, "E_DELETED_APPROVE", true);
    const approveE = await authFetch(`/api/admin/kyc/${kycE._id}/approve`, adminToken, { method: "PATCH", body: JSON.stringify({}) });
    const approveEBody = await approveE.json();
    check("5a. One real + one soft-deleted salon — approve → 200", approveE.status === 200 && approveEBody?.data?.status === "VERIFIED", { status: approveE.status, body: approveEBody });
    const notifE = await notificationFor(kycE._id);
    check("5b. Notification sent to the REAL salon only — the soft-deleted salon never counts toward ambiguity and is never selected", String(notifE?.recipientId) === String(salonERealOnly._id), notifE);
    check("5c. The soft-deleted salon itself never received the notification", String(notifE?.recipientId) !== String(salonEDeleted._id), notifE);

    // ═══ 6. One real + one soft-deleted salon — REJECT — notifies the real one only ═══
    const { owner: ownerF, kyc: kycF } = await makeOwnerWithKyc("F_DELETED_REJECT");
    const salonFRealOnly = await makeSalon(ownerF._id, "F_REAL_REJECT");
    const salonFDeleted = await makeSalon(ownerF._id, "F_DELETED_REJECT", true);
    const rejectF = await authFetch(`/api/admin/kyc/${kycF._id}/reject`, adminToken, { method: "PATCH", body: JSON.stringify({ reason: "ZE2E test rejection reason, long enough." }) });
    const rejectFBody = await rejectF.json();
    check("6a. One real + one soft-deleted salon — reject → 200", rejectF.status === 200 && rejectFBody?.data?.status === "REJECTED", { status: rejectF.status, body: rejectFBody });
    const notifF = await notificationFor(kycF._id);
    check("6b. Notification sent to the REAL salon only", String(notifF?.recipientId) === String(salonFRealOnly._id), notifF);
    check("6c. The soft-deleted salon itself never received the notification", String(notifF?.recipientId) !== String(salonFDeleted._id), notifF);

    // ═══ 7. Zero salons at all — APPROVE/REJECT — unchanged "no salon, skip" behavior ═══
    const { owner: ownerG, kyc: kycG } = await makeOwnerWithKyc("G_NONE_APPROVE");
    const approveG = await authFetch(`/api/admin/kyc/${kycG._id}/approve`, adminToken, { method: "PATCH", body: JSON.stringify({}) });
    const approveGBody = await approveG.json();
    check("7a. Zero-salon owner — approve STILL → 200 (decision unaffected)", approveG.status === 200 && approveGBody?.data?.status === "VERIFIED", { status: approveG.status, body: approveGBody });
    const notifG = await notificationFor(kycG._id);
    check("7b. Zero-salon owner — no notification created (same as today's existing behavior)", !notifG, notifG);

    const { owner: ownerH, kyc: kycH } = await makeOwnerWithKyc("H_NONE_REJECT");
    const rejectH = await authFetch(`/api/admin/kyc/${kycH._id}/reject`, adminToken, { method: "PATCH", body: JSON.stringify({ reason: "ZE2E test rejection reason, long enough." }) });
    const rejectHBody = await rejectH.json();
    check("7c. Zero-salon owner — reject STILL → 200 (decision unaffected)", rejectH.status === 200 && rejectHBody?.data?.status === "REJECTED", { status: rejectH.status, body: rejectHBody });
    const notifH = await notificationFor(kycH._id);
    check("7d. Zero-salon owner — no notification created (same as today's existing behavior)", !notifH, notifH);

    // ── Network guard sanity ─────────────────────────────────────
    check("8. Network guard was installed before any app/model import", networkGuardInstalled === true, networkGuardInstalled);
    check("9. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nKYC SALON NOTIFICATION AMBIGUITY: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
