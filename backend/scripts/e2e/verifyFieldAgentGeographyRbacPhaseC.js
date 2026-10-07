/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentGeographyRbacPhaseC.js
 *
 * MUST-DO-NOW #5 — PHASE C IMPLEMENTATION verification. Same
 * isolation discipline as every other verify*.js script in this
 * repo: boots a disposable in-memory MongoDB (mongodb-memory-server)
 * and points mongoose at it BEFORE importing app.js, then drives the
 * real Express app (app.listen(0)) with real signed JWTs over real
 * HTTP. Never touches the real Atlas connection.
 *
 * Covers every category in the Phase C ticket's §17 minimum coverage
 * list (A-P) plus the exact cross-geography matrix in §18-22.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentGeographyRbacPhaseC.js
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
  await mongoose.connect(mem.getUri(), { dbName: "fa_geo_phase_c_impl" });

  const { default: app } = await import("../../app.js");
  const { default: User } = await import("../../models/User.js");
  const { default: State } = await import("../../models/State.js");
  const { default: District } = await import("../../models/District.js");
  const { default: FieldAgent } = await import("../../modules/fieldAgent/models/FieldAgent.js");
  const { default: FieldAgentGeographyAssignment } = await import("../../modules/fieldAgent/models/FieldAgentGeographyAssignment.js");
  const { default: FieldAgentEarningLedger } = await import("../../modules/fieldAgent/models/FieldAgentEarningLedger.js");
  const { generateAccessToken } = await import("../../services/token.service.js");
  const { assignFieldAgentGeography, endFieldAgentGeography, getActiveFieldAgentGeography } = await import("../../modules/fieldAgent/services/fieldAgentGeography.service.js");

  await FieldAgentGeographyAssignment.init(); // see Phase B's own fix — avoid racing the index build

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token) =>
    fetch(url(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const makeState = (overrides) =>
    State.create({ name: overrides.name, normalizedName: overrides.name.toLowerCase(), code: overrides.code, slug: `${overrides.name.toLowerCase()}-${oid()}`, type: "STATE", countryRef: oid(), geo: { type: "Point", coordinates: [77.1, 28.6] } });
  const makeDistrict = (stateRef, overrides) =>
    District.create({ name: overrides.name, normalizedName: overrides.name.toLowerCase(), code: overrides.code, slug: `${overrides.name.toLowerCase()}-${oid()}`, countryRef: oid(), stateRef });
  const makeFieldAgent = async (label, { name, phone } = {}) => {
    const u = await User.create({ name: name || `AGENT_${label}`, phone: phone || `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    const fa = await FieldAgent.create({ userRef: u._id, applicationRef: oid(), agentCode: `FA-${label}-${oid()}`, operationalStatus: "ACTIVE" });
    return { user: u, fieldAgent: fa };
  };
  const makeAdmin = async (adminLevel, geo = {}) => {
    const u = await User.create({
      name: `ADMIN_${adminLevel}_${geo.label || ""}`, email: `admin-${adminLevel.toLowerCase()}-${geo.label || "x"}-${oid()}@example.invalid`,
      role: "ADMIN", adminLevel, adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
      countryRef: oid(), stateRef: geo.stateRef ?? null, districtRef: geo.districtRef ?? null,
    });
    return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
  };
  const addLedgerRow = (fieldAgentRef, amountInPaise) =>
    FieldAgentEarningLedger.create({
      fieldAgentRef, bookingRef: oid(), entitlementType: "ACQUISITION", policySource: "NATIONAL",
      policyVersionRef: oid(), appliedRatePercent: 10, bookingCommissionAmountInPaise: amountInPaise * 10,
      rawEligibleAmountInPaise: amountInPaise, creditedAmountInPaise: amountInPaise, creditOutcome: "CREDITED",
      idempotencyKey: `test:${oid()}`, bookingCompletedAt: new Date(),
    });

  try {
    const systemActor = oid();
    const stateA = await makeState({ name: "ALPHA", code: "AL" });
    const stateB = await makeState({ name: "BETA", code: "BT" });
    const districtA1 = await makeDistrict(stateA._id, { name: "A1", code: "A1" });
    const districtA2 = await makeDistrict(stateA._id, { name: "A2", code: "A2" });
    const districtB1 = await makeDistrict(stateB._id, { name: "B1", code: "B1" });

    const { user: userA, fieldAgent: agentA } = await makeFieldAgent("A", { name: "AgentAlphaOne" });
    const { user: userB, fieldAgent: agentB } = await makeFieldAgent("B", { name: "AgentBetaOne" });
    const { user: userC, fieldAgent: agentC } = await makeFieldAgent("C", { name: "AgentAlphaTwo" });
    const { fieldAgent: agentD } = await makeFieldAgent("D", { name: "AgentUnassigned" });

    await assignFieldAgentGeography({ fieldAgentRef: agentA._id, stateRef: stateA._id, districtRef: districtA1._id, assignedBy: systemActor });
    await assignFieldAgentGeography({ fieldAgentRef: agentB._id, stateRef: stateB._id, districtRef: districtB1._id, assignedBy: systemActor });
    await assignFieldAgentGeography({ fieldAgentRef: agentC._id, stateRef: stateA._id, districtRef: districtA2._id, assignedBy: systemActor });

    await addLedgerRow(agentA._id, 10000);
    await addLedgerRow(agentB._id, 20000);
    await addLedgerRow(agentC._id, 30000);
    await addLedgerRow(agentD._id, 99999); // highest earner — must never appear for STATE/DISTRICT

    const indiaToken = await makeAdmin("INDIA");
    const stateAToken = await makeAdmin("STATE", { stateRef: stateA._id, label: "A" });
    const stateBToken = await makeAdmin("STATE", { stateRef: stateB._id, label: "B" });
    const distA1Token = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA1._id, label: "A1" });
    const distA2Token = await makeAdmin("DISTRICT", { stateRef: stateA._id, districtRef: districtA2._id, label: "A2" });

    const admins = { INDIA: indiaToken, "STATE-A": stateAToken, "STATE-B": stateBToken, "DISTRICT-A1": distA1Token, "DISTRICT-A2": distA2Token };
    const agents = { A: agentA, B: agentB, C: agentC, D: agentD };
    const EXPECTED_VISIBLE = {
      INDIA: ["A", "B", "C", "D"],
      "STATE-A": ["A", "C"],
      "STATE-B": ["B"],
      "DISTRICT-A1": ["A"],
      "DISTRICT-A2": ["C"],
    };

    // ══════════════ A/C/D. ROSTER + PAGINATION + COUNT ══════════════
    for (const [label, token] of Object.entries(admins)) {
      const res = await authFetch(`/api/admin/field-agents/roster?limit=100`, token);
      const idsReturned = (res.data?.data?.agents || []).map((a) => String(a.id));
      const visible = Object.entries(agents).filter(([, doc]) => idsReturned.includes(String(doc._id))).map(([l]) => l).sort();
      check(`A. Roster[${label}] returns 200`, res.status === 200, res.status);
      check(`A. Roster[${label}] visible=${visible.join(",")} matches expected=${EXPECTED_VISIBLE[label].join(",")}`, JSON.stringify(visible) === JSON.stringify([...EXPECTED_VISIBLE[label]].sort()), { visible, expected: EXPECTED_VISIBLE[label] });
      check(`D. Roster[${label}] total=${res.data?.pagination?.total} matches expected count`, res.data?.pagination?.total === EXPECTED_VISIBLE[label].length, res.data?.pagination);
    }

    // C. Pagination — STATE-A has exactly 2 (A, C); page through with limit=1
    {
      const p1 = await authFetch(`/api/admin/field-agents/roster?limit=1&page=1`, stateAToken);
      const p2 = await authFetch(`/api/admin/field-agents/roster?limit=1&page=2`, stateAToken);
      const p3 = await authFetch(`/api/admin/field-agents/roster?limit=1&page=3`, stateAToken);
      check("C. STATE-A page1 limit1 returns exactly 1 row", (p1.data?.data?.agents || []).length === 1, p1.data);
      check("C. STATE-A page2 limit1 returns exactly 1 row", (p2.data?.data?.agents || []).length === 1, p2.data);
      check("C. STATE-A page3 limit1 returns 0 rows (never nationwide)", (p3.data?.data?.agents || []).length === 0, p3.data);
      const combinedIds = new Set([...(p1.data?.data?.agents || []), ...(p2.data?.data?.agents || [])].map((a) => String(a.id)));
      check("C. Pages 1+2 together are exactly {A,C}, nothing else", combinedIds.size === 2 && combinedIds.has(String(agentA._id)) && combinedIds.has(String(agentC._id)), [...combinedIds]);
    }

    // B. Search cannot bypass geography
    {
      const rStateASearchesB = await authFetch(`/api/admin/field-agents/roster?search=AgentBetaOne`, stateAToken);
      check("B. STATE-A searching Agent B's name returns zero results", (rStateASearchesB.data?.data?.agents || []).length === 0, rStateASearchesB.data);

      const rDistA1SearchesC = await authFetch(`/api/admin/field-agents/roster?search=AgentAlphaTwo`, distA1Token);
      check("B. DISTRICT-A1 searching Agent C's name returns zero results", (rDistA1SearchesC.data?.data?.agents || []).length === 0, rDistA1SearchesC.data);

      const rIndiaSearchesB = await authFetch(`/api/admin/field-agents/roster?search=AgentBetaOne`, indiaToken);
      const indiaFoundB = (rIndiaSearchesB.data?.data?.agents || []).some((a) => String(a.id) === String(agentB._id));
      check("B. INDIA searching Agent B's name finds Agent B", indiaFoundB, rIndiaSearchesB.data);
    }

    // ══════════════ E-I. DETAIL SUB-TABS, N. ROSTER↔DETAIL CONSISTENCY ══════════════
    const SUBTABS = { summary: "summary", salons: "salons", earnings: "earnings", wallet: "wallet", payouts: "payouts" };
    for (const [adminLabel, token] of Object.entries(admins)) {
      for (const [agentLabel, doc] of Object.entries(agents)) {
        const expectedAllowed = EXPECTED_VISIBLE[adminLabel].includes(agentLabel);
        for (const [tabLabel, tabPath] of Object.entries(SUBTABS)) {
          const res = await authFetch(`/api/admin/field-agents/${doc._id}/${tabPath}`, token);
          const allowed = res.status === 200;
          check(
            `${tabLabel === "summary" ? "E" : tabLabel === "salons" ? "F" : tabLabel === "earnings" ? "G" : tabLabel === "wallet" ? "H" : "I"}+N. [${adminLabel}] ${tabLabel}(${agentLabel}) ${expectedAllowed ? "allowed(200)" : "denied(403)"}`,
            expectedAllowed ? allowed : res.status === 403,
            { status: res.status, expectedAllowed }
          );
        }
      }
    }

    // ══════════════ J. ANALYTICS ══════════════
    for (const [label, token] of Object.entries(admins)) {
      const res = await authFetch(`/api/admin/field-agents/analytics`, token);
      check(`J. Analytics[${label}] returns 200`, res.status === 200, res.status);
      const expectedCount = EXPECTED_VISIBLE[label].length;
      check(`J. Analytics[${label}] totalFieldAgents=${res.data?.data?.kpis?.totalFieldAgents} matches expected=${expectedCount}`, res.data?.data?.kpis?.totalFieldAgents === expectedCount, res.data?.data?.kpis);

      const topAgentIds = (res.data?.data?.topAgents || []).map((a) => String(a.fieldAgentId));
      const dLeaked = topAgentIds.includes(String(agentD._id));
      if (label === "INDIA") {
        check("J. Analytics[INDIA] topAgents includes unassigned Agent D (highest earner, no restriction)", dLeaked, topAgentIds);
      } else {
        check(`J. Analytics[${label}] topAgents never leaks unassigned Agent D`, !dLeaked, topAgentIds);
        const onlyExpected = topAgentIds.every((id) => EXPECTED_VISIBLE[label].some((l) => String(agents[l]._id) === id));
        check(`J. Analytics[${label}] topAgents contains only agents in scope`, onlyExpected, topAgentIds);
      }
    }

    // ══════════════ K. UNASSIGNED BEHAVIOR (Agent D) — covered above
    // across roster/detail/analytics for every non-INDIA admin; summarize ──
    {
      const rIndiaD = await authFetch(`/api/admin/field-agents/${agentD._id}/summary`, indiaToken);
      check("K. INDIA can access unassigned Agent D's summary (200)", rIndiaD.status === 200, rIndiaD.status);
      const rStateAD = await authFetch(`/api/admin/field-agents/${agentD._id}/summary`, stateAToken);
      check("K. STATE-A cannot access unassigned Agent D's summary (403)", rStateAD.status === 403, rStateAD.status);
    }

    // ══════════════ L. ENDED ASSIGNMENT + M. REASSIGNMENT ══════════════
    {
      const { fieldAgent: agentE } = await makeFieldAgent("E");
      const assignment = await assignFieldAgentGeography({ fieldAgentRef: agentE._id, stateRef: stateA._id, districtRef: districtA1._id, assignedBy: systemActor });

      const rBefore1 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, stateAToken);
      const rBefore2 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, distA1Token);
      check("L. Before END: STATE-A can access Agent E (200)", rBefore1.status === 200, rBefore1.status);
      check("L. Before END: DISTRICT-A1 can access Agent E (200)", rBefore2.status === 200, rBefore2.status);

      await endFieldAgentGeography({ assignmentId: assignment._id, endedBy: systemActor, endReason: "test" });

      const rAfter1 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, stateAToken);
      const rAfter2 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, distA1Token);
      check("L. After END: STATE-A denied Agent E (403) — ended assignment grants no access", rAfter1.status === 403, rAfter1.status);
      check("L. After END: DISTRICT-A1 denied Agent E (403)", rAfter2.status === 403, rAfter2.status);

      await assignFieldAgentGeography({ fieldAgentRef: agentE._id, stateRef: stateB._id, districtRef: districtB1._id, assignedBy: systemActor });

      const rReassigned1 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, stateAToken);
      const rReassigned2 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, distA1Token);
      const rReassigned3 = await authFetch(`/api/admin/field-agents/${agentE._id}/summary`, stateBToken);
      check("M. After reassignment to State B: STATE-A still denied (403) — historical assignment grants no access", rReassigned1.status === 403, rReassigned1.status);
      check("M. After reassignment to State B: DISTRICT-A1 still denied (403)", rReassigned2.status === 403, rReassigned2.status);
      check("M. After reassignment to State B: STATE-B now allowed (200)", rReassigned3.status === 200, rReassigned3.status);

      const rosterStateB = await authFetch(`/api/admin/field-agents/roster?limit=100`, stateBToken);
      const stateBIds = (rosterStateB.data?.data?.agents || []).map((a) => String(a.id));
      check("M. STATE-B roster now includes reassigned Agent E", stateBIds.includes(String(agentE._id)), stateBIds);
    }

    // ══════════════ O. INDIA UNRESTRICTED — already proven by A/E/J above;
    // one more explicit cross-check ══════════════
    {
      const rIndiaRoster = await authFetch(`/api/admin/field-agents/roster?limit=100`, indiaToken);
      check("O. INDIA roster total includes all 5 real + reassigned fixtures (>=5)", (rIndiaRoster.data?.pagination?.total || 0) >= 5, rIndiaRoster.data?.pagination);
    }

    // ══════════════ P. NON-ADMIN AUTHORIZATION UNCHANGED ══════════════
    {
      const ownerUser = await User.create({ name: "TEST_OWNER", phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER" });
      const ownerToken = generateAccessToken({ _id: ownerUser._id, role: "OWNER", tokenVersion: 0 });
      const rOwnerRoster = await authFetch(`/api/admin/field-agents/roster`, ownerToken);
      check("P. Non-ADMIN role cannot access roster (403), unchanged by Phase C", rOwnerRoster.status === 403, rOwnerRoster.status);
    }
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
