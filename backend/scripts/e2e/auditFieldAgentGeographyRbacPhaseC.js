/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/auditFieldAgentGeographyRbacPhaseC.js
 *
 * MUST-DO-NOW #5 — PHASE C AUDIT ONLY. This is a disposable,
 * READ-ONLY-FOR-PRODUCTION diagnostic script, not a pass/fail test
 * suite and not a permanent fixture of this repo. It empirically
 * proves (or disproves) the current roster/detail authorization
 * behavior against the exact Agent A/B/C/D cross-geography matrix the
 * audit ticket specifies — using an isolated in-memory MongoDB
 * (mongodb-memory-server), never the real Atlas connection. No write
 * to production code or data happens here.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/auditFieldAgentGeographyRbacPhaseC.js
 */

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const log = (...args) => console.log(...args);
const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: "fa_geo_phase_c_audit" });

  const { default: app } = await import("../../app.js");
  const { default: User } = await import("../../models/User.js");
  const { default: State } = await import("../../models/State.js");
  const { default: District } = await import("../../models/District.js");
  const { default: FieldAgent } = await import("../../modules/fieldAgent/models/FieldAgent.js");
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { assignFieldAgentGeography } = await import("../../modules/fieldAgent/services/fieldAgentGeography.service.js");

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token) =>
    fetch(url(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const makeState = (overrides = {}) =>
    State.create({
      name: overrides.name, normalizedName: overrides.name.toLowerCase(),
      code: overrides.code, slug: `${overrides.name.toLowerCase()}-${oid()}`,
      type: "STATE", countryRef: oid(), geo: { type: "Point", coordinates: [77.1, 28.6] },
    });
  const makeDistrict = (stateRef, overrides = {}) =>
    District.create({
      name: overrides.name, normalizedName: overrides.name.toLowerCase(),
      code: overrides.code, slug: `${overrides.name.toLowerCase()}-${oid()}`,
      countryRef: oid(), stateRef,
    });
  const makeFieldAgent = (label) =>
    FieldAgent.create({ userRef: oid(), applicationRef: oid(), agentCode: `FA-${label}-${oid()}`, operationalStatus: "ACTIVE" });
  const makeAdmin = async (adminLevel, geo = {}) => {
    const u = await User.create({
      name: `AUDIT_${adminLevel}_${geo.label || "ADMIN"}`, email: `audit-${adminLevel.toLowerCase()}-${oid()}@example.invalid`,
      role: "ADMIN", adminLevel, adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
      countryRef: oid(), stateRef: geo.stateRef ?? null, districtRef: geo.districtRef ?? null,
    });
    return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
  };

  try {
    const stateA = await makeState({ name: "ALPHA", code: "AL" });
    const stateB = await makeState({ name: "BETA", code: "BT" });
    const districtA1 = await makeDistrict(stateA._id, { name: "A1", code: "A1" });
    const districtA2 = await makeDistrict(stateA._id, { name: "A2", code: "A2" });
    const districtB1 = await makeDistrict(stateB._id, { name: "B1", code: "B1" });

    const agentA = await makeFieldAgent("A"); // State A / District A1
    const agentB = await makeFieldAgent("B"); // State B / District B1
    const agentC = await makeFieldAgent("C"); // State A / District A2
    const agentD = await makeFieldAgent("D"); // UNASSIGNED

    const systemActor = oid();
    await assignFieldAgentGeography({ fieldAgentRef: agentA._id, stateRef: stateA._id, districtRef: districtA1._id, assignedBy: systemActor });
    await assignFieldAgentGeography({ fieldAgentRef: agentB._id, stateRef: stateB._id, districtRef: districtB1._id, assignedBy: systemActor });
    await assignFieldAgentGeography({ fieldAgentRef: agentC._id, stateRef: stateA._id, districtRef: districtA2._id, assignedBy: systemActor });
    // agentD deliberately left unassigned.

    const indiaToken    = await makeAdmin("INDIA");
    const stateAToken   = await makeAdmin("STATE", { stateRef: stateA._id, label: "STATEA" });
    const stateBToken   = await makeAdmin("STATE", { stateRef: stateB._id, label: "STATEB" });
    const districtA1Token = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA1._id, label: "DISTA1" });
    const districtA2Token = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA2._id, label: "DISTA2" });

    const agents = { A: agentA, B: agentB, C: agentC, D: agentD };

    log("\n================ ROSTER (GET /api/admin/field-agents/roster) ================\n");
    for (const [label, token] of [["INDIA", indiaToken], ["STATE-A", stateAToken], ["STATE-B", stateBToken], ["DISTRICT-A1", districtA1Token], ["DISTRICT-A2", districtA2Token]]) {
      const res = await authFetch(`/api/admin/field-agents/roster?limit=100`, token);
      const idsReturned = (res.data?.data?.agents || res.data?.data?.items || []).map((a) => String(a._id || a.id));
      const visibleLabels = Object.entries(agents).filter(([, doc]) => idsReturned.includes(String(doc._id))).map(([l]) => l);
      log(`${label.padEnd(12)} status=${res.status} total=${res.data?.pagination?.total ?? res.data?.data?.total ?? "?"} visibleAgents=[${visibleLabels.join(",")}]`);
    }

    log("\n================ DETAIL (GET /api/admin/field-agents/:id/summary) ================\n");
    for (const [adminLabel, token] of [["INDIA", indiaToken], ["STATE-A", stateAToken], ["STATE-B", stateBToken], ["DISTRICT-A1", districtA1Token], ["DISTRICT-A2", districtA2Token]]) {
      const row = [];
      for (const [agentLabel, doc] of Object.entries(agents)) {
        const res = await authFetch(`/api/admin/field-agents/${doc._id}/summary`, token);
        row.push(`${agentLabel}:${res.status}`);
      }
      log(`${adminLabel.padEnd(12)} ${row.join("  ")}`);
    }

    log("\n================ EXPECTED (if Phase C scoping existed) ================\n");
    log("INDIA        total=4  visibleAgents=[A,B,C,D]");
    log("STATE-A      total=2  visibleAgents=[A,C]      (B,D hidden)");
    log("STATE-B      total=1  visibleAgents=[B]        (A,C,D hidden)");
    log("DISTRICT-A1  total=1  visibleAgents=[A]         (B,C,D hidden)");
    log("DISTRICT-A2  total=1  visibleAgents=[C]         (A,B,D hidden)");
    log("Detail: each admin above should get 200 only for their own visible agents, 403/404 for the rest.");
  } finally {
    await mongoose.disconnect();
    await mem.stop();
    server.close();
    process.exit(0);
  }
};

run();
