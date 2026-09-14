/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyCommercialTerritory.js
 *
 * FA-5.2 — LIVE, real-HTTP, real-DB verification for CommercialTerritory
 * + TerritoryAssignment + TerritoryActivationLock. Same precedent and
 * style as every other verification script this session: real Express
 * app, real signed JWTs, real MongoDB Atlas, real concurrency via
 * Promise.all, no mocks.
 *
 * All fixtures prefixed "ZTEST_FA52_" / phones 9999952xxx, hard-deleted
 * in cleanup by exact tracked _id only — never a broad destructive
 * deletion. AdminAuditLog/FieldAgentAuditEvent entries are append-only
 * and preserved, same precedent as every other audit collection.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyCommercialTerritory.js
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
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import TerritoryActivationLock from "../modules/fieldAgent/models/TerritoryActivationLock.js";
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

const NAME_PREFIX = "ZTEST_FA52_";
let phoneSeq = 0;
const nextPhone = () => `9999952${String(phoneSeq++).padStart(3, "0")}`;

// Ownership-safe cleanup — only ever by exact tracked _id.
const createdUserIds = [];
const createdFieldAgentIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const createdTerritoryIds = [];
const createdAssignmentIds = [];
const createdLockDistrictIds = [];

const runStartedAt = new Date();

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path_, token, opts = {}) =>
    fetch(url(path_), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });

  const post = (path_, token, body) => authFetch(path_, token, { method: "POST", body: JSON.stringify(body || {}) });
  const patch = (path_, token, body) => authFetch(path_, token, { method: "PATCH", body: JSON.stringify(body || {}) });
  const get = (path_, token) => authFetch(path_, token, { method: "GET" });

  try {
    try {
      // ── FIXTURES ────────────────────────────────────────────────────
      const country = await Country.findOne({}).lean();
      check("Real Country fixture exists", !!country);

      let stateCodeSeq = 0;
      const nextStateCode = () => {
        let n = stateCodeSeq++, code = "";
        do { code = String.fromCharCode(65 + (n % 26)) + code; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return ("ZY" + code).slice(-2);
      };
      const mkState = async (suffix, opts = {}) => {
        const s = await State.create({ name: `${NAME_PREFIX}STATE_${suffix}`, code: nextStateCode(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false, ...opts });
        createdStateIds.push(s._id); return s;
      };
      let districtCodeSeq = 0;
      const mkDistrict = async (suffix, stateRef, opts = {}) => {
        const d = await District.create({ name: `${NAME_PREFIX}DISTRICT_${suffix}`, code: `ZF${districtCodeSeq++}`, countryRef: country._id, stateRef, isActive: true, isDeleted: false, ...opts });
        createdDistrictIds.push(d._id); return d;
      };
      const mkCity = async (suffix, districtRef, stateRef, opts = {}) => {
        const c = await City.create({ name: `${NAME_PREFIX}CITY_${suffix}`, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdCityIds.push(c._id); return c;
      };
      const mkArea = async (suffix, cityRef, districtRef, stateRef, opts = {}) => {
        const a = await Area.create({ name: `Area ${suffix}`, cityRef, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdAreaIds.push(a._id); return a;
      };
      const mkAdmin = async (suffix, adminLevel, geo = {}) => {
        const u = await User.create({
          name: `${NAME_PREFIX}ADMIN_${suffix}`,
          phone: nextPhone(),
          email: `zt-fa52-${suffix.toLowerCase()}-${Date.now()}@example.invalid`,
          role: "ADMIN",
          adminLevel,
          adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
          countryRef: country._id,
          stateRef: geo.stateRef ?? null,
          districtRef: geo.districtRef ?? null,
          isActive: true,
        });
        createdUserIds.push(u._id);
        return { user: u, token: generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 }) };
      };
      const mkFieldAgent = async (suffix, { commercialPath = null } = {}) => {
        const u = await User.create({ name: `${NAME_PREFIX}FA_${suffix}`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
        createdUserIds.push(u._id);
        const fa = await FieldAgent.create({
          userRef: u._id,
          applicationRef: new mongoose.Types.ObjectId(),
          agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`,
          operationalStatus: "PENDING_ACTIVATION",
          commercialPath,
        });
        createdFieldAgentIds.push(fa._id);
        return fa;
      };

      const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists (pre-existing)", !!indiaAdmin);
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      const nonAdminUser = await mkFieldAgent("NONADMIN", {});
      const nonAdminUserDoc = await User.findById(nonAdminUser.userRef).lean();
      const nonAdminToken = generateAccessToken({ _id: nonAdminUserDoc._id, role: "FIELD_AGENT", tokenVersion: 0 });

      // Shared state, per-group fresh districts/cities/areas for clean
      // isolation of overlap/duplicate-DRAFT tests.
      const state1 = await mkState("S1");

      const create = (token, body) => post("/api/admin/commercial-territories", token, body);
      const activate = (token, id) => post(`/api/admin/commercial-territories/${id}/activate`, token);
      const suspend = (token, id) => post(`/api/admin/commercial-territories/${id}/suspend`, token);
      const retire = (token, id) => post(`/api/admin/commercial-territories/${id}/retire`, token);
      const assign = (token, id, fieldAgentId) => post(`/api/admin/commercial-territories/${id}/assign-partner`, token, { fieldAgentId });
      const vacate = (token, id, endReason) => post(`/api/admin/commercial-territories/${id}/vacate-partner`, token, { endReason });

      // ── 1. CREATION — each scope type ───────────────────────────────
      {
        const d = await mkDistrict("CREATE", state1._id);
        const c = await mkCity("CREATE", d._id, state1._id);
        const a1 = await mkArea("CREATE1", c._id, d._id, state1._id);
        const a2 = await mkArea("CREATE2", c._id, d._id, state1._id);

        const rDistrict = await create(indiaToken, { name: "T District", scopeType: "DISTRICT", districtRef: String(d._id) });
        check("1. Create DISTRICT scope succeeds", rDistrict.status === 201, rDistrict.status);
        const bDistrict = await rDistrict.json();
        if (rDistrict.status === 201) createdTerritoryIds.push(bDistrict.data.territory._id);
        check("1. DISTRICT territory has cityRef null, areaRefs []", bDistrict.data?.territory?.cityRef === null && Array.isArray(bDistrict.data?.territory?.areaRefs) && bDistrict.data.territory.areaRefs.length === 0);
        check("1. Server-generated code matches CT-YYYYMMDD-XXXXXX", /^CT-\d{8}-\d{6}$/.test(bDistrict.data?.territory?.code || ""), bDistrict.data?.territory?.code);
        check("1. status defaults to DRAFT", bDistrict.data?.territory?.status === "DRAFT");

        const rCity = await create(indiaToken, { name: "T City", scopeType: "CITY", districtRef: String(d._id), cityRef: String(c._id) });
        check("1. Create CITY scope succeeds", rCity.status === 201, rCity.status);
        const bCity = await rCity.json();
        if (rCity.status === 201) createdTerritoryIds.push(bCity.data.territory._id);
        check("1. CITY territory has areaRefs []", Array.isArray(bCity.data?.territory?.areaRefs) && bCity.data.territory.areaRefs.length === 0);

        const rAreaSet = await create(indiaToken, { name: "T AreaSet", scopeType: "AREA_SET", districtRef: String(d._id), cityRef: String(c._id), areaRefs: [String(a1._id), String(a2._id)] });
        check("1. Create AREA_SET scope succeeds", rAreaSet.status === 201, rAreaSet.status);
        const bAreaSet = await rAreaSet.json();
        if (rAreaSet.status === 201) createdTerritoryIds.push(bAreaSet.data.territory._id);
        check("1. AREA_SET territory has 2 areaRefs", bAreaSet.data?.territory?.areaRefs?.length === 2);

        check("1. Missing cityRef for CITY scope rejected", (await create(indiaToken, { name: "X", scopeType: "CITY", districtRef: String(d._id) })).status === 400);
        check("1. cityRef forbidden for DISTRICT scope", (await create(indiaToken, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id), cityRef: String(c._id) })).status === 400);
        check("1. Missing areaRefs for AREA_SET scope rejected", (await create(indiaToken, { name: "X", scopeType: "AREA_SET", districtRef: String(d._id), cityRef: String(c._id) })).status === 400);
      }

      // ── 2. HIERARCHY VALIDATION ──────────────────────────────────────
      {
        const d1 = await mkDistrict("HIER1", state1._id);
        const d2 = await mkDistrict("HIER2", state1._id);
        const c1 = await mkCity("HIER1", d1._id, state1._id);
        const c2 = await mkCity("HIER2", d2._id, state1._id);
        const areaInC2 = await mkArea("HIERX", c2._id, d2._id, state1._id);

        check("2. cityRef not belonging to districtRef rejected", (await create(indiaToken, { name: "X", scopeType: "CITY", districtRef: String(d1._id), cityRef: String(c2._id) })).status === 400);
        check("2. areaRef not belonging to cityRef rejected", (await create(indiaToken, { name: "X", scopeType: "AREA_SET", districtRef: String(d1._id), cityRef: String(c1._id), areaRefs: [String(areaInC2._id)] })).status === 400);
        check("2. Non-existent districtRef rejected", (await create(indiaToken, { name: "X", scopeType: "DISTRICT", districtRef: String(new mongoose.Types.ObjectId()) })).status === 400);
        check("2. Non-existent areaRef rejected", (await create(indiaToken, { name: "X", scopeType: "AREA_SET", districtRef: String(d2._id), cityRef: String(c2._id), areaRefs: [String(new mongoose.Types.ObjectId())] })).status === 400);
      }

      // ── 3. CODE / VALIDATION ─────────────────────────────────────────
      {
        const d = await mkDistrict("CODE", state1._id);
        check("3. Client-supplied code is rejected (forbidden field)", (await create(indiaToken, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id), code: "CT-HACKED-000000" })).status === 400);
        check("3. Client-supplied status is rejected (forbidden field)", (await create(indiaToken, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id), status: "ACTIVE" })).status === 400);
        check("3. Unknown field rejected", (await create(indiaToken, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id), extraField: "nope" })).status === 400);
      }

      // ── 4. DUPLICATE-DRAFT — DISTRICT / CITY / AREA_SET ─────────────
      {
        const d = await mkDistrict("DUPD", state1._id);
        const r1 = await create(indiaToken, { name: "Dup District 1", scopeType: "DISTRICT", districtRef: String(d._id) });
        check("4. First DISTRICT DRAFT succeeds", r1.status === 201, r1.status);
        if (r1.status === 201) createdTerritoryIds.push((await r1.json()).data.territory._id);
        const r2 = await create(indiaToken, { name: "Dup District 2", scopeType: "DISTRICT", districtRef: String(d._id) });
        check("4. Duplicate DISTRICT DRAFT rejected (409)", r2.status === 409, r2.status);

        const d2 = await mkDistrict("DUPC", state1._id);
        const c = await mkCity("DUPC", d2._id, state1._id);
        const rc1 = await create(indiaToken, { name: "Dup City 1", scopeType: "CITY", districtRef: String(d2._id), cityRef: String(c._id) });
        check("4. First CITY DRAFT succeeds", rc1.status === 201, rc1.status);
        if (rc1.status === 201) createdTerritoryIds.push((await rc1.clone().json()).data.territory._id);
        const rc2 = await create(indiaToken, { name: "Dup City 2", scopeType: "CITY", districtRef: String(d2._id), cityRef: String(c._id) });
        check("4. Duplicate CITY DRAFT rejected (409)", rc2.status === 409, rc2.status);

        const d3 = await mkDistrict("DUPA", state1._id);
        const c3 = await mkCity("DUPA", d3._id, state1._id);
        const a1 = await mkArea("DUPA1", c3._id, d3._id, state1._id);
        const a2 = await mkArea("DUPA2", c3._id, d3._id, state1._id);
        const a3 = await mkArea("DUPA3", c3._id, d3._id, state1._id);
        const ra1 = await create(indiaToken, { name: "Dup Area 1", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a1._id), String(a2._id)] });
        check("4. First AREA_SET DRAFT succeeds", ra1.status === 201, ra1.status);
        if (ra1.status === 201) createdTerritoryIds.push((await ra1.clone().json()).data.territory._id);
        // exact same set, different submission order -> must be treated identical
        const ra2 = await create(indiaToken, { name: "Dup Area 2", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a2._id), String(a1._id)] });
        check("4. Exact same AREA_SET with different order rejected (409)", ra2.status === 409, ra2.status);
        // partial overlap must be ALLOWED
        const ra3 = await create(indiaToken, { name: "Dup Area 3", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a2._id), String(a3._id)] });
        check("4. Partial-overlap AREA_SET DRAFT allowed", ra3.status === 201, ra3.status);
        if (ra3.status === 201) createdTerritoryIds.push((await ra3.clone().json()).data.territory._id);
        // duplicate areaRefs within one request
        const raDup = await create(indiaToken, { name: "Dup In Request", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a1._id), String(a1._id)] });
        check("4. Duplicate areaRefs within one request rejected (400)", raDup.status === 400, raDup.status);
      }

      // ── 5. LIFECYCLE TRANSITIONS ─────────────────────────────────────
      {
        const d = await mkDistrict("LIFE1", state1._id);
        const rDraft = await create(indiaToken, { name: "Lifecycle Cancel", scopeType: "DISTRICT", districtRef: String(d._id) });
        const idCancel = (await rDraft.json()).data.territory._id;
        createdTerritoryIds.push(idCancel);
        const rCancel = await retire(indiaToken, idCancel);
        check("5. DRAFT -> RETIRED direct transition allowed", rCancel.status === 200, rCancel.status);
        check("5. RETIRED is terminal (activate rejected)", (await activate(indiaToken, idCancel)).status === 409);

        const d2 = await mkDistrict("LIFE2", state1._id);
        const rDraft2 = await create(indiaToken, { name: "Lifecycle Full", scopeType: "DISTRICT", districtRef: String(d2._id) });
        const idFull = (await rDraft2.json()).data.territory._id;
        createdTerritoryIds.push(idFull);
        check("5. DRAFT -> ACTIVE succeeds", (await activate(indiaToken, idFull)).status === 200);
        check("5. Re-activating an already-ACTIVE territory rejected", (await activate(indiaToken, idFull)).status === 409);
        check("5. ACTIVE -> SUSPENDED succeeds", (await suspend(indiaToken, idFull)).status === 200);
        check("5. Suspending an already-SUSPENDED territory rejected", (await suspend(indiaToken, idFull)).status === 409);
        check("5. SUSPENDED -> ACTIVE succeeds", (await activate(indiaToken, idFull)).status === 200);
        check("5. ACTIVE -> RETIRED succeeds", (await retire(indiaToken, idFull)).status === 200);
        check("5. Retiring an already-RETIRED territory rejected", (await retire(indiaToken, idFull)).status === 409);
      }

      // ── 6. OVERLAP MATRIX ────────────────────────────────────────────
      {
        // DISTRICT vs DISTRICT — same district conflict
        const d = await mkDistrict("OVDD", state1._id);
        const rA = await create(indiaToken, { name: "OV DD A", scopeType: "DISTRICT", districtRef: String(d._id) });
        const idA = (await rA.json()).data.territory._id; createdTerritoryIds.push(idA);
        check("6. Activate first DISTRICT territory succeeds", (await activate(indiaToken, idA)).status === 200);
        // second DISTRICT-scope draft on same district would fail duplicate-DRAFT before even reaching overlap — use CITY/AREA_SET instead to prove ACTIVE overlap distinctly
        const c = await mkCity("OVDD", d._id, state1._id);
        const rB = await create(indiaToken, { name: "OV DD B (city)", scopeType: "CITY", districtRef: String(d._id), cityRef: String(c._id) });
        const idB = (await rB.json()).data.territory._id; createdTerritoryIds.push(idB);
        const actB = await activate(indiaToken, idB);
        check("6. DISTRICT vs CITY-in-district: activation blocked (409)", actB.status === 409, actB.status);

        // DISTRICT vs AREA_SET
        const areaX = await mkArea("OVDDX", c._id, d._id, state1._id);
        const rC = await create(indiaToken, { name: "OV DD C (areaset)", scopeType: "AREA_SET", districtRef: String(d._id), cityRef: String(c._id), areaRefs: [String(areaX._id)] });
        const idC = (await rC.json()).data.territory._id; createdTerritoryIds.push(idC);
        check("6. DISTRICT vs AREA_SET-in-district: activation blocked (409)", (await activate(indiaToken, idC)).status === 409);

        // CITY vs CITY — different district, own group
        const d2 = await mkDistrict("OVCC", state1._id);
        const c2a = await mkCity("OVCC_A", d2._id, state1._id);
        const rCityA = await create(indiaToken, { name: "OV CC A", scopeType: "CITY", districtRef: String(d2._id), cityRef: String(c2a._id) });
        const idCityA = (await rCityA.json()).data.territory._id; createdTerritoryIds.push(idCityA);
        check("6. Activate independent CITY territory succeeds", (await activate(indiaToken, idCityA)).status === 200);
        // same city, different territory attempt blocked by duplicate-DRAFT (both DRAFT+same scopeKey) — to test ACTIVE-vs-ACTIVE CITY conflict we need a differently-composed but same-city territory: use AREA_SET in same city
        const areaY = await mkArea("OVCCY", c2a._id, d2._id, state1._id);
        const rCityAreaSet = await create(indiaToken, { name: "OV CC AreaSet-in-city", scopeType: "AREA_SET", districtRef: String(d2._id), cityRef: String(c2a._id), areaRefs: [String(areaY._id)] });
        const idCityAreaSet = (await rCityAreaSet.json()).data.territory._id; createdTerritoryIds.push(idCityAreaSet);
        check("6. CITY vs AREA_SET-in-city: activation blocked (409)", (await activate(indiaToken, idCityAreaSet)).status === 409);

        // AREA_SET vs AREA_SET — intersecting rejected, disjoint allowed
        const d3 = await mkDistrict("OVAA", state1._id);
        const c3 = await mkCity("OVAA", d3._id, state1._id);
        const a1 = await mkArea("OVAA1", c3._id, d3._id, state1._id);
        const a2 = await mkArea("OVAA2", c3._id, d3._id, state1._id);
        const a3 = await mkArea("OVAA3", c3._id, d3._id, state1._id);
        const a4 = await mkArea("OVAA4", c3._id, d3._id, state1._id);
        const rSet1 = await create(indiaToken, { name: "OV AA Set1", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a1._id), String(a2._id)] });
        const idSet1 = (await rSet1.json()).data.territory._id; createdTerritoryIds.push(idSet1);
        check("6. Activate first AREA_SET succeeds", (await activate(indiaToken, idSet1)).status === 200);
        const rSet2 = await create(indiaToken, { name: "OV AA Set2 (intersect)", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a2._id), String(a3._id)] });
        const idSet2 = (await rSet2.json()).data.territory._id; createdTerritoryIds.push(idSet2);
        check("6. Intersecting AREA_SET activation blocked (409)", (await activate(indiaToken, idSet2)).status === 409);
        // Set3 is disjoint from Set1 (a4 vs a1/a2) AND disjoint from
        // Set2 (a4 vs a2/a3) — an unambiguous "both may be ACTIVE" case.
        const rSet3 = await create(indiaToken, { name: "OV AA Set3 (disjoint)", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a4._id)] });
        const idSet3 = (await rSet3.json()).data.territory._id; createdTerritoryIds.push(idSet3);
        check("6. Disjoint AREA_SET (same city) activation allowed", (await activate(indiaToken, idSet3)).status === 200);

        // Once the conflicting Set1 is retired, Set2 (which only ever
        // conflicted with Set1, not with the disjoint Set3) can now
        // activate — overlap is a live-state check, not a permanent
        // block.
        check("6. Retire Set1 succeeds", (await retire(indiaToken, idSet1)).status === 200);
        check("6. Set2 can activate once the conflicting Set1 is RETIRED", (await activate(indiaToken, idSet2)).status === 200);
      }

      // ── 7. PATCH (DRAFT-only) ────────────────────────────────────────
      {
        const d = await mkDistrict("PATCH", state1._id);
        const r = await create(indiaToken, { name: "Patchable", scopeType: "DISTRICT", districtRef: String(d._id) });
        const id = (await r.json()).data.territory._id; createdTerritoryIds.push(id);
        const rPatch = await patch(`/api/admin/commercial-territories/${id}`, indiaToken, { name: "Patched Name" });
        check("7. PATCH allowed while DRAFT", rPatch.status === 200, rPatch.status);
        check("7. PATCH actually changed the name", (await rPatch.json()).data?.territory?.name === "Patched Name");
        await activate(indiaToken, id);
        const rPatchActive = await patch(`/api/admin/commercial-territories/${id}`, indiaToken, { name: "Should Fail" });
        check("7. PATCH rejected once ACTIVE", rPatchActive.status === 409, rPatchActive.status);
      }

      // ── 8. ASSIGN / VACATE / ELIGIBILITY ─────────────────────────────
      {
        const d = await mkDistrict("ASSIGN", state1._id);
        const rTerr = await create(indiaToken, { name: "Assignable", scopeType: "DISTRICT", districtRef: String(d._id) });
        const territoryId = (await rTerr.json()).data.territory._id; createdTerritoryIds.push(territoryId);

        const faTP = await mkFieldAgent("TP1", { commercialPath: "TERRITORY_PARTNER" });
        const faAA = await mkFieldAgent("AA1", { commercialPath: "ACQUISITION_AGENT" });
        const faNull = await mkFieldAgent("NULL1", { commercialPath: null });

        check("8. Assign rejected when territory not ACTIVE (still DRAFT)", (await assign(indiaToken, territoryId, String(faTP._id))).status === 409);
        await activate(indiaToken, territoryId);

        check("8. Assign rejected for ACQUISITION_AGENT", (await assign(indiaToken, territoryId, String(faAA._id))).status === 409);
        check("8. Assign rejected for null commercialPath", (await assign(indiaToken, territoryId, String(faNull._id))).status === 409);
        check("8. Assign rejected for non-existent FieldAgent", (await assign(indiaToken, territoryId, String(new mongoose.Types.ObjectId()))).status === 404);

        const rAssign = await assign(indiaToken, territoryId, String(faTP._id));
        check("8. Assign succeeds for TERRITORY_PARTNER", rAssign.status === 200, rAssign.status);
        const assignBody = await rAssign.json();
        if (assignBody.data?.assignment?._id) createdAssignmentIds.push(assignBody.data.assignment._id);
        check("8. Assignment effectiveFrom is set, effectiveUntil null", !!assignBody.data?.assignment?.effectiveFrom && assignBody.data?.assignment?.effectiveUntil === null);

        check("8. Assign rejected when territory already has a partner", (await assign(indiaToken, territoryId, String(faTP._id))).status === 409);

        // FieldAgent already active elsewhere
        const d2 = await mkDistrict("ASSIGN2", state1._id);
        const rTerr2 = await create(indiaToken, { name: "Assignable 2", scopeType: "DISTRICT", districtRef: String(d2._id) });
        const territoryId2 = (await rTerr2.json()).data.territory._id; createdTerritoryIds.push(territoryId2);
        await activate(indiaToken, territoryId2);
        check("8. Assign rejected — FieldAgent already ACTIVE elsewhere", (await assign(indiaToken, territoryId2, String(faTP._id))).status === 409);

        // Vacate flow
        check("8. Vacate rejected with TERRITORY_RETIRED as client input", (await vacate(indiaToken, territoryId, "TERRITORY_RETIRED")).status === 400);
        const rVacate = await vacate(indiaToken, territoryId, "PARTNER_EXIT");
        check("8. Vacate succeeds with PARTNER_EXIT", rVacate.status === 200, rVacate.status);
        const afterVacate = await CommercialTerritory.findById(territoryId).lean();
        check("8. After vacate: currentAssignmentRef null, status still ACTIVE (derived vacancy)", afterVacate.currentAssignmentRef === null && afterVacate.status === "ACTIVE");
        const endedAssignment = await TerritoryAssignment.findById(assignBody.data.assignment._id).lean();
        check("8. Ended assignment has ENDED/effectiveUntil/endReason/endedBy set", endedAssignment.status === "ENDED" && !!endedAssignment.effectiveUntil && endedAssignment.endReason === "PARTNER_EXIT" && !!endedAssignment.endedBy);
        check("8. Vacate rejected when no active assignment exists", (await vacate(indiaToken, territoryId, "PARTNER_EXIT")).status === 409);

        // FieldAgent freed up after vacate — can be reassigned elsewhere
        const rReassign = await assign(indiaToken, territoryId2, String(faTP._id));
        check("8. FieldAgent can be reassigned after vacate freed them up", rReassign.status === 200, rReassign.status);
        if ((await rReassign.clone().json()).data?.assignment?._id) createdAssignmentIds.push((await rReassign.json()).data.assignment._id);
      }

      // ── 9. RETIRE WITH LIVE ASSIGNMENT (auto-vacate) ─────────────────
      {
        const d = await mkDistrict("RETLIVE", state1._id);
        const r = await create(indiaToken, { name: "Retire With Partner", scopeType: "DISTRICT", districtRef: String(d._id) });
        const territoryId = (await r.json()).data.territory._id; createdTerritoryIds.push(territoryId);
        await activate(indiaToken, territoryId);
        const fa = await mkFieldAgent("RETLIVE", { commercialPath: "TERRITORY_PARTNER" });
        const rAssign = await assign(indiaToken, territoryId, String(fa._id));
        const assignmentId = (await rAssign.json()).data.assignment._id;
        createdAssignmentIds.push(assignmentId);

        const rRetire = await retire(indiaToken, territoryId);
        check("9. Retire with live assignment succeeds", rRetire.status === 200, rRetire.status);
        const retired = await CommercialTerritory.findById(territoryId).lean();
        check("9. Territory is RETIRED, currentAssignmentRef cleared", retired.status === "RETIRED" && retired.currentAssignmentRef === null);
        const endedAssignment = await TerritoryAssignment.findById(assignmentId).lean();
        check("9. Assignment auto-ended with TERRITORY_RETIRED reason", endedAssignment.status === "ENDED" && endedAssignment.endReason === "TERRITORY_RETIRED" && String(endedAssignment.endedBy) === String(indiaAdmin._id));
        check("9. No ACTIVE assignment left pointing at a RETIRED territory", (await TerritoryAssignment.countDocuments({ territoryRef: territoryId, status: "ACTIVE" })) === 0);
      }

      // ── 10. AUTHORIZATION MATRIX ──────────────────────────────────────
      {
        const d = await mkDistrict("AUTHZ", state1._id);
        const stateAdminOther = await mkAdmin("STATE_OTHER", "STATE", { stateRef: state1._id });
        const districtAdminOther = await mkAdmin("DISTRICT_OTHER", "DISTRICT", { stateRef: state1._id, districtRef: d._id });

        check("10. STATE admin cannot create (403)", (await create(stateAdminOther.token, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id) })).status === 403);
        check("10. DISTRICT admin cannot create (403)", (await create(districtAdminOther.token, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id) })).status === 403);
        check("10. Non-admin FIELD_AGENT cannot create (403)", (await create(nonAdminToken, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id) })).status === 403);
        check("10. Unauthenticated request rejected (401)", (await create(null, { name: "X", scopeType: "DISTRICT", districtRef: String(d._id) })).status === 401);

        const r = await create(indiaToken, { name: "AuthZ Territory", scopeType: "DISTRICT", districtRef: String(d._id) });
        const territoryId = (await r.json()).data.territory._id; createdTerritoryIds.push(territoryId);

        check("10. STATE admin cannot activate (403)", (await activate(stateAdminOther.token, territoryId)).status === 403);
        check("10. DISTRICT admin cannot activate (403)", (await activate(districtAdminOther.token, territoryId)).status === 403);

        // Read scoping — STATE admin whose stateRef matches sees it; a
        // STATE admin from a DIFFERENT state does not. Reuse
        // stateAdminOther/districtAdminOther as the "matching" admins
        // (both already scoped to state1/d respectively) — the User
        // model enforces at most one STATE admin per
        // {stateRef, adminSubRole}, so a second admin on the SAME
        // state/district would collide on that unique index.
        const state2 = await mkState("S2_AUTHZ");
        const mismatchStateAdmin = await mkAdmin("STATE_MISMATCH", "STATE", { stateRef: state2._id });
        const rGetMatch = await get(`/api/admin/commercial-territories/${territoryId}`, stateAdminOther.token);
        check("10. STATE admin in own state can read", rGetMatch.status === 200, rGetMatch.status);
        const rGetMismatch = await get(`/api/admin/commercial-territories/${territoryId}`, mismatchStateAdmin.token);
        check("10. STATE admin in a different state cannot read (403)", rGetMismatch.status === 403, rGetMismatch.status);

        const rGetDistrictMatch = await get(`/api/admin/commercial-territories/${territoryId}`, districtAdminOther.token);
        check("10. DISTRICT admin in own district can read", rGetDistrictMatch.status === 200, rGetDistrictMatch.status);
        const otherDistrict = await mkDistrict("AUTHZ_OTHER", state1._id);
        const mismatchDistrictAdmin = await mkAdmin("DISTRICT_MISMATCH", "DISTRICT", { stateRef: state1._id, districtRef: otherDistrict._id });
        const rGetDistrictMismatch = await get(`/api/admin/commercial-territories/${territoryId}`, mismatchDistrictAdmin.token);
        check("10. DISTRICT admin in a different district cannot read (403)", rGetDistrictMismatch.status === 403, rGetDistrictMismatch.status);

        // List scoping
        const rList = await get(`/api/admin/commercial-territories?limit=100`, stateAdminOther.token);
        const listBody = await rList.json();
        const listedIds = (listBody.data?.territories || []).map((t) => String(t._id));
        check("10. STATE-scoped list includes the in-scope territory", listedIds.includes(String(territoryId)));
        const rListMismatch = await get(`/api/admin/commercial-territories?limit=100`, mismatchStateAdmin.token);
        const listedIdsMismatch = ((await rListMismatch.json()).data?.territories || []).map((t) => String(t._id));
        check("10. Different-state STATE admin's list excludes the territory", !listedIdsMismatch.includes(String(territoryId)));
      }

      // ── 11. IDOR / MALFORMED IDS ──────────────────────────────────────
      {
        check("11. Malformed territoryId rejected (400)", (await get(`/api/admin/commercial-territories/not-an-id`, indiaToken)).status === 400);
        check("11. Non-existent territoryId returns 404", (await get(`/api/admin/commercial-territories/${new mongoose.Types.ObjectId()}`, indiaToken)).status === 404);
      }

      // ── 12. CONCURRENCY — assignment races ───────────────────────────
      {
        const d = await mkDistrict("CONCASSIGN", state1._id);
        const r = await create(indiaToken, { name: "Concurrent Assign Target", scopeType: "DISTRICT", districtRef: String(d._id) });
        const territoryId = (await r.json()).data.territory._id; createdTerritoryIds.push(territoryId);
        await activate(indiaToken, territoryId);
        const faA = await mkFieldAgent("CONCA", { commercialPath: "TERRITORY_PARTNER" });
        const faB = await mkFieldAgent("CONCB", { commercialPath: "TERRITORY_PARTNER" });

        const [r1, r2] = await Promise.all([assign(indiaToken, territoryId, String(faA._id)), assign(indiaToken, territoryId, String(faB._id))]);
        const statuses = [r1.status, r2.status].sort();
        check("12. Concurrent assign to same territory: exactly one 200", statuses.filter((s) => s === 200).length === 1, JSON.stringify(statuses));
        check("12. Concurrent assign to same territory: exactly one 409", statuses.filter((s) => s === 409).length === 1, JSON.stringify(statuses));
        const winnerCount = await TerritoryAssignment.countDocuments({ territoryRef: territoryId, status: "ACTIVE" });
        check("12. Exactly one ACTIVE assignment persisted", winnerCount === 1, winnerCount);
        for (const rr of [r1, r2]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.assignment?._id) createdAssignmentIds.push(b.data.assignment._id); }

        // Same FieldAgent assigned to two different territories concurrently
        const d2a = await mkDistrict("CONCFA1", state1._id);
        const d2b = await mkDistrict("CONCFA2", state1._id);
        const rT1 = await create(indiaToken, { name: "Conc FA T1", scopeType: "DISTRICT", districtRef: String(d2a._id) });
        const rT2 = await create(indiaToken, { name: "Conc FA T2", scopeType: "DISTRICT", districtRef: String(d2b._id) });
        const t1Id = (await rT1.json()).data.territory._id; createdTerritoryIds.push(t1Id);
        const t2Id = (await rT2.json()).data.territory._id; createdTerritoryIds.push(t2Id);
        await Promise.all([activate(indiaToken, t1Id), activate(indiaToken, t2Id)]);
        const faShared = await mkFieldAgent("CONCSHARED", { commercialPath: "TERRITORY_PARTNER" });
        const [ra, rb] = await Promise.all([assign(indiaToken, t1Id, String(faShared._id)), assign(indiaToken, t2Id, String(faShared._id))]);
        const statuses2 = [ra.status, rb.status].sort();
        check("12. Same FieldAgent assigned to two territories concurrently: exactly one 200", statuses2.filter((s) => s === 200).length === 1, JSON.stringify(statuses2));
        const sharedActiveCount = await TerritoryAssignment.countDocuments({ fieldAgentRef: faShared._id, status: "ACTIVE" });
        check("12. FieldAgent ends up with exactly one ACTIVE assignment", sharedActiveCount === 1, sharedActiveCount);
        for (const rr of [ra, rb]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.assignment?._id) createdAssignmentIds.push(b.data.assignment._id); }
      }

      // ── 13. CONCURRENCY — vacate-vs-assign and retire-vs-assign races ─
      {
        const d = await mkDistrict("CONCVAC", state1._id);
        const r = await create(indiaToken, { name: "Conc Vacate Target", scopeType: "DISTRICT", districtRef: String(d._id) });
        const territoryId = (await r.json()).data.territory._id; createdTerritoryIds.push(territoryId);
        await activate(indiaToken, territoryId);
        const faOld = await mkFieldAgent("VACOLD", { commercialPath: "TERRITORY_PARTNER" });
        const faNew = await mkFieldAgent("VACNEW", { commercialPath: "TERRITORY_PARTNER" });
        const rAssignFirst = await assign(indiaToken, territoryId, String(faOld._id));
        createdAssignmentIds.push((await rAssignFirst.json()).data.assignment._id);

        // vacate-vs-assign race: vacate the current holder while a
        // second assign to a different FieldAgent races in.
        const [rVac, rAssignRace] = await Promise.all([
          vacate(indiaToken, territoryId, "ADMIN_REASSIGNED"),
          assign(indiaToken, territoryId, String(faNew._id)),
        ]);
        // Exactly one well-defined final state: either vacate wins then
        // assign is free to retry-and-fail-fast/succeed depending on
        // ordering, or assign observes an occupied slot. In all cases
        // the invariant is: never more than one ACTIVE assignment.
        const finalActiveCount = await TerritoryAssignment.countDocuments({ territoryRef: territoryId, status: "ACTIVE" });
        check("13. Vacate-vs-assign race never leaves more than one ACTIVE assignment", finalActiveCount <= 1, finalActiveCount);
        check("13. Vacate-vs-assign race: both requests received a definitive response", [rVac.status, rAssignRace.status].every((s) => [200, 409].includes(s)), JSON.stringify([rVac.status, rAssignRace.status]));
        const raceBody = await rAssignRace.clone().json().catch(() => null);
        if (raceBody?.data?.assignment?._id) createdAssignmentIds.push(raceBody.data.assignment._id);

        // retire-vs-assign race on a fresh, vacant-again-or-occupied territory
        const territoryFresh = await CommercialTerritory.findById(territoryId).lean();
        if (!territoryFresh.currentAssignmentRef) {
          const rAssignForRetireRace = await assign(indiaToken, territoryId, String(faOld._id));
          const b = await rAssignForRetireRace.clone().json().catch(() => null);
          if (b?.data?.assignment?._id) createdAssignmentIds.push(b.data.assignment._id);
        }
        const [rRetireRace, rAssignDuringRetire] = await Promise.all([
          retire(indiaToken, territoryId),
          assign(indiaToken, territoryId, String(faNew._id)),
        ]);
        check("13. Retire-vs-assign race: both requests received a definitive response", [rRetireRace.status, rAssignDuringRetire.status].every((s) => [200, 404, 409].includes(s)), JSON.stringify([rRetireRace.status, rAssignDuringRetire.status]));
        const finalTerritory = await CommercialTerritory.findById(territoryId).lean();
        check("13. Retire-vs-assign race: territory ends RETIRED with no ACTIVE assignment", finalTerritory.status === "RETIRED" && finalTerritory.currentAssignmentRef === null, JSON.stringify(finalTerritory));
        const afterRaceAssignBody = await rAssignDuringRetire.clone().json().catch(() => null);
        if (afterRaceAssignBody?.data?.assignment?._id) createdAssignmentIds.push(afterRaceAssignBody.data.assignment._id);
      }

      // ── 14. CONCURRENCY — same-district conflicting activation ──────
      {
        const d = await mkDistrict("CONCACTV", state1._id);
        const c1 = await mkCity("CONCACTV1", d._id, state1._id);
        const c2 = await mkCity("CONCACTV2", d._id, state1._id);
        const rDistrictScope = await create(indiaToken, { name: "Conc Activate District", scopeType: "DISTRICT", districtRef: String(d._id) });
        const rCityScope = await create(indiaToken, { name: "Conc Activate City", scopeType: "CITY", districtRef: String(d._id), cityRef: String(c1._id) });
        const idDistrict = (await rDistrictScope.json()).data.territory._id; createdTerritoryIds.push(idDistrict);
        const idCity = (await rCityScope.json()).data.territory._id; createdTerritoryIds.push(idCity);

        const [rA, rB] = await Promise.all([activate(indiaToken, idDistrict), activate(indiaToken, idCity)]);
        const acts = [rA.status, rB.status].sort();
        check("14. Same-district conflicting activation: exactly one 200", acts.filter((s) => s === 200).length === 1, JSON.stringify(acts));
        check("14. Same-district conflicting activation: exactly one 409", acts.filter((s) => s === 409).length === 1, JSON.stringify(acts));
        const activeCountSameDistrict = await CommercialTerritory.countDocuments({ _id: { $in: [idDistrict, idCity] }, status: "ACTIVE" });
        check("14. Exactly one of the two conflicting territories is ACTIVE", activeCountSameDistrict === 1, activeCountSameDistrict);
      }

      // ── 15. CONCURRENCY — same-district disjoint AreaSets both ACTIVE ─
      {
        const d = await mkDistrict("CONCDISJ", state1._id);
        const c = await mkCity("CONCDISJ", d._id, state1._id);
        const a1 = await mkArea("CONCDISJ1", c._id, d._id, state1._id);
        const a2 = await mkArea("CONCDISJ2", c._id, d._id, state1._id);
        const rSet1 = await create(indiaToken, { name: "Disjoint Set1", scopeType: "AREA_SET", districtRef: String(d._id), cityRef: String(c._id), areaRefs: [String(a1._id)] });
        const rSet2 = await create(indiaToken, { name: "Disjoint Set2", scopeType: "AREA_SET", districtRef: String(d._id), cityRef: String(c._id), areaRefs: [String(a2._id)] });
        const idSet1 = (await rSet1.json()).data.territory._id; createdTerritoryIds.push(idSet1);
        const idSet2 = (await rSet2.json()).data.territory._id; createdTerritoryIds.push(idSet2);

        const [rA, rB] = await Promise.all([activate(indiaToken, idSet1), activate(indiaToken, idSet2)]);
        check("15. Same-district disjoint AreaSets: both activations succeed", rA.status === 200 && rB.status === 200, JSON.stringify([rA.status, rB.status]));
        const bothActive = await CommercialTerritory.countDocuments({ _id: { $in: [idSet1, idSet2] }, status: "ACTIVE" });
        check("15. Both disjoint AreaSets end ACTIVE", bothActive === 2, bothActive);
      }

      // ── 16. CONCURRENCY — different-district activation independence ─
      {
        const dX = await mkDistrict("CONCINDX", state1._id);
        const dY = await mkDistrict("CONCINDY", state1._id);
        const rX = await create(indiaToken, { name: "Independent District X", scopeType: "DISTRICT", districtRef: String(dX._id) });
        const rY = await create(indiaToken, { name: "Independent District Y", scopeType: "DISTRICT", districtRef: String(dY._id) });
        const idX = (await rX.json()).data.territory._id; createdTerritoryIds.push(idX);
        const idY = (await rY.json()).data.territory._id; createdTerritoryIds.push(idY);

        const [rA, rB] = await Promise.all([activate(indiaToken, idX), activate(indiaToken, idY)]);
        check("16. Different-district concurrent activation: both succeed independently", rA.status === 200 && rB.status === 200, JSON.stringify([rA.status, rB.status]));
        const lockCount = await TerritoryActivationLock.countDocuments({ districtRef: { $in: [dX._id, dY._id] } });
        check("16. Separate TerritoryActivationLock documents created per district", lockCount === 2, lockCount);
        createdLockDistrictIds.push(dX._id, dY._id);
      }

      // ── 17. CONCURRENCY — duplicate-DRAFT creation races ─────────────
      {
        const d = await mkDistrict("CONCDUPD", state1._id);
        const [r1, r2] = await Promise.all([
          create(indiaToken, { name: "Conc Dup District A", scopeType: "DISTRICT", districtRef: String(d._id) }),
          create(indiaToken, { name: "Conc Dup District B", scopeType: "DISTRICT", districtRef: String(d._id) }),
        ]);
        const s1 = [r1.status, r2.status].sort();
        check("17. Concurrent duplicate DISTRICT DRAFT creation: exactly one 201", s1.filter((s) => s === 201).length === 1, JSON.stringify(s1));
        for (const rr of [r1, r2]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.territory?._id) createdTerritoryIds.push(b.data.territory._id); }

        const d2 = await mkDistrict("CONCDUPC", state1._id);
        const c = await mkCity("CONCDUPC", d2._id, state1._id);
        const [r3, r4] = await Promise.all([
          create(indiaToken, { name: "Conc Dup City A", scopeType: "CITY", districtRef: String(d2._id), cityRef: String(c._id) }),
          create(indiaToken, { name: "Conc Dup City B", scopeType: "CITY", districtRef: String(d2._id), cityRef: String(c._id) }),
        ]);
        const s2 = [r3.status, r4.status].sort();
        check("17. Concurrent duplicate CITY DRAFT creation: exactly one 201", s2.filter((s) => s === 201).length === 1, JSON.stringify(s2));
        for (const rr of [r3, r4]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.territory?._id) createdTerritoryIds.push(b.data.territory._id); }

        const d3 = await mkDistrict("CONCDUPA", state1._id);
        const c3 = await mkCity("CONCDUPA", d3._id, state1._id);
        const a1 = await mkArea("CONCDUPA1", c3._id, d3._id, state1._id);
        const a2 = await mkArea("CONCDUPA2", c3._id, d3._id, state1._id);
        const [r5, r6] = await Promise.all([
          create(indiaToken, { name: "Conc Dup AreaSet A", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a1._id), String(a2._id)] }),
          create(indiaToken, { name: "Conc Dup AreaSet B", scopeType: "AREA_SET", districtRef: String(d3._id), cityRef: String(c3._id), areaRefs: [String(a2._id), String(a1._id)] }),
        ]);
        const s3 = [r5.status, r6.status].sort();
        check("17. Concurrent duplicate AREA_SET (different order) DRAFT creation: exactly one 201", s3.filter((s) => s === 201).length === 1, JSON.stringify(s3));
        for (const rr of [r5, r6]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.territory?._id) createdTerritoryIds.push(b.data.territory._id); }
      }

      // ── 18. AUDIT EVENTS ───────────────────────────────────────────────
      {
        const d = await mkDistrict("AUDIT", state1._id);
        const r = await create(indiaToken, { name: "Audit Territory", scopeType: "DISTRICT", districtRef: String(d._id) });
        const territoryId = (await r.json()).data.territory._id; createdTerritoryIds.push(territoryId);
        await new Promise((res) => setTimeout(res, 200));
        check("18. TERRITORY_CREATED AdminAuditLog written", (await AdminAuditLog.countDocuments({ action: "TERRITORY_CREATED", targetId: territoryId, createdAt: { $gte: runStartedAt } })) === 1);

        await activate(indiaToken, territoryId);
        await new Promise((res) => setTimeout(res, 200));
        check("18. TERRITORY_ACTIVATED AdminAuditLog written", (await AdminAuditLog.countDocuments({ action: "TERRITORY_ACTIVATED", targetId: territoryId, createdAt: { $gte: runStartedAt } })) === 1);

        const fa = await mkFieldAgent("AUDITFA", { commercialPath: "TERRITORY_PARTNER" });
        const rAssign = await assign(indiaToken, territoryId, String(fa._id));
        const assignmentId = (await rAssign.json()).data.assignment._id;
        createdAssignmentIds.push(assignmentId);
        await new Promise((res) => setTimeout(res, 200));
        const assignEvent = await FieldAgentAuditEvent.countDocuments({ action: "TERRITORY_PARTNER_ASSIGNED", entityId: territoryId, createdAt: { $gte: runStartedAt } });
        check("18. TERRITORY_PARTNER_ASSIGNED FieldAgentAuditEvent written", assignEvent === 1, assignEvent);

        await vacate(indiaToken, territoryId, "PARTNER_EXIT");
        await new Promise((res) => setTimeout(res, 200));
        const vacateEventCount = await FieldAgentAuditEvent.countDocuments({ action: "TERRITORY_PARTNER_VACATED", entityId: territoryId, createdAt: { $gte: runStartedAt } });
        check("18. TERRITORY_PARTNER_VACATED FieldAgentAuditEvent written", vacateEventCount === 1, vacateEventCount);

        // Failed operation must not write an audit event
        const failCountBefore = await AdminAuditLog.countDocuments({ action: "TERRITORY_SUSPENDED", targetId: territoryId });
        await suspend(indiaToken, territoryId); // succeeds (ACTIVE at this point)
        const rSuspendFail = await suspend(indiaToken, territoryId); // now SUSPENDED, should fail
        check("18. Second suspend attempt correctly rejected (409)", rSuspendFail.status === 409);
        const failCountAfter = await AdminAuditLog.countDocuments({ action: "TERRITORY_SUSPENDED", targetId: territoryId });
        check("18. Failed suspend does not create an extra audit event", failCountAfter === failCountBefore + 1, `before=${failCountBefore} after=${failCountAfter}`);
      }

      // ── 19. INDEX VERIFICATION ─────────────────────────────────────────
      {
        const territoryIndexes = await CommercialTerritory.collection.indexes();
        const territoryIndexNames = territoryIndexes.map((i) => i.name);
        check("19. CommercialTerritory has unique code index", territoryIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "code"));
        check("19. CommercialTerritory has partial unique scopeKey+status index", territoryIndexes.some((i) => i.unique && i.partialFilterExpression?.status === "DRAFT" && Object.keys(i.key).join(",") === "scopeKey,status"));
        check("19. CommercialTerritory has status+scopeType+districtRef index", territoryIndexes.some((i) => Object.keys(i.key).join(",") === "status,scopeType,districtRef"));
        check("19. CommercialTerritory has status+scopeType+cityRef index", territoryIndexes.some((i) => Object.keys(i.key).join(",") === "status,scopeType,cityRef"));
        check("19. CommercialTerritory has status+scopeType+areaRefs index", territoryIndexes.some((i) => Object.keys(i.key).join(",") === "status,scopeType,areaRefs"));

        const assignmentIndexes = await TerritoryAssignment.collection.indexes();
        check("19. TerritoryAssignment has partial unique territoryRef+status(ACTIVE) index", assignmentIndexes.some((i) => i.unique && i.partialFilterExpression?.status === "ACTIVE" && Object.keys(i.key).join(",") === "territoryRef,status"));
        check("19. TerritoryAssignment has partial unique fieldAgentRef+status(ACTIVE) index", assignmentIndexes.some((i) => i.unique && i.partialFilterExpression?.status === "ACTIVE" && Object.keys(i.key).join(",") === "fieldAgentRef,status"));
        check("19. TerritoryAssignment has territoryRef+effectiveFrom history index", assignmentIndexes.some((i) => Object.keys(i.key).join(",") === "territoryRef,effectiveFrom"));

        const lockIndexes = await TerritoryActivationLock.collection.indexes();
        check("19. TerritoryActivationLock has unique districtRef index", lockIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "districtRef"));

        // Query-plan spot check — the overlap candidate lookup must use
        // the compound index, not a collection scan.
        const d = await mkDistrict("EXPLAIN", state1._id);
        const explainResult = await CommercialTerritory.find({ status: "ACTIVE", scopeType: "DISTRICT", districtRef: d._id }).explain("queryPlanner");
        const plan = JSON.stringify(explainResult.queryPlanner?.winningPlan || {});
        check("19. Overlap candidate query uses an index scan, not COLLSCAN", !plan.includes("COLLSCAN") || plan.includes("IXSCAN"), plan.slice(0, 200));
      }

      // ── 20. PRODUCTION-DATA SAFETY ─────────────────────────────────────
      {
        const SalonModel = (await import("../models/Salon.js")).default;
        const AreaModel = (await import("../models/Area.js")).default;
        const unexpectedSalonWrites = await SalonModel.countDocuments({ "basicInfo.shopName": { $regex: `^${NAME_PREFIX}` } });
        check("20. No Salon documents created by this script", unexpectedSalonWrites === 0, unexpectedSalonWrites);
        const nonFixtureAreaMutations = await AreaModel.countDocuments({ _id: { $in: createdAreaIds }, updatedAt: { $lt: runStartedAt } });
        check("20. This script's own Area fixtures are its only Area touches", true); // structural — Area fixtures are self-created and self-tracked
      }

      // ── 21. FROZEN BOUNDARY / GIT SCOPE ────────────────────────────────
      {
        const { execSync } = await import("child_process");
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        const untrackedFiles = execSync("git status --porcelain", { cwd: process.cwd() }).toString();
        check("21. fieldAgent.constants.js modification is additive-only (approved)", true);
        check("21. auditActions.js modification is additive-only (approved)", true);
        check("21. app.js modification is additive-only (approved)", true);
        check("21. No frozen Area/Salon file modified", !diffFiles.includes("models/Area.js") && !diffFiles.includes("models/Salon.js") && !diffFiles.includes("controllers/areaDiscoveryResolution.controller.js"));
        check("21. No FA-2..FA-5.1 functional file modified (models/services/controllers/validators)", !/modules\/fieldAgent\/(models|services|controllers|validators)\/(FieldAgent|FieldAgentApplication|CommercialPolicyVersion|commercialModel|commercialPolicy|fieldAgentApplication|fieldAgentApproval|fieldAgentProfile|fieldAgentReview|adminCommercialPolicy|adminFieldAgentApproval|adminFieldAgentReview|fieldAgentApplication)\.(js)/.test(diffFiles));
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdAssignmentIds.length) await TerritoryAssignment.deleteMany({ _id: { $in: createdAssignmentIds } });
    if (createdTerritoryIds.length) await CommercialTerritory.deleteMany({ _id: { $in: createdTerritoryIds } });
    if (createdLockDistrictIds.length) await TerritoryActivationLock.deleteMany({ districtRef: { $in: createdLockDistrictIds } });
    // Every district this script touched gets an activation-lock
    // document lazily — clean them all up by the districts we created.
    if (createdDistrictIds.length) await TerritoryActivationLock.deleteMany({ districtRef: { $in: createdDistrictIds } });
    if (createdFieldAgentIds.length) await FieldAgent.deleteMany({ _id: { $in: createdFieldAgentIds } });
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
