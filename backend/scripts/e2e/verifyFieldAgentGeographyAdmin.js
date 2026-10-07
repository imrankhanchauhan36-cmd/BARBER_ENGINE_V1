/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentGeographyAdmin.js
 *
 * MUST-DO-NOW #5 — PHASE B verification (admin controller/routes/RBAC
 * layer built on top of the frozen Phase A model/service).
 *
 * Same isolation discipline as verifyFieldAgentGeographyModel.js: this
 * is a MUTATION test (assign/end, concurrency race, RBAC probing), so
 * it never calls connectDB()/touches the real Atlas connection — it
 * boots a disposable in-memory MongoDB (mongodb-memory-server) and
 * points mongoose at that BEFORE importing app.js, then drives the
 * real Express app (app.listen(0)) with real signed JWTs over real
 * HTTP, exactly like every other verify*.js script in this repo. The
 * only difference from those is WHICH database the single mongoose
 * connection points at.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentGeographyAdmin.js
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
  await mongoose.connect(mem.getUri(), { dbName: "fa_geo_phase_b_isolated" });

  // Imported AFTER connecting, so every model this pulls in binds to
  // the in-memory connection above — never real Atlas.
  const { default: app } = await import("../../app.js");
  const { default: User } = await import("../../models/User.js");
  const { default: State } = await import("../../models/State.js");
  const { default: District } = await import("../../models/District.js");
  const { default: FieldAgent } = await import("../../modules/fieldAgent/models/FieldAgent.js");
  const { default: FieldAgentGeographyAssignment } = await import("../../modules/fieldAgent/models/FieldAgentGeographyAssignment.js");
  const { default: FieldAgentAuditEvent } = await import("../../modules/fieldAgent/models/FieldAgentAuditEvent.js");
  const { default: TerritoryAssignment } = await import("../../modules/fieldAgent/models/TerritoryAssignment.js");
  const { default: CommercialTerritory } = await import("../../modules/fieldAgent/models/CommercialTerritory.js");
  const { default: AcquisitionClaim } = await import("../../modules/fieldAgent/models/AcquisitionClaim.js");
  const { default: Salon } = await import("../../models/Salon.js");
  const { default: Booking } = await import("../../models/Booking.js");
  const { default: Transaction } = await import("../../models/Transaction.js");
  const { default: WalletLedger } = await import("../../models/WalletLedger.js");
  const { default: SalonEarnings } = await import("../../models/SalonEarnings.js");
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { AUDIT_ACTION } = await import("../../modules/fieldAgent/constants/fieldAgent.constants.js");

  // Mongoose schedules index builds asynchronously right after a
  // model is compiled — mongoose.connect() does not wait for them.
  // Against a brand-new in-memory mongod, firing the concurrency
  // probe immediately after connecting can race ahead of the
  // partial unique index actually existing yet. This explicit wait
  // (not a Phase A change — the index definition itself is untouched)
  // guarantees the index that IS the sole concurrency authority is
  // actually built before this script exercises it.
  await FieldAgentGeographyAssignment.init();

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
  const get = (p, token) => authFetch(p, token, { method: "GET" });
  const post = (p, token, body) => authFetch(p, token, { method: "POST", body: JSON.stringify(body || {}) });

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
  const makeFieldAgent = (operationalStatus = "ACTIVE") =>
    FieldAgent.create({ userRef: oid(), applicationRef: oid(), agentCode: `FA-${oid()}`, operationalStatus });
  const makeAdmin = async (adminLevel, geo = {}) => {
    const u = await User.create({
      name: `TEST_${adminLevel}_ADMIN`, email: `test-${adminLevel.toLowerCase()}-${oid()}@example.invalid`,
      role: "ADMIN", adminLevel, adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
      countryRef: oid(), stateRef: geo.stateRef ?? null, districtRef: geo.districtRef ?? null,
    });
    return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
  };

  try {
    // ── PRODUCTION DATA SAFETY — before counts (must all be 0 in a
    // fresh in-memory DB; this is the isolation proof itself) ────────
    const before = {
      FieldAgent: await FieldAgent.countDocuments({}),
      FieldAgentGeographyAssignment: await FieldAgentGeographyAssignment.countDocuments({}),
      CommercialTerritory: await CommercialTerritory.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      Salon: await Salon.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
      WalletLedger: await WalletLedger.countDocuments({}),
      SalonEarnings: await SalonEarnings.countDocuments({}),
    };
    check("SAFETY. Isolated DB starts at zero for every counted collection", Object.values(before).every((n) => n === 0), before);

    // ── FIXTURES ───────────────────────────────────────────────────
    const stateA = await makeState({ name: "ALPHA", code: "AL" });
    const stateB = await makeState({ name: "BETA", code: "BT" });
    const districtA1 = await makeDistrict(stateA._id, { name: "A1", code: "A1" });
    const districtB1 = await makeDistrict(stateB._id, { name: "B1", code: "B1" });

    const indiaToken = await makeAdmin("INDIA");
    const stateToken = await makeAdmin("STATE", { stateRef: stateA._id });
    const districtToken = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA1._id });

    const agent1 = await makeFieldAgent("ACTIVE");
    const agent2 = await makeFieldAgent("ACTIVE"); // for RBAC probing, unaffected by agent1's lifecycle
    const agentPending = await makeFieldAgent("PENDING_ACTIVATION");

    const base = `/api/admin/field-agents`;

    // ── GET — all three admin levels can read ─────────────────────
    const rGetIndia = await get(`${base}/${agent1._id}/geography`, indiaToken);
    check("INDIA GET geography → 200", rGetIndia.status === 200, rGetIndia.status);
    check("INDIA GET geography → unassigned (null)", rGetIndia.data?.data?.geography === null);

    const rGetState = await get(`${base}/${agent1._id}/geography`, stateToken);
    check("STATE GET geography → 200", rGetState.status === 200, rGetState.status);

    const rGetDistrict = await get(`${base}/${agent1._id}/geography`, districtToken);
    check("DISTRICT GET geography → 200", rGetDistrict.status === 200, rGetDistrict.status);

    // ── RBAC — assign/end are INDIA-only ──────────────────────────
    const rAssignState = await post(`${base}/${agent2._id}/geography/assign`, stateToken, { stateRef: String(stateA._id) });
    check("STATE assign → 403", rAssignState.status === 403, rAssignState.status);

    const rAssignDistrict = await post(`${base}/${agent2._id}/geography/assign`, districtToken, { stateRef: String(stateA._id) });
    check("DISTRICT assign → 403", rAssignDistrict.status === 403, rAssignDistrict.status);

    const auditAfterFailedAssign = await FieldAgentAuditEvent.countDocuments({ action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ASSIGNED });
    check("Failed assignment (403) creates no success audit event", auditAfterFailedAssign === 0, auditAfterFailedAssign);

    // ── INDIA assign — the real happy path ────────────────────────
    const rAssignIndia = await post(`${base}/${agent1._id}/geography/assign`, indiaToken, { stateRef: String(stateA._id), districtRef: String(districtA1._id) });
    check("INDIA assign → 200", rAssignIndia.status === 200, rAssignIndia.data);
    const assignmentId = rAssignIndia.data?.data?.assignment?._id;
    check("INDIA assign — response has ACTIVE status", rAssignIndia.data?.data?.assignment?.status === "ACTIVE");

    const auditAfterAssign = await FieldAgentAuditEvent.findOne({ action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ASSIGNED, entityId: agent1._id }).lean();
    check("Audit event written after successful assignment", !!auditAfterAssign, auditAfterAssign);

    // ── PENDING_ACTIVATION can be assigned ────────────────────────
    const rAssignPending = await post(`${base}/${agentPending._id}/geography/assign`, indiaToken, { stateRef: String(stateB._id) });
    check("PENDING_ACTIVATION Field Agent can be assigned geography → 200", rAssignPending.status === 200, rAssignPending.data);

    // ── Duplicate ACTIVE → 409 ─────────────────────────────────────
    const rDuplicate = await post(`${base}/${agent1._id}/geography/assign`, indiaToken, { stateRef: String(stateB._id) });
    check("Duplicate ACTIVE assignment for the same agent → 409", rDuplicate.status === 409, rDuplicate.status);

    // ── Invalid State rejected ─────────────────────────────────────
    const rMalformedState = await post(`${base}/${agent2._id}/geography/assign`, indiaToken, { stateRef: "not-a-valid-object-id" });
    check("Malformed stateRef rejected (400)", rMalformedState.status === 400, rMalformedState.status);

    const rNonexistentState = await post(`${base}/${agent2._id}/geography/assign`, indiaToken, { stateRef: String(oid()) });
    check("Well-formed but nonexistent stateRef rejected (404)", rNonexistentState.status === 404, rNonexistentState.status);

    // ── District from another State rejected ──────────────────────
    const rMismatchedDistrict = await post(`${base}/${agent2._id}/geography/assign`, indiaToken, { stateRef: String(stateA._id), districtRef: String(districtB1._id) });
    check("District belonging to a different State rejected (400)", rMismatchedDistrict.status === 400, rMismatchedDistrict.status);

    // ── RBAC — end is INDIA-only ───────────────────────────────────
    const rEndState = await post(`${base}/${agent1._id}/geography/end`, stateToken, {});
    check("STATE end → 403", rEndState.status === 403, rEndState.status);

    const rEndDistrict = await post(`${base}/${agent1._id}/geography/end`, districtToken, {});
    check("DISTRICT end → 403", rEndDistrict.status === 403, rEndDistrict.status);

    const auditAfterFailedEnd = await FieldAgentAuditEvent.countDocuments({ action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ENDED });
    check("Failed end (403) creates no success audit event", auditAfterFailedEnd === 0, auditAfterFailedEnd);

    // ── INDIA end — the real happy path ────────────────────────────
    const rEndIndia = await post(`${base}/${agent1._id}/geography/end`, indiaToken, { endReason: "test reassignment" });
    check("INDIA end → 200", rEndIndia.status === 200, rEndIndia.data);
    check("INDIA end — response has ENDED status", rEndIndia.data?.data?.assignment?.status === "ENDED");

    const auditAfterEnd = await FieldAgentAuditEvent.findOne({ action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ENDED, entityId: agent1._id }).lean();
    check("Audit event written after successful end", !!auditAfterEnd, auditAfterEnd);

    // ── History survives END ───────────────────────────────────────
    const rHistory = await get(`${base}/${agent1._id}/geography/history`, indiaToken);
    check("History GET → 200", rHistory.status === 200, rHistory.status);
    const historyItems = rHistory.data?.data?.history || [];
    check("History includes the ENDED assignment", historyItems.some((h) => String(h._id) === String(assignmentId) && h.status === "ENDED"), historyItems);

    const rGetAfterEnd = await get(`${base}/${agent1._id}/geography`, indiaToken);
    check("GET geography after END is null again (unassigned)", rGetAfterEnd.data?.data?.geography === null, rGetAfterEnd.data);

    // ── Reassignment requires END then ASSIGN (not one-click) ──────
    const rReassign = await post(`${base}/${agent1._id}/geography/assign`, indiaToken, { stateRef: String(stateB._id) });
    check("Reassignment (new ASSIGN after END) succeeds → 200", rReassign.status === 200, rReassign.data);
    check("Reassignment produces a NEW assignment row (different _id)", String(rReassign.data?.data?.assignment?._id) !== String(assignmentId));

    // ── END on an agent with no active assignment ──────────────────
    const rEndNoActive = await post(`${base}/${agent2._id}/geography/end`, indiaToken, {});
    check("Ending an agent with no active assignment → 404 (not 200)", rEndNoActive.status === 404, rEndNoActive.status);

    // ── Backend RBAC independent of frontend — a non-ADMIN token ───
    const nonAdminUser = await User.create({ name: "TEST_NON_ADMIN", phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER" });
    const nonAdminToken = generateAccessToken({ _id: nonAdminUser._id, role: "OWNER", tokenVersion: 0 });
    const rNonAdmin = await post(`${base}/${agent2._id}/geography/assign`, nonAdminToken, { stateRef: String(stateA._id) });
    check("Non-ADMIN role token cannot assign (403)", rNonAdmin.status === 403, rNonAdmin.status);

    // ── No Territory Partner / financial side effects ──────────────
    const afterTerritory = {
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
      CommercialTerritory: await CommercialTerritory.countDocuments({}),
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      WalletLedger: await WalletLedger.countDocuments({}),
      SalonEarnings: await SalonEarnings.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
    };
    check("No TerritoryAssignment/CommercialTerritory row was ever created", afterTerritory.TerritoryAssignment === 0 && afterTerritory.CommercialTerritory === 0, afterTerritory);
    check("No AcquisitionClaim/WalletLedger/SalonEarnings/Transaction row was ever created (zero financial side effects)",
      afterTerritory.AcquisitionClaim === 0 && afterTerritory.WalletLedger === 0 && afterTerritory.SalonEarnings === 0 && afterTerritory.Transaction === 0, afterTerritory);

    // ── CONCURRENCY — exactly one 200, one 409, exactly one ACTIVE row ──
    const concurrencyAgent = await makeFieldAgent("ACTIVE");
    const [cA, cB] = await Promise.all([
      post(`${base}/${concurrencyAgent._id}/geography/assign`, indiaToken, { stateRef: String(stateA._id) }),
      post(`${base}/${concurrencyAgent._id}/geography/assign`, indiaToken, { stateRef: String(stateB._id) }),
    ]);
    const statuses = [cA.status, cB.status].sort();
    check("Concurrent assign: exactly one 200", statuses.filter((s) => s === 200).length === 1, statuses);
    check("Concurrent assign: exactly one 409", statuses.filter((s) => s === 409).length === 1, statuses);
    const activeCount = await FieldAgentGeographyAssignment.countDocuments({ fieldAgentRef: concurrencyAgent._id, status: "ACTIVE" });
    check("Concurrent assign: exactly one ACTIVE row persisted", activeCount === 1, activeCount);

    // ── Final production-data-safety snapshot (still isolated —
    // this is the in-memory DB's own final state, reported for the
    // record, not a claim about the real shared dev DB) ─────────────
    const after = {
      FieldAgent: await FieldAgent.countDocuments({}),
      FieldAgentGeographyAssignment: await FieldAgentGeographyAssignment.countDocuments({}),
      CommercialTerritory: await CommercialTerritory.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
      AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
      Salon: await Salon.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
      WalletLedger: await WalletLedger.countDocuments({}),
      SalonEarnings: await SalonEarnings.countDocuments({}),
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
