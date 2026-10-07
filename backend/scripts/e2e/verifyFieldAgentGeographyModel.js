/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentGeographyModel.js
 *
 * MUST-DO-NOW #5 — PHASE A verification.
 *
 * This is a MUTATION test (create/end assignments, concurrency race)
 * for a brand-new model with zero production rows. Per the Phase A
 * ticket's explicit "do not insert even test rows into the shared
 * production/dev database" instruction, this script does NOT call
 * connectDB()/use the Atlas connection at all — it boots a disposable
 * in-memory MongoDB (mongodb-memory-server, added as a devDependency
 * for exactly this purpose) and connects mongoose to that instead.
 * The real dev/production database is never touched by this script.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentGeographyModel.js
 */

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentGeographyAssignment from "../../modules/fieldAgent/models/FieldAgentGeographyAssignment.js";
import TerritoryAssignment from "../../modules/fieldAgent/models/TerritoryAssignment.js";
import CommercialTerritory from "../../modules/fieldAgent/models/CommercialTerritory.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import Transaction from "../../models/Transaction.js";

import {
  assignFieldAgentGeography,
  endFieldAgentGeography,
  getActiveFieldAgentGeography,
  getFieldAgentGeographyHistory,
  resolveFieldAgentGeography,
} from "../../modules/fieldAgent/services/fieldAgentGeography.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};
const expectThrow = async (fn, matcher, name) => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    check(name, matcher(err), { message: err.message, statusCode: err.statusCode });
  }
};

const oid = () => new mongoose.Types.ObjectId();

const makeState = (overrides = {}) =>
  State.create({
    name: overrides.name || "TESTSTATE",
    normalizedName: (overrides.name || "teststate").toLowerCase(),
    code: overrides.code || "TS",
    slug: overrides.slug || `teststate-${oid()}`,
    type: "STATE",
    countryRef: oid(),
    geo: { type: "Point", coordinates: [77.1, 28.6] },
  });

const makeDistrict = (stateRef, overrides = {}) =>
  District.create({
    name: overrides.name || "TESTDISTRICT",
    normalizedName: (overrides.name || "testdistrict").toLowerCase(),
    code: overrides.code || "TD",
    slug: overrides.slug || `testdistrict-${oid()}`,
    countryRef: oid(),
    stateRef,
  });

const makeFieldAgent = () =>
  FieldAgent.create({
    userRef: oid(),
    applicationRef: oid(),
    agentCode: `FA-${oid()}`,
    operationalStatus: "ACTIVE",
  });

const run = async () => {
  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: "fa_geo_phase_a_isolated" });

  try {
    const before = {
      FieldAgentGeographyAssignment: await FieldAgentGeographyAssignment.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
      CommercialTerritory: await CommercialTerritory.countDocuments({}),
    };
    check("A. Model loads and collection is initially empty in isolated DB", before.FieldAgentGeographyAssignment === 0, before);

    const stateA = await makeState({ name: "ALPHA", code: "AL" });
    const stateB = await makeState({ name: "BETA", code: "BT" });
    const districtA1 = await makeDistrict(stateA._id, { name: "A1", code: "A1" });
    const districtA2 = await makeDistrict(stateA._id, { name: "A2", code: "A2" });
    const districtB1 = await makeDistrict(stateB._id, { name: "B1", code: "B1" });

    const agent1 = await makeFieldAgent();
    const agent2 = await makeFieldAgent();
    const agent3 = await makeFieldAgent();
    const admin1 = oid();
    const admin2 = oid();

    // ── B. ACTIVE assignment can be created ─────────────────────
    const a1 = await assignFieldAgentGeography({ fieldAgentRef: agent1._id, stateRef: stateA._id, districtRef: districtA1._id, assignedBy: admin1 });
    check("B. ACTIVE assignment created", a1.status === "ACTIVE" && String(a1.fieldAgentRef) === String(agent1._id), a1);
    check("B. effectiveFrom set, effectiveUntil null", !!a1.effectiveFrom && a1.effectiveUntil === null, {});

    // ── C/D. Same Field Agent cannot have two ACTIVE assignments ─
    await expectThrow(
      () => assignFieldAgentGeography({ fieldAgentRef: agent1._id, stateRef: stateB._id, assignedBy: admin1 }),
      (err) => err.statusCode === 409,
      "C/D. Second ACTIVE assignment for same agent returns controlled 409 conflict (service pre-check)"
    );

    // ── E. ENDED + new ACTIVE for the same agent ─────────────────
    const ended1 = await endFieldAgentGeography({ assignmentId: a1._id, endedBy: admin2, endReason: "Reassigned" });
    check("E(end). First assignment now ENDED with effectiveUntil/endReason set", ended1.status === "ENDED" && !!ended1.effectiveUntil && ended1.endReason === "Reassigned", ended1);
    const a1b = await assignFieldAgentGeography({ fieldAgentRef: agent1._id, stateRef: stateA._id, districtRef: districtA2._id, assignedBy: admin2 });
    check("E(assign). New ACTIVE assignment created after ending the old one", a1b.status === "ACTIVE" && String(a1b.districtRef) === String(districtA2._id), a1b);

    // ── F/G. Multiple agents can share same State/District ───────
    const a2 = await assignFieldAgentGeography({ fieldAgentRef: agent2._id, stateRef: stateA._id, districtRef: districtA2._id, assignedBy: admin1 });
    check("F. Second, different Field Agent assigned to the SAME State as agent1", String(a2.stateRef) === String(stateA._id), {});
    check("G. Second Field Agent assigned to the SAME District as agent1's current assignment", String(a2.districtRef) === String(districtA2._id), {});

    // ── H. State is required ──────────────────────────────────────
    await expectThrow(
      () => assignFieldAgentGeography({ fieldAgentRef: agent3._id, stateRef: null, assignedBy: admin1 }),
      (err) => err.statusCode === 400,
      "H. Missing stateRef rejected with 400"
    );

    // ── I. Invalid State rejected ──────────────────────────────────
    await expectThrow(
      () => assignFieldAgentGeography({ fieldAgentRef: agent3._id, stateRef: oid(), assignedBy: admin1 }),
      (err) => err.statusCode === 404,
      "I. Non-existent stateRef rejected with 404"
    );

    // ── J. Invalid District rejected ────────────────────────────────
    await expectThrow(
      () => assignFieldAgentGeography({ fieldAgentRef: agent3._id, stateRef: stateA._id, districtRef: oid(), assignedBy: admin1 }),
      (err) => err.statusCode === 404,
      "J. Non-existent districtRef rejected with 404"
    );

    // ── K. District belonging to another State rejected ─────────
    await expectThrow(
      () => assignFieldAgentGeography({ fieldAgentRef: agent3._id, stateRef: stateA._id, districtRef: districtB1._id, assignedBy: admin1 }),
      (err) => err.statusCode === 400,
      "K. districtRef belonging to a different stateRef rejected with 400"
    );

    // Give agent3 a real assignment for later history/getActive checks.
    const a3 = await assignFieldAgentGeography({ fieldAgentRef: agent3._id, stateRef: stateB._id, assignedBy: admin1 });
    check("State-only assignment (no districtRef) is valid", a3.status === "ACTIVE" && a3.districtRef === null, a3);

    // ── M. Ending the same assignment again is safe/idempotent ───
    const endedAgain = await endFieldAgentGeography({ assignmentId: a1._id, endedBy: admin2, endReason: "Should be ignored" });
    check("M. Ending an already-ENDED assignment is idempotent (no second mutation)", endedAgain.endReason === "Reassigned", endedAgain);
    const historyCountAfterDoubleEnd = await FieldAgentGeographyAssignment.countDocuments({ fieldAgentRef: agent1._id });
    check("M. No duplicate history row created by the idempotent re-end", historyCountAfterDoubleEnd === 2, { historyCountAfterDoubleEnd });

    // ── N. History returns ACTIVE + ENDED ─────────────────────────
    const history1 = await getFieldAgentGeographyHistory(agent1._id);
    check("N. History includes both the ENDED and the ACTIVE row, newest first", history1.length === 2 && history1[0].status === "ACTIVE" && history1[1].status === "ENDED", history1.map((h) => h.status));

    // ── O. getActive returns only current ACTIVE ──────────────────
    const active1 = await getActiveFieldAgentGeography(agent1._id);
    check("O. getActiveFieldAgentGeography returns only the current ACTIVE row", String(active1._id) === String(a1b._id), active1);
    const activeNone = await getActiveFieldAgentGeography(oid());
    check("O. getActiveFieldAgentGeography returns null for an agent with no assignment", activeNone === null, activeNone);

    const resolved = await resolveFieldAgentGeography(agent1._id);
    check("resolveFieldAgentGeography matches getActiveFieldAgentGeography", String(resolved._id) === String(active1._id), {});

    // ── S. Concurrency: exactly one ACTIVE assignment survives ────
    const raceAgent = await makeFieldAgent();
    const raceResults = await Promise.allSettled([
      assignFieldAgentGeography({ fieldAgentRef: raceAgent._id, stateRef: stateA._id, assignedBy: admin1 }),
      assignFieldAgentGeography({ fieldAgentRef: raceAgent._id, stateRef: stateB._id, assignedBy: admin2 }),
    ]);
    const raceFulfilled = raceResults.filter((r) => r.status === "fulfilled").length;
    const raceRejected = raceResults.filter((r) => r.status === "rejected").length;
    check("S. Concurrent assignment race: exactly one request succeeded", raceFulfilled === 1, raceResults.map((r) => r.status));
    check("S. Concurrent assignment race: exactly one request was rejected as a conflict", raceRejected === 1 && raceResults.find((r) => r.status === "rejected").reason.statusCode === 409, raceResults);
    const raceActiveCount = await FieldAgentGeographyAssignment.countDocuments({ fieldAgentRef: raceAgent._id, status: "ACTIVE" });
    check("S. Exactly one ACTIVE assignment persisted for the raced Field Agent", raceActiveCount === 1, { raceActiveCount });

    // ── P/Q/R. No cross-contamination into other models ──────────
    check("P. No TerritoryAssignment document was created by this script", await TerritoryAssignment.countDocuments({}) === 0, {});
    check("Q. No CommercialTerritory document was created/modified by this script", await CommercialTerritory.countDocuments({}) === 0, {});
    check("R. No financial record (Transaction) exists in this isolated DB", await Transaction.countDocuments({}) === 0, {});

  } catch (err) {
    console.error("SCRIPT ERROR:", err);
    fail++;
    results.push(`❌ FATAL SCRIPT ERROR — ${err.message}`);
  } finally {
    console.log(results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
    await mongoose.disconnect();
    await mem.stop();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
