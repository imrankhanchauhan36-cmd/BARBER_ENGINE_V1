/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAreaServiceability.js
 *
 * AREA-2.4.1 — LIVE, real-HTTP, real-DB verification for
 * AreaServiceability (model + hardened admin CRUD). Same precedent as
 * every other verify script this session: real Express app, real
 * signed JWTs, real MongoDB Atlas, no mocks. All fixtures prefixed
 * "ZTEST_AREA241_" / phones 9999910xxx, hard-deleted in cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAreaServiceability.js
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
import AreaServiceability from "../models/AreaServiceability.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) { pass += 1; results.push(`✅ ${name}`); }
  else { fail += 1; results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`); }
};

const NAME_PREFIX = "ZTEST_AREA241_";
let phoneSeq = 0;
const nextPhone = () => `9999910${String(phoneSeq++).padStart(3, "0")}`;

const createdUserIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const createdServiceabilityIds = [];

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

  const preCleanup = async () => {
    const staleUsers = await User.find({ phone: { $regex: /^9999910\d{3}$/ } }).select("_id").lean();
    if (staleUsers.length) await User.deleteMany({ _id: { $in: staleUsers.map((u) => u._id) } });
    const staleAreas = await Area.find({ name: { $regex: `^${NAME_PREFIX}` } }).select("_id").lean();
    if (staleAreas.length) {
      await AreaServiceability.deleteMany({ areaRef: { $in: staleAreas.map((a) => a._id) } });
      await Area.deleteMany({ _id: { $in: staleAreas.map((a) => a._id) } });
    }
    await City.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await District.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await State.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
  };
  await preCleanup();

  try {
    try {
      const country = await Country.findOne({}).lean();
      check("Real Country fixture exists", !!country);

      let stateCodeSeq = 0;
      const nextStateCode = () => {
        let n = stateCodeSeq++, code = "";
        do { code = String.fromCharCode(65 + (n % 26)) + code; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return ("ZZ" + code).slice(-2);
      };
      const mkState = async (suffix, opts = {}) => {
        const s = await State.create({ name: `${NAME_PREFIX}STATE_${suffix}`, code: nextStateCode(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false, ...opts });
        createdStateIds.push(s._id); return s;
      };
      let districtCodeSeq = 0;
      const mkDistrict = async (suffix, stateRef, opts = {}) => {
        const d = await District.create({ name: `${NAME_PREFIX}DISTRICT_${suffix}`, code: `ZD${districtCodeSeq++}`, countryRef: country._id, stateRef, isActive: true, isDeleted: false, ...opts });
        createdDistrictIds.push(d._id); return d;
      };
      const mkCity = async (suffix, districtRef, stateRef, opts = {}) => {
        const c = await City.create({ name: `${NAME_PREFIX}CITY_${suffix}`, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdCityIds.push(c._id); return c;
      };
      const mkArea = async (suffix, cityRef, districtRef, stateRef, opts = {}) => {
        const a = await Area.create({ name: `${NAME_PREFIX}AREA_${suffix}`, cityRef, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdAreaIds.push(a._id); return a;
      };

      const stateV = await mkState("V");
      const districtV = await mkDistrict("V", stateV._id);
      const cityV = await mkCity("V", districtV._id, stateV._id);
      const areaV = await mkArea("V", cityV._id, districtV._id, stateV._id);
      const areaV2 = await mkArea("V2", cityV._id, districtV._id, stateV._id);
      const areaInactive = await mkArea("INACTIVE", cityV._id, districtV._id, stateV._id, { isActive: false });
      const areaDeleted = await mkArea("DELETED", cityV._id, districtV._id, stateV._id, { isDeleted: true });

      // Second, unrelated state — for cross-scope authorization tests
      const stateM = await mkState("M");
      const districtM = await mkDistrict("M", stateM._id);
      const cityM = await mkCity("M", districtM._id, stateM._id);
      const areaM = await mkArea("M", cityM._id, districtM._id, stateM._id);

      const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists", !!indiaAdmin);
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      let adminEmailSeq = 0;
      const mkAdmin = async (adminLevel, extra = {}) => {
        const u = await User.create({
          name: `${NAME_PREFIX}ADMIN_${adminLevel}`, phone: nextPhone(),
          email: `ztest.area241.admin${adminEmailSeq++}@example.invalid`,
          role: "ADMIN", adminLevel, countryRef: country._id, adminSubRole: "PRIMARY",
          isActive: true, isDeleted: false, accountStatus: "ACTIVE", ...extra,
        });
        createdUserIds.push(u._id); return u;
      };
      const stateAdminV = await mkAdmin("STATE", { stateRef: stateV._id });
      const districtAdminV = await mkAdmin("DISTRICT", { stateRef: stateV._id, districtRef: districtV._id });
      const stateAdminM = await mkAdmin("STATE", { stateRef: stateM._id });

      const fieldAgentUser = await User.create({ name: `${NAME_PREFIX}FA`, phone: nextPhone(), email: "ztest.area241.fa@example.invalid", role: "FIELD_AGENT", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(fieldAgentUser._id);
      const plainUser = await User.create({ name: `${NAME_PREFIX}USER`, phone: nextPhone(), email: "ztest.area241.user@example.invalid", role: "USER", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(plainUser._id);

      const tokenFor = (u) => generateAccessToken({ _id: u._id, role: u.role, adminLevel: u.adminLevel, tokenVersion: u.tokenVersion ?? 0 });
      const stateVToken = tokenFor(stateAdminV);
      const districtVToken = tokenFor(districtAdminV);
      const stateMToken = tokenFor(stateAdminM);
      const fieldAgentToken = tokenFor(fieldAgentUser);
      const plainUserToken = tokenFor(plainUser);

      const configure = (token, areaId, body) => authFetch(`/api/admin/areas/${areaId}/serviceability`, token, { method: "POST", body: JSON.stringify(body) });
      const transition = (token, areaId, body) => authFetch(`/api/admin/areas/${areaId}/serviceability`, token, { method: "PATCH", body: JSON.stringify(body) });
      const readSvc = (token, areaId) => authFetch(`/api/admin/areas/${areaId}/serviceability`, token, { method: "GET" });

      // ── 1/8. Model validation + fail-closed default (NOT_CONFIGURED) ──
      {
        const res = await readSvc(indiaToken, areaV._id);
        const json = await res.json();
        check("1. Read before configuration returns NOT_CONFIGURED", json?.data?.status === "NOT_CONFIGURED", JSON.stringify(json?.data));
        check("9. Fail-closed: NOT_CONFIGURED -> isCurrentlyServiceable=false", json?.data?.isCurrentlyServiceable === false, json?.data);
      }

      // ── 2. Area existence validation ──
      {
        const fakeId = new mongoose.Types.ObjectId();
        const res = await configure(indiaToken, fakeId, {});
        check("2. Configuring a non-existent Area is rejected", res.status === 404, res.status);
      }

      // ── Configure (create) — happy path ──
      let svcId;
      {
        const res = await configure(indiaToken, areaV._id, { reason: "initial rollout config" });
        const json = await res.json();
        check("Configure creates PENDING serviceability", res.status === 200 && json?.data?.status === "PENDING", JSON.stringify(json));
        svcId = json?.data?.id;
        if (svcId) createdServiceabilityIds.push(svcId);
        check("9. PENDING -> isCurrentlyServiceable=false", json?.data?.isCurrentlyServiceable === false);
      }

      // ── 3. Duplicate areaRef prevention ──
      {
        const res = await configure(indiaToken, areaV._id, {});
        check("3. Duplicate configure for the same Area is rejected", res.status === 409, res.status);
        const count = await AreaServiceability.countDocuments({ areaRef: areaV._id });
        check("3. Exactly one serviceability document exists for the Area", count === 1, count);
      }

      // ── 4/5. Valid + invalid status transitions ──
      {
        const badRes = await transition(indiaToken, areaV._id, { targetStatus: "PAUSED", reason: "x" });
        check("5. PENDING -> PAUSED is rejected (invalid transition)", badRes.status === 409, badRes.status);

        const goodRes = await transition(indiaToken, areaV._id, { targetStatus: "ACTIVE", reason: "verified and launching" });
        const goodJson = await goodRes.json();
        check("4. PENDING -> ACTIVE succeeds", goodRes.status === 200 && goodJson?.data?.status === "ACTIVE", JSON.stringify(goodJson));

        const pauseRes = await transition(indiaToken, areaV._id, { targetStatus: "PAUSED", reason: "temporary pause" });
        check("4. ACTIVE -> PAUSED succeeds", pauseRes.status === 200, pauseRes.status);

        const reactivateRes = await transition(indiaToken, areaV._id, { targetStatus: "ACTIVE", reason: "resume" });
        check("4. PAUSED -> ACTIVE succeeds", reactivateRes.status === 200, reactivateRes.status);

        const retireRes = await transition(indiaToken, areaV._id, { targetStatus: "RETIRED", reason: "permanently retiring" });
        check("4. ACTIVE -> RETIRED succeeds", retireRes.status === 200, retireRes.status);

        const reactivateAfterRetire = await transition(indiaToken, areaV._id, { targetStatus: "ACTIVE", reason: "try to revive" });
        check("21. RETIRED -> ACTIVE is rejected (no reactivation path)", reactivateAfterRetire.status === 409, reactivateAfterRetire.status);
      }

      // ── 6/7. Effective date validation, future-dated, expired ──
      {
        const areaEff = await mkArea("EFFDATE", cityV._id, districtV._id, stateV._id);
        const cfgRes = await configure(indiaToken, areaEff._id, {});
        const cfgJson = await cfgRes.json();
        if (cfgJson?.data?.id) createdServiceabilityIds.push(cfgJson.data.id);

        const badWindow = await transition(indiaToken, areaEff._id, {
          targetStatus: "ACTIVE", reason: "x",
          effectiveFrom: "2027-01-01T00:00:00.000Z", effectiveUntil: "2026-01-01T00:00:00.000Z",
        });
        check("6. effectiveUntil before effectiveFrom is rejected", badWindow.status >= 400, badWindow.status);

        // Future-dated activation
        const futureFrom = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); // +30 days
        const futureRes = await transition(indiaToken, areaEff._id, { targetStatus: "ACTIVE", reason: "future launch", effectiveFrom: futureFrom });
        const futureJson = await futureRes.json();
        check("7. Future-dated ACTIVE is not currently serviceable", futureRes.status === 200 && futureJson?.data?.isCurrentlyServiceable === false, JSON.stringify(futureJson?.data));

        // Expired window
        const areaExp = await mkArea("EXPIRED", cityV._id, districtV._id, stateV._id);
        const cfgExp = await configure(indiaToken, areaExp._id, {});
        const cfgExpJson = await cfgExp.json();
        if (cfgExpJson?.data?.id) createdServiceabilityIds.push(cfgExpJson.data.id);
        const pastUntil = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(); // -1 day
        const expiredRes = await transition(indiaToken, areaExp._id, { targetStatus: "ACTIVE", reason: "test", effectiveUntil: pastUntil });
        const expiredJson = await expiredRes.json();
        check("7. Expired ACTIVE (effectiveUntil in the past) is not currently serviceable", expiredRes.status === 200 && expiredJson?.data?.isCurrentlyServiceable === false, JSON.stringify(expiredJson?.data));
      }

      // ── 10/11/12/13. Authorization ──
      {
        const areaAuthz = await mkArea("AUTHZ", cityV._id, districtV._id, stateV._id);

        const indiaRes = await configure(indiaToken, areaAuthz._id, {});
        check("10. INDIA admin can configure", indiaRes.status === 200);
        const indiaJson = await indiaRes.json();
        if (indiaJson?.data?.id) createdServiceabilityIds.push(indiaJson.data.id);

        const stateWriteRes = await configure(stateVToken, cityM._id, {}); // irrelevant id, just checking gate
        // STATE admin write is disallowed entirely (INDIA-only) regardless of area
        const stateWriteRes2 = await configure(stateVToken, areaM._id, {});
        check("11. STATE admin cannot write serviceability (INDIA-only V1 policy)", stateWriteRes2.status === 403, stateWriteRes2.status);

        const stateReadOwn = await readSvc(stateVToken, areaAuthz._id);
        check("11. STATE admin can read within own state scope", stateReadOwn.status === 200, stateReadOwn.status);

        const stateReadCross = await readSvc(stateMToken, areaAuthz._id);
        check("11. STATE admin cannot read outside own state scope", stateReadCross.status === 403, stateReadCross.status);

        const districtReadOwn = await readSvc(districtVToken, areaAuthz._id);
        check("11. DISTRICT admin can read within own district scope", districtReadOwn.status === 200, districtReadOwn.status);

        const faRes = await configure(fieldAgentToken, areaAuthz._id, {});
        check("12. FIELD_AGENT cannot configure (403)", faRes.status === 403, faRes.status);
        const faTransRes = await transition(fieldAgentToken, areaAuthz._id, { targetStatus: "ACTIVE", reason: "x" });
        check("12. FIELD_AGENT cannot transition (403)", faTransRes.status === 403, faTransRes.status);
        const faReadRes = await readSvc(fieldAgentToken, areaAuthz._id);
        check("12. FIELD_AGENT cannot even read (403, no admin level)", faReadRes.status === 403, faReadRes.status);

        const userRes = await configure(plainUserToken, areaAuthz._id, {});
        check("13. Plain USER cannot configure (403)", userRes.status === 403, userRes.status);
      }

      // ── 14/15/16. IDOR, body injection, Mongo operator injection ──
      {
        const areaInj = await mkArea("INJECT", cityV._id, districtV._id, stateV._id);
        const injRes = await configure(indiaToken, areaInj._id, {
          areaRef: new mongoose.Types.ObjectId().toString(),
          status: "ACTIVE",
          updatedBy: new mongoose.Types.ObjectId().toString(),
          reason: "trying to inject",
        });
        check("15/16. Injected areaRef/status/updatedBy fields are rejected (400, unknown(false))", injRes.status === 400, injRes.status);

        const opInj = await configure(indiaToken, areaInj._id, { reason: { "$ne": null } });
        check("16. Mongo-operator-shaped reason value is rejected", opInj.status === 400, opInj.status);

        // 14. IDOR — cross-state admin cannot act on an area outside scope via read (write already INDIA-only)
        const idorRes = await readSvc(stateMToken, areaInj._id);
        check("14. IDOR: cross-state STATE admin cannot read another state's Area serviceability", idorRes.status === 403, idorRes.status);
      }

      // ── 17/18. Audit creation + no false audit on failure ──
      {
        const areaAudit = await mkArea("AUDIT", cityV._id, districtV._id, stateV._id);
        const res = await configure(indiaToken, areaAudit._id, { reason: "audit test" });
        const json = await res.json();
        if (json?.data?.id) createdServiceabilityIds.push(json.data.id);

        await new Promise((r) => setTimeout(r, 300));
        const auditCount = await AdminAuditLog.countDocuments({
          action: "AREA_SERVICEABILITY_STATUS_CHANGED", targetId: json?.data?.id, createdAt: { $gte: runStartedAt },
        });
        check("17. Exactly one audit event for the successful configure", auditCount === 1, auditCount);

        const auditDoc = await AdminAuditLog.findOne({ action: "AREA_SERVICEABILITY_STATUS_CHANGED", targetId: json?.data?.id }).lean();
        check("17. Audit meta answers WHO/WHAT/OLD/NEW/WHY",
          auditDoc?.adminId && auditDoc?.meta?.areaId && auditDoc?.meta?.oldStatus === null && auditDoc?.meta?.newStatus === "PENDING" && auditDoc?.meta?.reason === "audit test",
          JSON.stringify(auditDoc));

        // 18. Failed mutation (duplicate configure) must not create a false audit
        const dupRes = await configure(indiaToken, areaAudit._id, { reason: "dup attempt" });
        check("18. Duplicate configure attempt is rejected", dupRes.status === 409);
        const dupAuditCount = await AdminAuditLog.countDocuments({
          action: "AREA_SERVICEABILITY_STATUS_CHANGED", "meta.reason": "dup attempt", createdAt: { $gte: runStartedAt },
        });
        check("18. Failed (duplicate) mutation creates no audit event", dupAuditCount === 0, dupAuditCount);
      }

      // ── 19. Concurrent create (same Area) ──
      {
        const areaConc = await mkArea("CONCURRENT_CREATE", cityV._id, districtV._id, stateV._id);
        const [r1, r2] = await Promise.all([
          configure(indiaToken, areaConc._id, { reason: "race1" }),
          configure(indiaToken, areaConc._id, { reason: "race2" }),
        ]);
        const statuses = [r1.status, r2.status].sort();
        check("19. Concurrent create yields exactly one success and one conflict", statuses[0] === 200 && statuses[1] === 409, JSON.stringify(statuses));
        const docCount = await AreaServiceability.countDocuments({ areaRef: areaConc._id });
        check("19. Exactly one AreaServiceability document exists after the race", docCount === 1, docCount);
        const doc = await AreaServiceability.findOne({ areaRef: areaConc._id }).lean();
        if (doc) createdServiceabilityIds.push(doc._id);
      }

      // ── 20. Concurrent updates (same transition target) ──
      {
        const areaConcT = await mkArea("CONCURRENT_TRANSITION", cityV._id, districtV._id, stateV._id);
        const cfgRes = await configure(indiaToken, areaConcT._id, {});
        const cfgJson = await cfgRes.json();
        if (cfgJson?.data?.id) createdServiceabilityIds.push(cfgJson.data.id);

        const [t1, t2] = await Promise.all([
          transition(indiaToken, areaConcT._id, { targetStatus: "ACTIVE", reason: "race-a" }),
          transition(indiaToken, areaConcT._id, { targetStatus: "RETIRED", reason: "race-b" }),
        ]);
        const tStatuses = [t1.status, t2.status].sort();
        check("20. Concurrent conflicting transitions yield exactly one success", tStatuses.filter((s) => s === 200).length === 1, JSON.stringify(tStatuses));
        check("20. Concurrent conflicting transitions yield exactly one conflict", tStatuses.filter((s) => s === 409).length === 1, JSON.stringify(tStatuses));
      }

      // ── 21. Retired/inactive Area cannot become ACTIVE ──
      {
        const cfgInactive = await configure(indiaToken, areaInactive._id, {});
        check("21. Cannot configure serviceability for an inactive Area", cfgInactive.status === 409, cfgInactive.status);

        const cfgDeleted = await configure(indiaToken, areaDeleted._id, {});
        check("21. Cannot configure serviceability for a deleted Area", cfgDeleted.status === 404, cfgDeleted.status);
      }

      // ── 22/23/24. No Territory/ServiceZone/Area side effects ──
      {
        const beforeArea = await Area.findById(areaV._id).lean();
        check("24. Configuring/transitioning serviceability never mutates the Area document itself", beforeArea?.name === `${NAME_PREFIX}AREA_V`, beforeArea?.name);

        const rawSrc = (await import("fs")).readFileSync(
          (await import("path")).join(process.cwd(), "controllers/areaServiceability.controller.js"), "utf8"
        );
        // Strip comments before scanning — the file's own header
        // comments legitimately *mention* Territory/ServiceZone to
        // document that they are out of scope; only actual code
        // (import/usage) would be a real violation.
        const codeOnly = rawSrc
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
        check("22. Controller code (excluding comments) references no Territory/TerritoryAreaClaim/TerritoryAssignment", !/Territory/.test(codeOnly), "found Territory reference in code");
        check("23. Controller code (excluding comments) references no ServiceZone", !/ServiceZone/.test(codeOnly), "found ServiceZone reference in code");
      }

      // ── 25. No booking/discovery regression (files untouched) ──
      {
        const { execSync } = await import("child_process");
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        const statusFiles = execSync("git status --short", { cwd: process.cwd() }).toString();
        check("25. booking.controller.js was not modified", !diffFiles.includes("booking.controller.js"), diffFiles);
        check("25. discovery.controller.js was not modified", !diffFiles.includes("discovery.controller.js"), diffFiles);
        check("25. serviceZone files were not modified", !statusFiles.includes("serviceZone") && !diffFiles.includes("serviceZone"), statusFiles + diffFiles);
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdServiceabilityIds.length) await AreaServiceability.deleteMany({ _id: { $in: createdServiceabilityIds } });
    if (createdAreaIds.length) await AreaServiceability.deleteMany({ areaRef: { $in: createdAreaIds } }); // catch any stragglers
    if (createdAreaIds.length) await Area.deleteMany({ _id: { $in: createdAreaIds } });
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
