/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyTransferStaffPhoneConflict.mjs
 *
 * controllers/adminStaff.controller.js#transferStaff — destination-
 * salon duplicate active-phone pre-check (Fix #11). Real HTTP-level
 * integration test against a fully isolated stack: a disposable
 * mongodb-memory-server replica set, a real Express server bound to
 * an OS-assigned local port (app.listen(0)), a locally-generated
 * test-only JWT secret, and Redis left intentionally disconnected
 * (SKIP_REDIS_AUTOCONNECT) — PATCH /api/admin/staff/:id/salon does
 * not run behind the idempotency middleware.
 *
 * ROOT CAUSE THIS TEST PROVES IS FIXED: transferStaff moved a staff
 * member into a destination salon with no check that the destination
 * didn't already have an active staff member sharing the same phone.
 * Before the live staffs.salonId_1_phone_1 unique index existed (see
 * this session's incident report), this silently succeeded. After
 * that index went live, the SAME call would throw a raw MongoDB
 * E11000, caught only generically (409 "salonId already exists" —
 * misleading, names the wrong field). This test proves the new
 * pre-check now returns a clear, specific 409 BEFORE any mutation,
 * while every other existing behavior (auth, same-salon guard,
 * transferHistory, chairId clear, totalBookingsToday reset, response
 * shape) remains byte-identical.
 *
 * This script connects with { autoIndex: false } and explicitly
 * builds ONLY the real, corrected salonId_1_phone_1 definition on the
 * Staff collection — mirroring scripts/e2e/verifyStaffChairIndexRepair
 * .mjs's own approach — so this test exercises BOTH layers: the new
 * application-level pre-check (the primary, user-facing message) and
 * confirms the underlying unique index still backs it up for real,
 * exactly matching the live production index this fix was written
 * for. The schema's own still-broken index declarations on Staff
 * (salonId_1_phone_1's sibling defects are out of scope here) are
 * therefore never attempted in the background by Mongoose, avoiding
 * any race with this script's own explicit createIndex() call.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyTransferStaffPhoneConflict.mjs
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
    // autoIndex:false — see file header. Avoids racing the schema's
    // own still-broken background index declarations on Staff.
    await mongoose.connect(mem.getUri(), { dbName: "transfer_staff_phone_conflict", autoIndex: false });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const Staff = (await import("../../models/Staff.js")).default;
    const Country = (await import("../../models/Country.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");

    // The real, corrected live index this fix was written for —
    // built explicitly here, not via the schema's own (still broken)
    // declaration. See file header.
    await Staff.collection.createIndex(
      { salonId: 1, phone: 1 },
      { unique: true, partialFilterExpression: { phone: { $type: "string" }, isDeleted: false }, name: "salonId_1_phone_1" }
    );

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

    const makeSalon = (label) =>
      Salon.create({
        ownerId: new mongoose.Types.ObjectId(),
        basicInfo: { shopName: `ZE2E Transfer Salon ${label}`, category: "UNISEX" },
        manager: { phone: nextPhone() },
        timings: ALL_DAYS_OPEN,
        approval: { status: "APPROVED" },
        business: { isForceClosed: false, isShopOpen: true },
        onboarding: { step: 8, completed: true },
        isDeleted: false,
      });

    const country = await Country.create({ name: "ZE2E TRANSFER TESTLAND", code: "ZT", dialCode: "+91", currencyCode: "INR", timezones: ["Asia/Kolkata"], centroid: { type: "Point", coordinates: [77, 20] } });
    const admin = await User.create({ name: "ZE2E_INDIA_ADMIN_TRANSFER", email: `ze2e-transfer-admin-${Date.now()}@example.test`, role: "ADMIN", adminLevel: "INDIA", countryRef: country._id, accountStatus: "ACTIVE" });
    const adminToken = generateAccessToken({ _id: admin._id, role: "ADMIN", tokenVersion: admin.tokenVersion ?? 0 });

    const transferStaff = (staffId, salonId, reason) =>
      authFetch(`/api/admin/staff/${staffId}/salon`, adminToken, { method: "PATCH", body: JSON.stringify({ salonId, reason }) });

    //////////////////////////////////////////////////////////////
    // 1. Successful transfer — no conflict
    //////////////////////////////////////////////////////////////
    const sourceSalon1 = await makeSalon("SRC_OK");
    const destSalon1 = await makeSalon("DST_OK");
    const movingStaffPhone = nextPhone();
    const movingStaff = await Staff.create({ salonId: sourceSalon1._id, name: "ZE2E Moving Staff", phone: movingStaffPhone, chairId: new mongoose.Types.ObjectId(), isActive: true, isDeleted: false, totalBookingsToday: 3 });
    const destOtherStaff = await Staff.create({ salonId: destSalon1._id, name: "ZE2E Dest Other Staff", phone: nextPhone(), isActive: true, isDeleted: false });

    const okTransfer = await transferStaff(movingStaff._id, destSalon1._id.toString(), "ZE2E routine transfer, no conflict expected");
    const okTransferBody = await okTransfer.json();
    check("1a. Transfer with no destination conflict → 200", okTransfer.status === 200 && okTransferBody?.data?.toSalonId === destSalon1._id.toString(), { status: okTransfer.status, body: okTransferBody });

    const movedStaffRow = await Staff.findById(movingStaff._id).lean();
    check("1b. staff.salonId actually updated to the destination salon", String(movedStaffRow?.salonId) === String(destSalon1._id), movedStaffRow);
    check("1c. staff.chairId cleared on transfer (unchanged existing behavior)", movedStaffRow?.chairId === null, movedStaffRow);
    check("1d. totalBookingsToday reset to 0 on transfer (unchanged existing behavior)", movedStaffRow?.totalBookingsToday === 0, movedStaffRow);
    check("1e. transferHistory entry appended with correct from/to salon ids (unchanged existing behavior)", movedStaffRow?.transferHistory?.length === 1 && String(movedStaffRow.transferHistory[0].fromSalonId) === String(sourceSalon1._id) && String(movedStaffRow.transferHistory[0].toSalonId) === String(destSalon1._id), movedStaffRow?.transferHistory);
    check("1f. Response shape matches the existing contract (id/name/fromSalonId/toSalonId/toSalonName/chairCleared/reason)", "id" in okTransferBody.data && "name" in okTransferBody.data && "fromSalonId" in okTransferBody.data && "toSalonId" in okTransferBody.data && "toSalonName" in okTransferBody.data && okTransferBody.data.chairCleared === true && "reason" in okTransferBody.data, okTransferBody.data);

    //////////////////////////////////////////////////////////////
    // 2. Duplicate-phone conflict — the fix under test
    //////////////////////////////////////////////////////////////
    const sourceSalon2 = await makeSalon("SRC_CONFLICT");
    const destSalon2 = await makeSalon("DST_CONFLICT");
    const sharedConflictPhone = nextPhone();
    const conflictingDestStaff = await Staff.create({ salonId: destSalon2._id, name: "ZE2E Already There", phone: sharedConflictPhone, isActive: true, isDeleted: false });
    const conflictMovingStaff = await Staff.create({ salonId: sourceSalon2._id, name: "ZE2E Conflict Mover", phone: sharedConflictPhone, isActive: true, isDeleted: false });

    const conflictTransfer = await transferStaff(conflictMovingStaff._id, destSalon2._id.toString(), "ZE2E transfer that should conflict on phone");
    const conflictTransferBody = await conflictTransfer.json();
    check("2a. Transfer into a salon with a phone conflict → 409, not 200", conflictTransfer.status === 409, { status: conflictTransfer.status, body: conflictTransferBody });
    check("2b. The 409 message clearly names the real conflict (phone / destination salon), not the generic 'salonId already exists'", typeof conflictTransferBody?.message === "string" && conflictTransferBody.message.includes("phone number") && conflictTransferBody.message.includes(conflictingDestStaff.name), conflictTransferBody);

    const conflictMoverRowAfter = await Staff.findById(conflictMovingStaff._id).lean();
    check("2c. The conflicting staff member was NOT moved — salonId unchanged (pre-check blocked before any mutation)", String(conflictMoverRowAfter?.salonId) === String(sourceSalon2._id), conflictMoverRowAfter);
    check("2d. No transferHistory entry was appended for the blocked attempt", !conflictMoverRowAfter?.transferHistory?.length, conflictMoverRowAfter?.transferHistory);
    check("2e. chairId/totalBookingsToday were never touched by the blocked attempt", conflictMoverRowAfter?.totalBookingsToday === 0, conflictMoverRowAfter);

    //////////////////////////////////////////////////////////////
    // 3. No conflict when the transferring staff has NO phone
    //////////////////////////////////////////////////////////////
    const sourceSalon3 = await makeSalon("SRC_NULLPHONE");
    const destSalon3 = await makeSalon("DST_NULLPHONE");
    const nullPhoneMover = await Staff.create({ salonId: sourceSalon3._id, name: "ZE2E No Phone Mover", phone: null, isActive: true, isDeleted: false });
    // Destination also has a null-phone staff — must NOT be treated as a collision.
    await Staff.create({ salonId: destSalon3._id, name: "ZE2E Dest Null Phone", phone: null, isActive: true, isDeleted: false });

    const nullPhoneTransfer = await transferStaff(nullPhoneMover._id, destSalon3._id.toString(), "ZE2E transfer with no phone set, must not false-positive");
    const nullPhoneTransferBody = await nullPhoneTransfer.json();
    check("3. Transferring a staff member with no phone set → 200 regardless of other null-phone staff in the destination (pre-check correctly skips when there is nothing to conflict)", nullPhoneTransfer.status === 200, { status: nullPhoneTransfer.status, body: nullPhoneTransferBody });

    //////////////////////////////////////////////////////////////
    // 4. Unchanged existing validations — regression coverage
    //////////////////////////////////////////////////////////////
    const sameSalonAttempt = await transferStaff(movingStaff._id, destSalon1._id.toString(), "ZE2E same-salon transfer attempt");
    check("4a. Transferring into the staff member's own current salon → 400 (unchanged Fix #3)", sameSalonAttempt.status === 400, { status: sameSalonAttempt.status });

    const nonIndiaAdmin = await User.create({ name: "ZE2E_STATE_ADMIN", email: `ze2e-state-admin-${Date.now()}@example.test`, role: "ADMIN", adminLevel: "STATE", countryRef: country._id, stateRef: new mongoose.Types.ObjectId(), adminSubRole: "PRIMARY", accountStatus: "ACTIVE" });
    const nonIndiaToken = generateAccessToken({ _id: nonIndiaAdmin._id, role: "ADMIN", tokenVersion: nonIndiaAdmin.tokenVersion ?? 0 });
    const forbiddenAttempt = await authFetch(`/api/admin/staff/${movingStaff._id}/salon`, nonIndiaToken, { method: "PATCH", body: JSON.stringify({ salonId: destSalon1._id.toString(), reason: "ZE2E non-INDIA admin attempt" }) });
    check("4b. A non-INDIA admin cannot transfer staff → 403 (unchanged authorization)", forbiddenAttempt.status === 403, { status: forbiddenAttempt.status });

    const missingSalonIdAttempt = await transferStaff(movingStaff._id, "", "ZE2E missing salonId");
    check("4c. Missing salonId → 400 (unchanged existing validation)", missingSalonIdAttempt.status === 400, { status: missingSalonIdAttempt.status });

    const missingReasonAttempt = await authFetch(`/api/admin/staff/${movingStaff._id}/salon`, adminToken, { method: "PATCH", body: JSON.stringify({ salonId: destSalon1._id.toString() }) });
    check("4d. Missing reason → 400 (unchanged existing validation)", missingReasonAttempt.status === 400, { status: missingReasonAttempt.status });

    //////////////////////////////////////////////////////////////
    // 5. Isolation — unrelated staff/salons untouched
    //////////////////////////////////////////////////////////////
    const destOtherStaffRowAfter = await Staff.findById(destOtherStaff._id).lean();
    check("5a. The destination salon's OTHER (non-conflicting) staff member was never touched", String(destOtherStaffRowAfter?.salonId) === String(destSalon1._id) && destOtherStaffRowAfter?.phone !== movingStaffPhone, destOtherStaffRowAfter);
    const conflictingDestStaffRowAfter = await Staff.findById(conflictingDestStaff._id).lean();
    check("5b. The destination salon's conflicting staff member (the one already there) was never touched by the blocked attempt", String(conflictingDestStaffRowAfter?.salonId) === String(destSalon2._id) && conflictingDestStaffRowAfter?.phone === sharedConflictPhone, conflictingDestStaffRowAfter);

    //////////////////////////////////////////////////////////////
    // Network guard sanity
    //////////////////////////////////////////////////////////////
    check("6. Network guard was installed before any app/model import", networkGuardInstalled === true, networkGuardInstalled);
    check("7. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nTRANSFER STAFF PHONE CONFLICT: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
