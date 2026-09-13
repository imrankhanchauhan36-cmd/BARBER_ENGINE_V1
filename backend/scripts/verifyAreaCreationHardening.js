/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAreaCreationHardening.js
 *
 * AREA-2.1 — LIVE, real-HTTP, real-DB verification for the hardened
 * createArea master-data creation path. Same precedent and style as
 * every other verification script in this repo (e.g.
 * verifyFieldAgentApproval.js) — real Express app, real signed JWTs,
 * real MongoDB Atlas, no mocks.
 *
 * All fixtures (State/District/City names prefixed "ZTEST_AREA221_",
 * admin phones 9999907xxx) are hard-deleted in cleanup. AREA_CREATED
 * audit events written against fixture Areas are preserved (same
 * append-only precedent as every other audit collection in this
 * codebase) — they reference fixture Area ids that no longer exist,
 * exactly like every prior verify script's audit trail.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAreaCreationHardening.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];

const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    results.push(`✅ ${name}`);
  } else {
    fail += 1;
    results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
};

let phoneSeq = 0;
const nextPhone = () => `9999907${String(phoneSeq++).padStart(3, "0")}`;

const NAME_PREFIX = "ZTEST_AREA221_";
const createdUserIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];

const runStartedAt = new Date();

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });

  // ── Pre-flight cleanup (in case a prior run crashed mid-way) ───────
  const preCleanup = async () => {
    const staleUsers = await User.find({ phone: { $regex: /^9999907\d{3}$/ } }).select("_id").lean();
    if (staleUsers.length) await User.deleteMany({ _id: { $in: staleUsers.map(u => u._id) } });
    await Area.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await City.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await District.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await State.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
  };
  await preCleanup();

  try {
    try {
    // ── FIXTURE GEOGRAPHY ────────────────────────────────────────────
    const country = await Country.findOne({}).lean();
    check("Real Country fixture exists to anchor test States", !!country);

    // State.code must match /^[A-Z]{2,3}$/ (letters only) and be
    // unique per countryRef among non-deleted States — derive it from
    // a monotonic counter (spreadsheet-column style) rather than the
    // suffix text, so it can never collide or contain a digit.
    let stateCodeSeq = 0;
    const nextStateCode = () => {
      let n = stateCodeSeq++;
      let code = "";
      do {
        code = String.fromCharCode(65 + (n % 26)) + code;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      return ("ZZ" + code).slice(-2); // always exactly 2 uppercase letters
    };

    const mkState = async (suffix, { isActive = true, isDeleted = false } = {}) => {
      const s = await State.create({
        name: `${NAME_PREFIX}STATE_${suffix}`,
        code: nextStateCode(),
        type: "STATE",
        countryRef: country._id,
        geo: { type: "Point", coordinates: [77.0, 28.0] },
        isActive,
        isDeleted,
      });
      createdStateIds.push(s._id);
      return s;
    };

    let districtCodeSeq = 0;
    const mkDistrict = async (suffix, stateRef, { isActive = true, isDeleted = false } = {}) => {
      const d = await District.create({
        name: `${NAME_PREFIX}DISTRICT_${suffix}`,
        code: `ZD${districtCodeSeq++}`,
        countryRef: country._id,
        stateRef,
        isActive,
        isDeleted,
      });
      createdDistrictIds.push(d._id);
      return d;
    };

    const mkCity = async (suffix, districtRef, stateRef, { isActive = true, isDeleted = false } = {}) => {
      const c = await City.create({
        name: `${NAME_PREFIX}CITY_${suffix}`,
        districtRef,
        stateRef,
        isActive,
        isDeleted,
      });
      createdCityIds.push(c._id);
      return c;
    };

    // World V — fully valid, active chain (used for happy-path tests)
    const stateV = await mkState("V");
    const districtV = await mkDistrict("V", stateV._id);
    const cityV = await mkCity("V", districtV._id, stateV._id);

    // World for inactive/deleted-parent rejection tests
    const stateInactive = await mkState("INACTIVE", { isActive: false });
    const districtUnderInactiveState = await mkDistrict("UNDER_INACTIVE_STATE", stateInactive._id);
    const cityUnderInactiveState = await mkCity("UNDER_INACTIVE_STATE", districtUnderInactiveState._id, stateInactive._id);

    const stateForInactiveDistrict = await mkState("FOR_INACTIVE_DISTRICT");
    const districtInactive = await mkDistrict("INACTIVE", stateForInactiveDistrict._id, { isActive: false });
    const cityUnderInactiveDistrict = await mkCity("UNDER_INACTIVE_DISTRICT", districtInactive._id, stateForInactiveDistrict._id);

    const stateForInactiveCity = await mkState("FOR_INACTIVE_CITY");
    const districtForInactiveCity = await mkDistrict("FOR_INACTIVE_CITY", stateForInactiveCity._id);
    const cityInactive = await mkCity("INACTIVE", districtForInactiveCity._id, stateForInactiveCity._id, { isActive: false });

    const stateDeleted = await mkState("DELETED", { isDeleted: true });
    const districtUnderDeletedState = await mkDistrict("UNDER_DELETED_STATE", stateDeleted._id);
    const cityUnderDeletedState = await mkCity("UNDER_DELETED_STATE", districtUnderDeletedState._id, stateDeleted._id);

    // World M — a second, unrelated State/District/City pair, used to
    // construct ancestor-mismatch payloads against World V.
    const stateM = await mkState("M");
    const districtM = await mkDistrict("M", stateM._id);
    const cityM = await mkCity("M", districtM._id, stateM._id);

    // ── FIXTURE ADMIN USERS ──────────────────────────────────────────
    let adminEmailSeq = 0;
    const mkAdmin = async (adminLevel, extra = {}) => {
      const u = await User.create({
        name: `${NAME_PREFIX}ADMIN_${adminLevel}`,
        phone: nextPhone(),
        email: `ztest.area221.admin${adminEmailSeq++}@example.invalid`,
        role: "ADMIN",
        adminLevel,
        countryRef: country._id,
        adminSubRole: "PRIMARY",
        isActive: true,
        isDeleted: false,
        accountStatus: "ACTIVE",
        ...extra,
      });
      createdUserIds.push(u._id);
      return u;
    };

    // Only one INDIA admin may ever exist (User.js partial unique
    // index on {role:"ADMIN", adminLevel:"INDIA"}) — reuse the real,
    // pre-existing one (same precedent as verifyFieldAgentApproval.js)
    // rather than attempting to create a second.
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
    check("Real INDIA admin fixture exists (pre-existing account)", !!indiaAdmin);

    const stateAdminV = await mkAdmin("STATE", { stateRef: stateV._id });
    const districtAdminV = await mkAdmin("DISTRICT", { stateRef: stateV._id, districtRef: districtV._id });
    const stateAdminM = await mkAdmin("STATE", { stateRef: stateM._id }); // used for cross-scope forbidden test
    const fieldAgentUser = await User.create({
      name: `${NAME_PREFIX}FIELD_AGENT`,
      phone: nextPhone(),
      role: "FIELD_AGENT",
      isActive: true,
      isDeleted: false,
      accountStatus: "ACTIVE",
    });
    createdUserIds.push(fieldAgentUser._id);
    const plainUser = await User.create({
      name: `${NAME_PREFIX}PLAIN_USER`,
      phone: nextPhone(),
      role: "USER",
      isActive: true,
      isDeleted: false,
      accountStatus: "ACTIVE",
    });
    createdUserIds.push(plainUser._id);

    const tokenFor = (u) => generateAccessToken({ _id: u._id, role: u.role, adminLevel: u.adminLevel, tokenVersion: u.tokenVersion ?? 0 });
    const indiaToken = tokenFor(indiaAdmin);
    const stateVToken = tokenFor(stateAdminV);
    const districtVToken = tokenFor(districtAdminV);
    const stateMToken = tokenFor(stateAdminM);
    const fieldAgentToken = tokenFor(fieldAgentUser);
    const plainUserToken = tokenFor(plainUser);

    // location.routes.js also defines this exact handler but is never
    // mounted in app.js — the only live route is admin.routes.js's
    // /areas, mounted at /api/admin with `protect` applied at the
    // router-mount level (app.js:372).
    const createAreaReq = (token, body) =>
      authFetch("/api/admin/areas", token, { method: "POST", body: JSON.stringify(body) });

    // ── A. Valid India Admin create ──────────────────────────────────
    {
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_A`, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
      });
      const json = await res.json();
      check("A. India Admin can create a valid Area", res.status === 200 || res.status === 201, `status=${res.status} body=${JSON.stringify(json)}`);
      if (json?.data?.id) createdAreaIds.push(json.data.id);
      check("S. Created Area has sourceType MANUAL", json?.data?.sourceType === "MANUAL", JSON.stringify(json?.data));
    }

    // ── B. Valid State Admin create in own State ─────────────────────
    {
      const res = await createAreaReq(stateVToken, {
        name: `${NAME_PREFIX}AREA_B`, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
      });
      const json = await res.json();
      check("B. State Admin can create Area in own State", res.status === 200 || res.status === 201, `status=${res.status} body=${JSON.stringify(json)}`);
      if (json?.data?.id) createdAreaIds.push(json.data.id);
    }

    // State Admin attempting to create OUTSIDE own state → forbidden
    // (existing scope authorization — reconfirmed, not new behavior)
    {
      const res = await createAreaReq(stateVToken, {
        name: `${NAME_PREFIX}AREA_B_CROSS`, cityId: cityM._id, districtId: districtM._id, stateId: stateM._id,
      });
      check("X. State Admin cannot create Area outside own State (scope preserved)", res.status === 403, `status=${res.status}`);
    }

    // ── C. Valid District Admin create in own District ───────────────
    {
      const res = await createAreaReq(districtVToken, {
        name: `${NAME_PREFIX}AREA_C`, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
      });
      const json = await res.json();
      check("C. District Admin can create Area in own District", res.status === 200 || res.status === 201, `status=${res.status} body=${JSON.stringify(json)}`);
      if (json?.data?.id) createdAreaIds.push(json.data.id);
    }

    // ── D. Unauthorized Field Agent create → 403 ──────────────────────
    {
      const res = await createAreaReq(fieldAgentToken, {
        name: `${NAME_PREFIX}AREA_D`, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
      });
      check("D. FIELD_AGENT cannot create Area (403)", res.status === 403, `status=${res.status}`);
    }

    // ── E. Unauthorized plain User create → 403 ───────────────────────
    {
      const res = await createAreaReq(plainUserToken, {
        name: `${NAME_PREFIX}AREA_E`, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
      });
      check("E. Plain USER cannot create Area (403)", res.status === 403, `status=${res.status}`);
    }

    // ── F. Missing/non-existent State → reject ────────────────────────
    {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_F`, cityId: cityV._id, districtId: districtV._id, stateId: fakeId,
      });
      check("F. Non-existent State is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── G. Missing/non-existent District → reject ─────────────────────
    {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_G`, cityId: cityV._id, districtId: fakeId, stateId: stateV._id,
      });
      check("G. Non-existent District is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── H. Missing/non-existent City → reject ─────────────────────────
    {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_H`, cityId: fakeId, districtId: districtV._id, stateId: stateV._id,
      });
      check("H. Non-existent City is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── I. Inactive State → reject ─────────────────────────────────────
    {
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_I`, cityId: cityUnderInactiveState._id, districtId: districtUnderInactiveState._id, stateId: stateInactive._id,
      });
      check("I. Inactive State is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── J. Inactive District → reject ──────────────────────────────────
    {
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_J`, cityId: cityUnderInactiveDistrict._id, districtId: districtInactive._id, stateId: stateForInactiveDistrict._id,
      });
      check("J. Inactive District is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── K. Inactive City → reject ───────────────────────────────────────
    {
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_K`, cityId: cityInactive._id, districtId: districtForInactiveCity._id, stateId: stateForInactiveCity._id,
      });
      check("K. Inactive City is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── L. Deleted parent (State) → reject ───────────────────────────────
    {
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_L`, cityId: cityUnderDeletedState._id, districtId: districtUnderDeletedState._id, stateId: stateDeleted._id,
      });
      check("L. Deleted-parent State is rejected", res.status === 404 || res.status === 400, `status=${res.status}`);
    }

    // ── M. District/State ancestor mismatch → reject ─────────────────────
    {
      // districtV really belongs to stateV — supply stateM instead
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_M`, cityId: cityV._id, districtId: districtV._id, stateId: stateM._id,
      });
      check("M. District/State ancestor mismatch is rejected", res.status === 400, `status=${res.status}`);
    }

    // ── N. City/District ancestor mismatch → reject ──────────────────────
    {
      // cityV really belongs to districtV — supply districtM instead
      const res = await createAreaReq(indiaToken, {
        name: `${NAME_PREFIX}AREA_N`, cityId: cityV._id, districtId: districtM._id, stateId: stateM._id,
      });
      check("N. City/District ancestor mismatch is rejected", res.status === 400, `status=${res.status}`);
    }

    // ── O. Duplicate same city/name → deterministic conflict ─────────────
    {
      const dupName = `${NAME_PREFIX}AREA_DUP`;
      const first = await createAreaReq(indiaToken, { name: dupName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id });
      const firstJson = await first.json();
      if (firstJson?.data?.id) createdAreaIds.push(firstJson.data.id);
      const second = await createAreaReq(indiaToken, { name: dupName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id });
      const secondJson = await second.json();
      check("O. Duplicate same city/name returns deterministic conflict", second.status === 409, `status=${second.status} body=${JSON.stringify(secondJson)}`);
      check("Q. No raw E11000 leaks in duplicate response", !JSON.stringify(secondJson).includes("E11000"), JSON.stringify(secondJson));
    }

    // ── AREA-1 LOCKED RULE CHECK: same name, DIFFERENT cities, must
    // both succeed (AREA-1 Decision 12/16: "same locality name across
    // different cities is allowed" — explicitly NOT a duplicate).
    {
      const crossCityName = `${NAME_PREFIX}AREA_CROSS_CITY`;
      const first = await createAreaReq(indiaToken, { name: crossCityName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id });
      const firstJson = await first.json();
      if (firstJson?.data?.id) createdAreaIds.push(firstJson.data.id);
      const second = await createAreaReq(indiaToken, { name: crossCityName, cityId: cityM._id, districtId: districtM._id, stateId: stateM._id });
      const secondJson = await second.json();
      if (secondJson?.data?.id) createdAreaIds.push(secondJson.data.id);
      check(
        "AREA-1 LOCK: same Area name in two different cities both succeed (not treated as duplicates)",
        (first.status === 200 || first.status === 201) && (second.status === 200 || second.status === 201),
        `first=${first.status} second=${second.status} secondBody=${JSON.stringify(secondJson)}`
      );
    }

    // ── P/Q. Real concurrent duplicate create ─────────────────────────────
    {
      const concurrentName = `${NAME_PREFIX}AREA_CONCURRENT`;
      const [r1, r2] = await Promise.all([
        createAreaReq(indiaToken, { name: concurrentName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id }),
        createAreaReq(indiaToken, { name: concurrentName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id }),
      ]);
      const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
      const statuses = [r1.status, r2.status].sort();
      const successCount = statuses.filter((s) => s === 200 || s === 201).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      check("P. Concurrent duplicate create yields exactly one success", successCount === 1, `statuses=${statuses}`);
      check("P. Concurrent duplicate create yields exactly one conflict", conflictCount === 1, `statuses=${statuses}`);
      check("Q. No raw E11000 leaks in either concurrent response", ![j1, j2].some((j) => JSON.stringify(j).includes("E11000")), JSON.stringify([j1, j2]));

      const winnerId = j1?.data?.id || j2?.data?.id;
      if (winnerId) createdAreaIds.push(winnerId);

      const docCount = await Area.countDocuments({ cityRef: cityV._id, normalizedName: concurrentName.toLowerCase() });
      check("P. Exactly one Area document exists in DB after concurrent race", docCount === 1, `docCount=${docCount}`);
    }

    // ── R/W. Audit created exactly once, per successful creation ──────────
    {
      const auditableName = `${NAME_PREFIX}AREA_AUDIT`;
      const res = await createAreaReq(indiaToken, { name: auditableName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id });
      const json = await res.json();
      if (json?.data?.id) createdAreaIds.push(json.data.id);

      // logAdminAction is fire-and-forget — give it a moment to land.
      await new Promise((r) => setTimeout(r, 300));

      const auditCount = await AdminAuditLog.countDocuments({ targetType: "AREA", targetId: json?.data?.id });
      check("R. Exactly one AREA_CREATED audit event exists for the created Area", auditCount === 1, `auditCount=${auditCount}`);

      const auditDoc = await AdminAuditLog.findOne({ targetType: "AREA", targetId: json?.data?.id }).lean();
      check("R. Audit action is AREA_CREATED", auditDoc?.action === "AREA_CREATED", auditDoc?.action);
      check("R. Audit meta records MANUAL sourceType", auditDoc?.meta?.sourceType === "MANUAL", JSON.stringify(auditDoc?.meta));

      // No audit for the duplicate-rejected creation above
      // Scoped to this run's own window — AdminAuditLog is append-only
      // by design (see script header), so an unscoped count would
      // accumulate across repeated script runs and is not itself a
      // defect.
      const dupAuditCount = await AdminAuditLog.countDocuments({
        action: "AREA_CREATED",
        "meta.name": `${NAME_PREFIX}AREA_DUP`,
        createdAt: { $gte: runStartedAt },
      });
      check("Duplicate-key rejection does not produce a duplicate audit event", dupAuditCount === 1, `dupAuditCount=${dupAuditCount}`);
    }

    // ── T. Client cannot inject provenance via createArea body ────────────
    {
      const injectName = `${NAME_PREFIX}AREA_INJECT`;
      const res = await createAreaReq(indiaToken, {
        name: injectName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
        sourceType: "COMMERCIAL", sourceExternalId: "HACKED_ID", sourceRecordStatus: "SUPERSEDED",
      });
      const json = await res.json();
      if (json?.data?.id) createdAreaIds.push(json.data.id);
      const stored = await Area.findById(json?.data?.id).lean();
      check("T. Client-supplied sourceType is ignored (stays MANUAL)", stored?.sourceType === "MANUAL", stored?.sourceType);
      check("T. Client-supplied sourceExternalId is ignored (stays null)", stored?.sourceExternalId == null, stored?.sourceExternalId);
      check("T. Client-supplied sourceRecordStatus is ignored (stays null)", stored?.sourceRecordStatus == null, stored?.sourceRecordStatus);
    }

    // ── U/V. Client cannot inject lifecycle/audit fields ───────────────────
    {
      const injectName = `${NAME_PREFIX}AREA_INJECT2`;
      const otherUserId = new mongoose.Types.ObjectId();
      const res = await createAreaReq(indiaToken, {
        name: injectName, cityId: cityV._id, districtId: districtV._id, stateId: stateV._id,
        isActive: false, isDeleted: true, deletedAt: new Date(), createdBy: otherUserId, updatedBy: otherUserId,
      });
      const json = await res.json();
      if (json?.data?.id) createdAreaIds.push(json.data.id);
      const stored = await Area.findById(json?.data?.id).lean();
      check("U. Client-supplied isActive:false is ignored (stays true)", stored?.isActive === true, stored?.isActive);
      check("U. Client-supplied isDeleted:true is ignored (stays false)", stored?.isDeleted === false, stored?.isDeleted);
      check("V. Client-supplied createdBy is ignored (stays real actor)", String(stored?.createdBy) === String(indiaAdmin._id), stored?.createdBy);
    }

    // ── W. updateArea cannot mutate protected provenance ─────────────────
    {
      const target = await Area.findOne({ name: `${NAME_PREFIX}AREA_A` }).lean();
      const res = await authFetch(`/api/admin/areas/${target._id}`, indiaToken, {
        method: "PATCH",
        body: JSON.stringify({ name: `${NAME_PREFIX}AREA_A_RENAMED`, sourceType: "COMMERCIAL", sourceExternalId: "HACKED" }),
      });
      const json = await res.json();
      const stored = await Area.findById(target._id).lean();
      check("W. updateArea succeeds for whitelisted field (name)", res.status === 200, `status=${res.status} body=${JSON.stringify(json)}`);
      check("W. updateArea cannot mutate sourceType (no field on model accepts client input)", stored?.sourceType === "MANUAL", stored?.sourceType);
      check("W. updateArea cannot mutate sourceExternalId", stored?.sourceExternalId == null, stored?.sourceExternalId);
    }
    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    // ── CLEANUP ────────────────────────────────────────────────────────
    if (createdAreaIds.length) await Area.deleteMany({ _id: { $in: createdAreaIds } });
    await Area.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } }); // catch any stragglers by name
    if (createdCityIds.length) await City.deleteMany({ _id: { $in: createdCityIds } });
    if (createdDistrictIds.length) await District.deleteMany({ _id: { $in: createdDistrictIds } });
    if (createdStateIds.length) await State.deleteMany({ _id: { $in: createdStateIds } });
    if (createdUserIds.length) await User.deleteMany({ _id: { $in: createdUserIds } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed`);

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
