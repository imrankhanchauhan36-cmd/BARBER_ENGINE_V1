/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyAdminPanelSecurityFixesPhase6.js
 *
 * ADMIN PANEL MUST-DO-NOW #6 PHASE #6 — SECURITY + HONESTY FIXES.
 * Verifies the three real RBAC/geography-scope gaps fixed this phase:
 *
 *   GAP A — forceCloseSalon (backend/controllers/admin.controller.js)
 *           had no geography-scope check beyond the adminLevel
 *           allow-list; a STATE admin could force-close any salon
 *           nationwide.
 *   GAP B — GET /api/salon/admin (legacy router, backend/routes/
 *           salon.routes.js → getSalonsForAdmin in
 *           backend/controllers/salon.controller.js) had no
 *           requireAdminLevel at all and its scope filter had no
 *           DISTRICT branch, so a DISTRICT admin fell through with
 *           no scope filter and received every salon nationwide.
 *   GAP C — backend/controllers/state.controller.js#getStateById/
 *           #getStateSummary and backend/controllers/
 *           district.controller.js#getDistrictAuditLog were missing
 *           scope checks that sibling functions in the same files
 *           already correctly implement.
 *
 * Same isolation discipline as verifyFieldAgentGeographyAdmin.js
 * (Phase B): boots a disposable in-memory MongoDB (mongodb-memory-
 * server) and points mongoose at it BEFORE importing app.js, then
 * drives the real Express app (app.listen(0)) with real signed JWTs
 * over real HTTP. Never touches the real Atlas connection.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyAdminPanelSecurityFixesPhase6.js
 */

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: "admin_panel_security_phase6_isolated" });

  const { default: app } = await import("../../app.js");
  const { default: User } = await import("../../models/User.js");
  const { default: State } = await import("../../models/State.js");
  const { default: District } = await import("../../models/District.js");
  const { default: Salon } = await import("../../models/Salon.js");
  const { default: AdminAuditLog } = await import("../../models/AdminAuditLog.js");
  const { generateAccessToken } = await import("../../services/token.service.js");

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));
  const get   = (p, token) => authFetch(p, token, { method: "GET" });
  const patch = (p, token, body) => authFetch(p, token, { method: "PATCH", body: JSON.stringify(body || {}) });

  const makeState = (overrides = {}) =>
    State.create({
      name: overrides.name || "TESTSTATE", normalizedName: (overrides.name || "teststate").toLowerCase(),
      code: overrides.code || "TS", slug: overrides.slug || `teststate-${oid()}`,
      type: "STATE", countryRef: oid(), geo: { type: "Point", coordinates: [77.1, 28.6] },
    });
  const makeDistrict = (stateRef, overrides = {}) =>
    District.create({
      name: overrides.name || "TESTDISTRICT", normalizedName: (overrides.name || "testdistrict").toLowerCase(),
      code: overrides.code || "TD", slug: overrides.slug || `testdistrict-${oid()}`,
      countryRef: oid(), stateRef,
    });
  const makeAdmin = async (adminLevel, geo = {}) => {
    const u = await User.create({
      name: `TEST_${adminLevel}_ADMIN_${oid()}`, email: `test-${String(adminLevel).toLowerCase()}-${oid()}@example.invalid`,
      role: "ADMIN", adminLevel, adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
      countryRef: oid(), stateRef: geo.stateRef ?? null, districtRef: geo.districtRef ?? null,
    });
    return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
  };
  const makeSalon = async (stateRef, districtRef, overrides = {}) => {
    const owner = await User.create({ name: `TEST_OWNER_${oid()}`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER" });
    const dayTiming = { open: "09:00", close: "20:00" };
    const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    return Salon.create({
      ownerId: owner._id,
      basicInfo: { shopName: `TEST_SALON_${oid()}`, category: "UNISEX" },
      location: { territory: { stateRef, districtRef } },
      timings,
      approval: { status: "APPROVED" },
      business: { isForceClosed: false, isShopOpen: true },
      isDeleted: false,
      ...overrides,
    });
  };

  try {
    // ── FIXTURES ───────────────────────────────────────────────────
    const stateA = await makeState({ name: "ALPHA", code: "AL" });
    const stateB = await makeState({ name: "BETA", code: "BT" });
    const districtA1 = await makeDistrict(stateA._id, { name: "A1", code: "A1" });
    const districtA2 = await makeDistrict(stateA._id, { name: "A2", code: "A2" });
    const districtB1 = await makeDistrict(stateB._id, { name: "B1", code: "B1" });

    const indiaToken      = await makeAdmin("INDIA");
    const stateAToken     = await makeAdmin("STATE", { stateRef: stateA._id });
    const stateBToken     = await makeAdmin("STATE", { stateRef: stateB._id });
    const districtA1Token = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA1._id });
    const districtB1Token = await makeAdmin("DISTRICT", { stateRef: stateB._id, districtRef: districtB1._id });

    // An ADMIN-role user with no adminLevel configured at all —
    // exercises requireAdminLevel's own fail-closed branch. The User
    // schema's own pre-validate hook makes `adminLevel` required for
    // role ADMIN (confirmed: Model.create() throws "adminLevel
    // required"), so this legacy/corrupted-data shape is simulated
    // with a raw driver insert that bypasses Mongoose validation —
    // exactly the kind of pre-existing bad row requireAdminLevel's
    // "Admin level not configured" branch exists to fail closed on.
    const noLevelUserId = oid();
    await User.collection.insertOne({ _id: noLevelUserId, name: "TEST_NO_LEVEL_ADMIN", email: `test-nolevel-${oid()}@example.invalid`, role: "ADMIN", countryRef: oid() });
    const noLevelToken = generateAccessToken({ _id: noLevelUserId, role: "ADMIN", tokenVersion: 0 });

    // =================================================================
    // GAP A — forceCloseSalon geography scope
    // =================================================================
    const salonA1 = await makeSalon(stateA._id, districtA1._id);
    const rA1 = await patch(`/api/admin/salons/${salonA1._id}/force-close`, stateAToken);
    check("GAP A-1. STATE admin force-close OWN-state salon → 200", rA1.status === 200, rA1.data);
    const salonA1After = await Salon.findById(salonA1._id).lean();
    check("GAP A-1. Salon actually force-closed in DB", salonA1After.business.isForceClosed === true, salonA1After.business);

    const salonB1 = await makeSalon(stateB._id, districtB1._id);
    const rA2 = await patch(`/api/admin/salons/${salonB1._id}/force-close`, stateAToken);
    check("GAP A-2. STATE admin force-close OTHER-state salon → 403", rA2.status === 403, rA2.data);
    const salonB1After = await Salon.findById(salonB1._id).lean();
    check("GAP A-2. Other-state salon left untouched after 403", salonB1After.business.isForceClosed === false, salonB1After.business);

    const salonA2 = await makeSalon(stateA._id, districtA1._id);
    const rA3 = await patch(`/api/admin/salons/${salonA2._id}/force-close`, indiaToken);
    check("GAP A-3. INDIA admin force-close ANY-state salon → 200", rA3.status === 200, rA3.data);

    // =================================================================
    // GAP B — GET /api/salon/admin scope
    // =================================================================
    // Clear any pre-existing APPROVED salons from the GAP A section
    // don't matter here since they're state-scoped by construction;
    // add a clean, known set per-state/district for exact-count checks.
    await Salon.deleteMany({});
    const sA1 = await makeSalon(stateA._id, districtA1._id);
    const sA2 = await makeSalon(stateA._id, districtA2._id);
    const sB1 = await makeSalon(stateB._id, districtB1._id);

    const rB1 = await get(`/api/salon/admin`, indiaToken);
    check("GAP B-1. INDIA admin GET /api/salon/admin → 200", rB1.status === 200, rB1.data);
    check("GAP B-1. INDIA admin sees ALL salons (no scope filter)", rB1.data?.data?.length === 3, rB1.data?.data?.length);

    const rB2 = await get(`/api/salon/admin`, stateAToken);
    check("GAP B-2. STATE admin GET /api/salon/admin → 200", rB2.status === 200, rB2.data);
    const stateAIds = (rB2.data?.data || []).map((s) => String(s._id)).sort();
    check(
      "GAP B-2. STATE admin sees ONLY own-state salons (A1, A2 — not B1)",
      JSON.stringify(stateAIds) === JSON.stringify([String(sA1._id), String(sA2._id)].sort()),
      stateAIds
    );

    const rB3 = await get(`/api/salon/admin`, districtA1Token);
    check("GAP B-3. DISTRICT admin GET /api/salon/admin → 200", rB3.status === 200, rB3.data);
    const districtA1Ids = (rB3.data?.data || []).map((s) => String(s._id));
    check(
      "GAP B-3. DISTRICT admin sees ONLY own-district salons (A1 — not A2 or B1)",
      districtA1Ids.length === 1 && districtA1Ids[0] === String(sA1._id),
      districtA1Ids
    );

    const rB4 = await get(`/api/salon/admin`, noLevelToken);
    check("GAP B-4. ADMIN role with no adminLevel configured → 403", rB4.status === 403, rB4.data);

    // =================================================================
    // GAP C — state/district detail scope
    // =================================================================
    // getStateById
    const rC1 = await get(`/api/admin/states/${stateA._id}`, districtA1Token);
    check("GAP C-1. DISTRICT admin getStateById OWN state → 200", rC1.status === 200, rC1.data);

    const rC2 = await get(`/api/admin/states/${stateB._id}`, districtA1Token);
    check("GAP C-2. DISTRICT admin getStateById OTHER state → 403", rC2.status === 403, rC2.data);

    const rC3 = await get(`/api/admin/states/${stateA._id}`, stateAToken);
    check("GAP C-3. STATE admin getStateById OWN state → 200 (regression)", rC3.status === 200, rC3.data);

    const rC4 = await get(`/api/admin/states/${stateB._id}`, stateAToken);
    check("GAP C-4. STATE admin getStateById OTHER state → 403 (regression)", rC4.status === 403, rC4.data);

    // getStateSummary — previously had NO scope check at all
    const rC5 = await get(`/api/admin/states/${stateA._id}/summary`, stateAToken);
    check("GAP C-5. STATE admin getStateSummary OWN state → 200", rC5.status === 200, rC5.data);

    const rC6 = await get(`/api/admin/states/${stateB._id}/summary`, stateAToken);
    check("GAP C-6. STATE admin getStateSummary OTHER state → 403 (NEW fix)", rC6.status === 403, rC6.data);

    const rC7 = await get(`/api/admin/states/${stateA._id}/summary`, districtA1Token);
    check("GAP C-7. DISTRICT admin getStateSummary OWN state → 200", rC7.status === 200, rC7.data);

    const rC8 = await get(`/api/admin/states/${stateB._id}/summary`, districtA1Token);
    check("GAP C-8. DISTRICT admin getStateSummary OTHER state → 403 (NEW fix)", rC8.status === 403, rC8.data);

    // getDistrictAuditLog — previously had NO scope check at all
    const rC9 = await get(`/api/admin/districts/${districtA1._id}/audit`, districtA1Token);
    check("GAP C-9. DISTRICT admin getDistrictAuditLog OWN district → 200", rC9.status === 200, rC9.data);

    const rC10 = await get(`/api/admin/districts/${districtA2._id}/audit`, districtA1Token);
    check("GAP C-10. DISTRICT admin getDistrictAuditLog OTHER district (same state) → 403 (NEW fix)", rC10.status === 403, rC10.data);

    const rC11 = await get(`/api/admin/districts/${districtA1._id}/audit`, stateAToken);
    check("GAP C-11. STATE admin getDistrictAuditLog district in OWN state → 200", rC11.status === 200, rC11.data);

    const rC12 = await get(`/api/admin/districts/${districtB1._id}/audit`, stateAToken);
    check("GAP C-12. STATE admin getDistrictAuditLog district in OTHER state → 403 (NEW fix)", rC12.status === 403, rC12.data);

    const rC13 = await get(`/api/admin/districts/${districtA1._id}/audit`, indiaToken);
    check("GAP C-13. INDIA admin getDistrictAuditLog ANY district → 200", rC13.status === 200, rC13.data);

    // ── PRODUCTION DATA SAFETY — this is the isolated in-memory DB's
    // own final state, reported for the record only (never a claim
    // about the real shared dev DB) ─────────────────────────────────
    const after = {
      User: await User.countDocuments({}),
      State: await State.countDocuments({}),
      District: await District.countDocuments({}),
      Salon: await Salon.countDocuments({}),
      AdminAuditLog: await AdminAuditLog.countDocuments({}),
    };
    results.push(`ℹ️  Isolated in-memory DB final counts (not the shared dev DB): ${JSON.stringify(after)}`);
  } catch (err) {
    console.error(err);
    fail += 1;
    results.push(`❌ UNCAUGHT ERROR — ${err.message}`);
  } finally {
    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);

    await mongoose.disconnect();
    await mem.stop();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run();
