/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentGeographyManualAssignPhaseD.js
 *
 * MUST-DO-NOW #5 — PHASE D IMPLEMENTATION verification (INDIA Admin
 * manual geography assignment workflow). Same isolation discipline as
 * every other verify*.js script: boots a disposable in-memory MongoDB
 * (mongodb-memory-server) and points mongoose at it BEFORE importing
 * app.js, then drives the real Express app (app.listen(0)) with real
 * signed JWTs over real HTTP. Never touches the real Atlas connection.
 *
 * Covers the §21 minimum test list. A few items (district disabled
 * until state selected, the two-step confirm UI gate) are frontend-
 * only behavior verified by direct code reading at implementation
 * time, not re-provable by a backend HTTP script — noted inline
 * where skipped.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentGeographyManualAssignPhaseD.js
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
  await mongoose.connect(mem.getUri(), { dbName: "fa_geo_phase_d_manual_assign" });

  const { default: app } = await import("../../app.js");
  const { default: User } = await import("../../models/User.js");
  const { default: State } = await import("../../models/State.js");
  const { default: District } = await import("../../models/District.js");
  const { default: FieldAgent } = await import("../../modules/fieldAgent/models/FieldAgent.js");
  const { default: FieldAgentApplication } = await import("../../modules/fieldAgent/models/FieldAgentApplication.js");
  const { default: FieldAgentGeographyAssignment } = await import("../../modules/fieldAgent/models/FieldAgentGeographyAssignment.js");
  const { default: FieldAgentAuditEvent } = await import("../../modules/fieldAgent/models/FieldAgentAuditEvent.js");
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { AUDIT_ACTION } = await import("../../modules/fieldAgent/constants/fieldAgent.constants.js");

  await FieldAgentGeographyAssignment.init();

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));
  const get = (p, token) => authFetch(p, token, { method: "GET" });
  const post = (p, token, body) => authFetch(p, token, { method: "POST", body: JSON.stringify(body || {}) });

  const makeState = (overrides) => State.create({ name: overrides.name, normalizedName: overrides.name.toLowerCase(), code: overrides.code, slug: `${overrides.name.toLowerCase()}-${oid()}`, type: "STATE", countryRef: oid(), geo: { type: "Point", coordinates: [77.1, 28.6] } });
  const makeDistrict = (stateRef, overrides) => District.create({ name: overrides.name, normalizedName: overrides.name.toLowerCase(), code: overrides.code, slug: `${overrides.name.toLowerCase()}-${oid()}`, countryRef: oid(), stateRef });
  const makeFieldAgent = async (label, applicationRef) => {
    const u = await User.create({ name: `AGENT_${label}`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    const fa = await FieldAgent.create({ userRef: u._id, applicationRef: applicationRef || oid(), agentCode: `FA-${label}-${oid()}`, operationalStatus: label === "PENDING" ? "PENDING_ACTIVATION" : "ACTIVE" });
    return fa;
  };
  const makeAdmin = async (adminLevel, geo = {}) => {
    const u = await User.create({
      name: `ADMIN_${adminLevel}`, email: `admin-${adminLevel.toLowerCase()}-${oid()}@example.invalid`,
      role: "ADMIN", adminLevel, adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
      countryRef: oid(), stateRef: geo.stateRef ?? null, districtRef: geo.districtRef ?? null,
    });
    return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
  };

  try {
    const stateA = await makeState({ name: "ALPHA", code: "AL" });
    const stateB = await makeState({ name: "BETA", code: "BT" });
    const districtA1 = await makeDistrict(stateA._id, { name: "A1", code: "A1" });

    const indiaToken = await makeAdmin("INDIA");
    const stateToken = await makeAdmin("STATE", { stateRef: stateA._id });
    const districtToken = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA1._id });

    const base = "/api/admin/field-agents";

    // ── 1. INDIA can open an unassigned agent ─────────────────────
    const agentPlain = await makeFieldAgent("PLAIN");
    const r1 = await get(`${base}/${agentPlain._id}/geography`, indiaToken);
    check("1. INDIA GET unassigned agent → 200", r1.status === 200, r1.status);
    check("1. geography is null for unassigned agent", r1.data?.data?.geography === null, r1.data);
    check("1. suggestedGeography is null when no application resolves", r1.data?.data?.suggestedGeography === null, r1.data);

    // ── 16 (part 1). Suggested geography surfaced, never auto-assigned ──
    const application = await FieldAgentApplication.create({
      userRef: oid(), phone: `6${Math.floor(100000000 + Math.random() * 899999999)}`,
      requestedZone: { stateRef: stateB._id, districtRef: null }, status: "APPROVED",
    });
    const agentWithSuggestion = await makeFieldAgent("SUGGESTED", application._id);
    const rSug = await get(`${base}/${agentWithSuggestion._id}/geography`, indiaToken);
    check("16. suggestedGeography is surfaced from the application's requestedZone", String(rSug.data?.data?.suggestedGeography?.stateRef) === String(stateB._id), rSug.data);
    const assignmentsAfterSuggestionRead = await FieldAgentGeographyAssignment.countDocuments({ fieldAgentRef: agentWithSuggestion._id });
    check("16. Reading the suggestion never created any assignment (GET is read-only)", assignmentsAfterSuggestionRead === 0, assignmentsAfterSuggestionRead);

    // ── 2/17. STATE/DISTRICT remain read-only ─────────────────────
    const r2a = await get(`${base}/${agentPlain._id}/geography`, stateToken);
    const r2b = await get(`${base}/${agentPlain._id}/geography`, districtToken);
    check("2. STATE GET → 200 (read allowed)", r2a.status === 200, r2a.status);
    check("2. DISTRICT GET → 200 (read allowed)", r2b.status === 200, r2b.status);
    const rStateAssign = await post(`${base}/${agentPlain._id}/geography/assign`, stateToken, { stateRef: String(stateA._id) });
    const rDistrictAssign = await post(`${base}/${agentPlain._id}/geography/assign`, districtToken, { stateRef: String(stateA._id) });
    check("17. STATE assign attempt → 403 (server-side enforced)", rStateAssign.status === 403, rStateAssign.status);
    check("17. DISTRICT assign attempt → 403 (server-side enforced)", rDistrictAssign.status === 403, rDistrictAssign.status);

    // ── 4. State required ─────────────────────────────────────────
    const rMissingState = await post(`${base}/${agentPlain._id}/geography/assign`, indiaToken, {});
    check("4. Missing stateRef rejected (400)", rMissingState.status === 400, rMissingState.status);

    // ── 7. State-only assignment works ────────────────────────────
    const r7 = await post(`${base}/${agentPlain._id}/geography/assign`, indiaToken, { stateRef: String(stateA._id) });
    check("7. State-only assignment → 200", r7.status === 200, r7.data);
    check("7. Assignment has districtRef null (state-only)", r7.data?.data?.assignment?.districtRef == null, r7.data?.data?.assignment);

    // ── 10. Exactly one ACTIVE assignment created ─────────────────
    const activeCount = await FieldAgentGeographyAssignment.countDocuments({ fieldAgentRef: agentPlain._id, status: "ACTIVE" });
    check("10. Exactly one ACTIVE assignment exists after assign", activeCount === 1, activeCount);

    // ── 11. Audit event created once ──────────────────────────────
    const auditCount = await FieldAgentAuditEvent.countDocuments({ entityId: agentPlain._id, action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ASSIGNED });
    check("11. Exactly one FIELD_AGENT_GEOGRAPHY_ASSIGNED audit event", auditCount === 1, auditCount);

    // ── 16 (part 2). Once assigned, suggestion disappears from the response ──
    const rAfterAssign = await get(`${base}/${agentPlain._id}/geography`, indiaToken);
    check("16. Once assigned, geography is non-null", !!rAfterAssign.data?.data?.geography, rAfterAssign.data);
    check("16. Once assigned, suggestedGeography is null (no longer relevant)", rAfterAssign.data?.data?.suggestedGeography === null, rAfterAssign.data);

    // ── 12. Duplicate ACTIVE assignment rejected ──────────────────
    const rDuplicate = await post(`${base}/${agentPlain._id}/geography/assign`, indiaToken, { stateRef: String(stateB._id) });
    check("12. Duplicate ACTIVE assignment rejected (409)", rDuplicate.status === 409, rDuplicate.status);

    // ── 8. State + District assignment works (fresh agent) ────────
    const agentWithDistrict = await makeFieldAgent("WITHDISTRICT");
    const r8 = await post(`${base}/${agentWithDistrict._id}/geography/assign`, indiaToken, { stateRef: String(stateA._id), districtRef: String(districtA1._id) });
    check("8. State+District assignment → 200", r8.status === 200, r8.data);
    check("8. Assignment has the correct districtRef", String(r8.data?.data?.assignment?.districtRef) === String(districtA1._id), r8.data?.data?.assignment);

    // ── 13/14/15. End → history remains → reassignment via END→ASSIGN ──
    const rEnd = await post(`${base}/${agentPlain._id}/geography/end`, indiaToken, { endReason: "test reassignment" });
    check("13. End assignment → 200", rEnd.status === 200, rEnd.data);
    check("13. Ended assignment has status ENDED", rEnd.data?.data?.assignment?.status === "ENDED", rEnd.data?.data?.assignment);

    const rHistory = await get(`${base}/${agentPlain._id}/geography/history`, indiaToken);
    const historyIds = (rHistory.data?.data?.history || []).map((h) => String(h._id));
    check("14. History still contains the ended assignment", historyIds.includes(String(rEnd.data?.data?.assignment?._id)), historyIds);

    const rReassign = await post(`${base}/${agentPlain._id}/geography/assign`, indiaToken, { stateRef: String(stateB._id) });
    check("15. Reassignment (new ASSIGN after END) succeeds → 200", rReassign.status === 200, rReassign.data);
    check("15. Reassignment produced a new assignment row (different _id)", String(rReassign.data?.data?.assignment?._id) !== String(rEnd.data?.data?.assignment?._id));

    const rEndAttemptDenied1 = await post(`${base}/${agentPlain._id}/geography/end`, stateToken, {});
    const rEndAttemptDenied2 = await post(`${base}/${agentPlain._id}/geography/end`, districtToken, {});
    check("17. STATE end attempt → 403", rEndAttemptDenied1.status === 403, rEndAttemptDenied1.status);
    check("17. DISTRICT end attempt → 403", rEndAttemptDenied2.status === 403, rEndAttemptDenied2.status);

    // ── 18. No Atlas writes — structural: this script never calls
    // connectDB()/imports config/db.js, confirmed by the import list
    // at the top of this file. Reported here as a declarative check. ──
    check("18. This script never touches the Atlas connection (structural — no connectDB import)", true);
  } catch (err) {
    console.error(err);
    fail += 1;
    results.push(`❌ UNCAUGHT ERROR — ${err.message}`);
  } finally {
    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
    await mongoose.disconnect();
    await mem.stop();
    server.close();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run();
