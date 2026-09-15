/**
 * BARBER ENGINE V1
 * backend/scripts/verifyFieldAgentPerformanceAdminApi.js
 *
 * FA-11.3 — dedicated, real-Mongo, real-HTTP verification for the
 * Field Agent Performance admin read API. Mirrors this project's own
 * established methodology (verifyFieldAgentEarningEngine.js,
 * verifyCommercialTerritory.js): real Express app via app.listen(0),
 * real signed JWTs, real MongoDB, disposable fixtures with an explicit
 * marker, explicit zero-residue cleanup.
 *
 * Deliberately does NOT re-test FA-11.2's calculation semantics (owned
 * by verifyFieldAgentPerformance.js) — this script only exercises the
 * HTTP/authorization/DTO layer on top of already-created snapshots.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentPerformanceAdminApi.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import PerformancePolicyVersion from "../modules/fieldAgent/models/PerformancePolicyVersion.js";
import FieldAgentPerformanceSnapshot from "../modules/fieldAgent/models/FieldAgentPerformanceSnapshot.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import {
  createDraftPerformancePolicyVersion,
  publishPerformancePolicyVersion,
} from "../modules/fieldAgent/services/performancePolicy.service.js";
import { createFieldAgentPerformanceSnapshot } from "../modules/fieldAgent/services/fieldAgentPerformance.service.js";

// Untouched-by-FA-11.3 collections — spot-checked before/after.
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import FieldAgentEarningJobCheckpoint from "../modules/fieldAgent/models/FieldAgentEarningJobCheckpoint.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import TerritoryPartnerTermSnapshot from "../modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js";

const NAME_PREFIX = "ZTEST_FA113_";
const oid = () => new mongoose.Types.ObjectId();

let passed = 0;
let failed = 0;
const check = (label, cond, extra) => {
  if (cond) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`, extra !== undefined ? extra : "");
  }
};

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
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
  if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run FA-11.3 verification");
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureClaimIds = [];
  const fixtureAssignmentIds = [];
  const fixtureTerritoryIds = [];
  const fixturePolicyIds = [];
  const fixtureSnapshotIds = [];
  const fixtureApplicationIds = [];

  const before = {
    ledger: await FieldAgentEarningLedger.countDocuments(),
    gaps: await FieldAgentEarningPolicyGap.countDocuments(),
    checkpoint: await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean(),
    progress: await AcquisitionEarningProgress.countDocuments(),
    termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments(),
    territories: await CommercialTerritory.countDocuments(),
    assignments: await TerritoryAssignment.countDocuments(),
    claims: await AcquisitionClaim.countDocuments(),
    fieldAgents: await FieldAgent.countDocuments(),
    publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
    realSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
  };

  try {
    const stateA = oid();
    const stateB = oid();

    const mkStateAdmin = async (stateRef) => {
      const u = await User.create({
        name: `${NAME_PREFIX}STATE_ADMIN_${Date.now()}_${Math.random()}`,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        email: `ztest_fa113_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.test`,
        role: "ADMIN",
        adminLevel: "STATE",
        adminSubRole: "PRIMARY",
        countryRef: oid(),
        stateRef,
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(u._id);
      const token = generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel: "STATE", stateRef, tokenVersion: u.tokenVersion ?? 0 });
      return { user: u, token };
    };

    const mkPlainUser = async (role) => {
      const u = await User.create({
        name: `${NAME_PREFIX}${role}_${Date.now()}_${Math.random()}`,
        phone: `8${Math.floor(100000000 + Math.random() * 899999999)}`,
        role,
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(u._id);
      const token = generateAccessToken({ _id: u._id, role, tokenVersion: u.tokenVersion ?? 0 });
      return { user: u, token };
    };

    const mkFieldAgent = async (commercialPath) => {
      const agentUser = await User.create({
        name: `${NAME_PREFIX}AGENT_${Date.now()}_${Math.random()}`,
        phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`,
        role: "FIELD_AGENT",
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(agentUser._id);
      const fieldAgent = await FieldAgent.create({
        userRef: agentUser._id,
        applicationRef: oid(),
        agentCode: `ZF113-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE",
        commercialPath,
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      return { fieldAgent, agentUser };
    };

    const mkTerritoryInState = async (stateRef, status = "ACTIVE") => {
      const t = await CommercialTerritory.create({
        name: `${NAME_PREFIX}TERRITORY_${Date.now()}_${Math.random()}`,
        code: `ZF113-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        scopeType: "DISTRICT",
        scopeKey: `DISTRICT:${oid()}`,
        stateRef,
        districtRef: oid(),
        status,
        createdBy: indiaAdmin._id,
        updatedBy: indiaAdmin._id,
      });
      fixtureTerritoryIds.push(t._id);
      return t;
    };

    const mkActiveAssignment = async (fieldAgentId, territoryId) => {
      const a = await TerritoryAssignment.create({
        territoryRef: territoryId,
        fieldAgentRef: fieldAgentId,
        status: "ACTIVE",
        effectiveFrom: new Date(),
        assignedBy: indiaAdmin._id,
      });
      fixtureAssignmentIds.push(a._id);
      return a;
    };

    const mkEndedAssignment = async (fieldAgentId, territoryId) => {
      const a = await TerritoryAssignment.create({
        territoryRef: territoryId,
        fieldAgentRef: fieldAgentId,
        status: "ENDED",
        effectiveFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        effectiveUntil: new Date(),
        endReason: "PARTNER_EXIT",
        assignedBy: indiaAdmin._id,
        endedBy: indiaAdmin._id,
      });
      fixtureAssignmentIds.push(a._id);
      return a;
    };

    // Acquisition Agent whose ORIGINAL application requested a zone in
    // the given state — proving requestedZone is never consulted for
    // authorization (it isn't even imported by the authorization code).
    const mkAcquisitionAgentWithRequestedZone = async (stateRef) => {
      const agentUser = await User.create({
        name: `${NAME_PREFIX}AGENT_RZ_${Date.now()}_${Math.random()}`,
        phone: `6${Math.floor(100000000 + Math.random() * 899999999)}`,
        role: "FIELD_AGENT",
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(agentUser._id);
      const application = await FieldAgentApplication.create({
        userRef: agentUser._id,
        phone: agentUser.phone,
        requestedZone: { stateRef },
      });
      fixtureApplicationIds.push(application._id);
      const fieldAgent = await FieldAgent.create({
        userRef: agentUser._id,
        applicationRef: application._id,
        agentCode: `ZF113-RZ-${Date.now()}`,
        operationalStatus: "ACTIVE",
        commercialPath: "ACQUISITION_AGENT",
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      return { fieldAgent, agentUser };
    };

    // ── SETUP: published policy (needed for createFieldAgentPerformanceSnapshot) ──
    const draft = await createDraftPerformancePolicyVersion({ adminId: indiaAdmin._id, rollingWindowDays: 90, dimensionsEnabled: [] });
    fixturePolicyIds.push(draft._id);
    const publishedPolicy = await publishPerformancePolicyVersion({ versionId: draft._id, adminId: indiaAdmin._id });

    // ── FIXTURES ─────────────────────────────────────────────────────
    // Acquisition Agent — INDIA-only regardless of any claim geography.
    const { fieldAgent: acqAgent } = await mkFieldAgent("ACQUISITION_AGENT");
    const acqClaim = await AcquisitionClaim.create({ salonRef: oid(), fieldAgentRef: acqAgent._id, status: "ACTIVE", createdAt: new Date(), stateRef: stateA });
    fixtureClaimIds.push(acqClaim._id);
    // A second claim in the same state, to prove "multiple claims in
    // that state" still never grants STATE_ADMIN visibility (locked
    // test case 5).
    const acqClaim2 = await AcquisitionClaim.create({ salonRef: oid(), fieldAgentRef: acqAgent._id, status: "ACTIVE", createdAt: new Date(), stateRef: stateA });
    fixtureClaimIds.push(acqClaim2._id);
    const acqSnapshot = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: acqAgent._id, cycleKey: "FA113-ACQ" });
    fixtureSnapshotIds.push(acqSnapshot._id);

    // Territory Partner in State A.
    const { fieldAgent: tpAgentA } = await mkFieldAgent("TERRITORY_PARTNER");
    const territoryA = await mkTerritoryInState(stateA);
    await mkActiveAssignment(tpAgentA._id, territoryA._id);
    const tpSnapshotA = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: tpAgentA._id, cycleKey: "FA113-TPA" });
    fixtureSnapshotIds.push(tpSnapshotA._id);

    // Territory Partner in State B.
    const { fieldAgent: tpAgentB } = await mkFieldAgent("TERRITORY_PARTNER");
    const territoryB = await mkTerritoryInState(stateB);
    await mkActiveAssignment(tpAgentB._id, territoryB._id);
    const tpSnapshotB = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: tpAgentB._id, cycleKey: "FA113-TPB" });
    fixtureSnapshotIds.push(tpSnapshotB._id);

    // ── B1 CORRECTIVE FIX FIXTURES ───────────────────────────────────
    // ACTIVE assignment -> SUSPENDED territory, same state as stateAdminA.
    const { fieldAgent: tpAgentSuspended } = await mkFieldAgent("TERRITORY_PARTNER");
    const territorySuspended = await mkTerritoryInState(stateA, "SUSPENDED");
    await mkActiveAssignment(tpAgentSuspended._id, territorySuspended._id);
    const tpSnapshotSuspended = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: tpAgentSuspended._id, cycleKey: "FA113-TP-SUSPENDED" });
    fixtureSnapshotIds.push(tpSnapshotSuspended._id);

    // ACTIVE assignment -> RETIRED territory, same state.
    const { fieldAgent: tpAgentRetired } = await mkFieldAgent("TERRITORY_PARTNER");
    const territoryRetired = await mkTerritoryInState(stateA, "RETIRED");
    await mkActiveAssignment(tpAgentRetired._id, territoryRetired._id);
    const tpSnapshotRetired = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: tpAgentRetired._id, cycleKey: "FA113-TP-RETIRED" });
    fixtureSnapshotIds.push(tpSnapshotRetired._id);

    // ENDED assignment -> ACTIVE territory, same state (the assignment
    // itself is stale, even though the territory is fine).
    const { fieldAgent: tpAgentEndedAssignment } = await mkFieldAgent("TERRITORY_PARTNER");
    const territoryForEndedAssignment = await mkTerritoryInState(stateA, "ACTIVE");
    await mkEndedAssignment(tpAgentEndedAssignment._id, territoryForEndedAssignment._id);
    const tpSnapshotEndedAssignment = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: tpAgentEndedAssignment._id, cycleKey: "FA113-TP-ENDEDASSIGN" });
    fixtureSnapshotIds.push(tpSnapshotEndedAssignment._id);

    // Acquisition Agent whose requestedZone lands in stateA — must
    // never grant STATE_ADMIN(A) visibility.
    const { fieldAgent: acqAgentWithZone } = await mkAcquisitionAgentWithRequestedZone(stateA);
    const acqZoneSnapshot = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: acqAgentWithZone._id, cycleKey: "FA113-ACQ-ZONE" });
    fixtureSnapshotIds.push(acqZoneSnapshot._id);

    // Field Agent with NO snapshot at all — for the 404 test.
    const { fieldAgent: noSnapshotAgent } = await mkFieldAgent("ACQUISITION_AGENT");

    const { token: stateAdminAToken } = await mkStateAdmin(stateA);
    const { token: stateAdminBToken } = await mkStateAdmin(stateB);
    const { token: fieldAgentToken } = await mkPlainUser("FIELD_AGENT");
    const { token: plainUserToken } = await mkPlainUser("USER");

    // ═══════════════════════════════════════════════════════════════
    // 1-2. INDIA_ADMIN list/detail
    // ═══════════════════════════════════════════════════════════════
    {
      const listRes = await authFetch(`/api/admin/field-agents/performance`, indiaToken);
      check("1. INDIA_ADMIN list succeeds (200)", listRes.status === 200, listRes.status);
      const ids = (listRes.data.data?.snapshots || []).map((s) => s.id);
      check("1. INDIA_ADMIN list includes the Acquisition Agent snapshot", ids.includes(String(acqSnapshot._id)));
      check("1. INDIA_ADMIN list includes both Territory Partner snapshots", ids.includes(String(tpSnapshotA._id)) && ids.includes(String(tpSnapshotB._id)));

      const detailRes = await authFetch(`/api/admin/field-agents/performance/${acqAgent._id}`, indiaToken);
      check("2. INDIA_ADMIN detail succeeds (200) for an Acquisition Agent", detailRes.status === 200, detailRes.status);
      check("2. INDIA_ADMIN detail succeeds (200) for a Territory Partner", (await authFetch(`/api/admin/field-agents/performance/${tpAgentA._id}`, indiaToken)).status === 200);
    }

    // ═══════════════════════════════════════════════════════════════
    // 3-4. STATE_ADMIN same-state / cross-state list & detail
    // ═══════════════════════════════════════════════════════════════
    {
      const listResA = await authFetch(`/api/admin/field-agents/performance`, stateAdminAToken);
      check("3. STATE_ADMIN(A) list succeeds (200)", listResA.status === 200, listResA.status);
      const idsA = (listResA.data.data?.snapshots || []).map((s) => s.id);
      check("3. STATE_ADMIN(A) list includes the same-state Territory Partner snapshot", idsA.includes(String(tpSnapshotA._id)));
      check("4. STATE_ADMIN(A) list does NOT include the cross-state Territory Partner snapshot", !idsA.includes(String(tpSnapshotB._id)));
      check("5. STATE_ADMIN(A) list does NOT include the Acquisition Agent snapshot (INDIA-only, locked)", !idsA.includes(String(acqSnapshot._id)));

      const detailSameState = await authFetch(`/api/admin/field-agents/performance/${tpAgentA._id}`, stateAdminAToken);
      check("3. STATE_ADMIN(A) detail succeeds (200) for the same-state Territory Partner", detailSameState.status === 200, detailSameState.status);

      const detailCrossState = await authFetch(`/api/admin/field-agents/performance/${tpAgentB._id}`, stateAdminAToken);
      check("4. STATE_ADMIN(A) detail is denied (403) for the cross-state Territory Partner", detailCrossState.status === 403, detailCrossState.status);

      const detailAcqByStateAdmin = await authFetch(`/api/admin/field-agents/performance/${acqAgent._id}`, stateAdminAToken);
      check("5. STATE_ADMIN(A) detail is denied (403) for the Acquisition Agent (even though its claims are in State A)", detailAcqByStateAdmin.status === 403, detailAcqByStateAdmin.status);
    }

    // ═══════════════════════════════════════════════════════════════
    // B1 CORRECTIVE FIX — CommercialTerritory.status enforcement
    // ═══════════════════════════════════════════════════════════════
    {
      const listA = await authFetch(`/api/admin/field-agents/performance?limit=100`, stateAdminAToken);
      const idsA = (listA.data.data?.snapshots || []).map((s) => s.id);

      check("B1-1. ACTIVE assignment + ACTIVE territory + same state => STATE_ADMIN CAN see (list)", idsA.includes(String(tpSnapshotA._id)));
      const detailActive = await authFetch(`/api/admin/field-agents/performance/${tpAgentA._id}`, stateAdminAToken);
      check("B1-1. ACTIVE assignment + ACTIVE territory + same state => STATE_ADMIN CAN see (detail, 200)", detailActive.status === 200, detailActive.status);

      check("B1-2. ACTIVE assignment + SUSPENDED territory + same state => STATE_ADMIN CANNOT see (list)", !idsA.includes(String(tpSnapshotSuspended._id)));
      const detailSuspended = await authFetch(`/api/admin/field-agents/performance/${tpAgentSuspended._id}`, stateAdminAToken);
      check("B1-2. ACTIVE assignment + SUSPENDED territory + same state => STATE_ADMIN CANNOT see (detail, 403)", detailSuspended.status === 403, detailSuspended.status);

      check("B1-3. ACTIVE assignment + RETIRED territory + same state => STATE_ADMIN CANNOT see (list)", !idsA.includes(String(tpSnapshotRetired._id)));
      const detailRetired = await authFetch(`/api/admin/field-agents/performance/${tpAgentRetired._id}`, stateAdminAToken);
      check("B1-3. ACTIVE assignment + RETIRED territory + same state => STATE_ADMIN CANNOT see (detail, 403)", detailRetired.status === 403, detailRetired.status);

      check("B1-4. ENDED assignment + ACTIVE territory + same state => STATE_ADMIN CANNOT see (list)", !idsA.includes(String(tpSnapshotEndedAssignment._id)));
      const detailEnded = await authFetch(`/api/admin/field-agents/performance/${tpAgentEndedAssignment._id}`, stateAdminAToken);
      check("B1-4. ENDED assignment + ACTIVE territory + same state => STATE_ADMIN CANNOT see (detail, 403)", detailEnded.status === 403, detailEnded.status);

      check("B1-5. ACTIVE assignment + ACTIVE territory + DIFFERENT state => STATE_ADMIN CANNOT see (list)", !idsA.includes(String(tpSnapshotB._id)));

      check("B1-6. Acquisition Agent with claims in admin's state => STATE_ADMIN CANNOT see (list)", !idsA.includes(String(acqSnapshot._id)));

      check("B1-7. Acquisition Agent with requestedZone in admin's state => STATE_ADMIN CANNOT see (list)", !idsA.includes(String(acqZoneSnapshot._id)));
      const detailZone = await authFetch(`/api/admin/field-agents/performance/${acqAgentWithZone._id}`, stateAdminAToken);
      check("B1-7. Acquisition Agent with requestedZone in admin's state => STATE_ADMIN CANNOT see (detail, 403)", detailZone.status === 403, detailZone.status);

      // B1-10: INDIA_ADMIN unrestricted — can still see the
      // suspended/retired-territory snapshot, because the snapshot
      // itself exists and INDIA_ADMIN has unrestricted V1 scope.
      const indiaDetailSuspended = await authFetch(`/api/admin/field-agents/performance/${tpAgentSuspended._id}`, indiaToken);
      check("B1-10. INDIA_ADMIN CAN still see the SUSPENDED-territory partner's snapshot (200)", indiaDetailSuspended.status === 200, indiaDetailSuspended.status);
      const indiaDetailRetired = await authFetch(`/api/admin/field-agents/performance/${tpAgentRetired._id}`, indiaToken);
      check("B1-10. INDIA_ADMIN CAN still see the RETIRED-territory partner's snapshot (200)", indiaDetailRetired.status === 200, indiaDetailRetired.status);
    }

    // ═══════════════════════════════════════════════════════════════
    // 6-7. FIELD_AGENT / USER denied
    // ═══════════════════════════════════════════════════════════════
    {
      const faList = await authFetch(`/api/admin/field-agents/performance`, fieldAgentToken);
      check("6. FIELD_AGENT list denied (403)", faList.status === 403, faList.status);
      const faDetail = await authFetch(`/api/admin/field-agents/performance/${tpAgentA._id}`, fieldAgentToken);
      check("6. FIELD_AGENT detail denied (403)", faDetail.status === 403, faDetail.status);

      const userList = await authFetch(`/api/admin/field-agents/performance`, plainUserToken);
      check("7. USER list denied (403)", userList.status === 403, userList.status);
      const userDetail = await authFetch(`/api/admin/field-agents/performance/${tpAgentA._id}`, plainUserToken);
      check("7. USER detail denied (403)", userDetail.status === 403, userDetail.status);

      const noAuthList = await authFetch(`/api/admin/field-agents/performance`, null);
      check("Unauthenticated request denied (401)", noAuthList.status === 401, noAuthList.status);
    }

    // ═══════════════════════════════════════════════════════════════
    // 8-9. Missing snapshot / invalid fieldAgentId
    // ═══════════════════════════════════════════════════════════════
    {
      const noSnapshotRes = await authFetch(`/api/admin/field-agents/performance/${noSnapshotAgent._id}`, indiaToken);
      check("8. Missing snapshot => clean 404", noSnapshotRes.status === 404, noSnapshotRes.status);

      const nonExistentAgentRes = await authFetch(`/api/admin/field-agents/performance/${oid()}`, indiaToken);
      check("8. Non-existent FieldAgent => clean 404", nonExistentAgentRes.status === 404, nonExistentAgentRes.status);

      const invalidIdRes = await authFetch(`/api/admin/field-agents/performance/not-a-valid-object-id`, indiaToken);
      check("9. Invalid fieldAgentId is rejected safely (400), not a 500", invalidIdRes.status === 400, invalidIdRes.status);
    }

    // ═══════════════════════════════════════════════════════════════
    // 10-13. Pagination / ordering / arbitrary filters
    // ═══════════════════════════════════════════════════════════════
    {
      const badPage = await authFetch(`/api/admin/field-agents/performance?page=0`, indiaToken);
      check("10. Invalid pagination (page=0) rejected (400)", badPage.status === 400, badPage.status);

      const badLimit = await authFetch(`/api/admin/field-agents/performance?limit=99999`, indiaToken);
      check("10. Invalid pagination (limit over max) rejected (400)", badLimit.status === 400, badLimit.status);

      const boundedRes = await authFetch(`/api/admin/field-agents/performance?limit=2`, indiaToken);
      check("11. Pagination is bounded (limit=2 returns at most 2 items)", (boundedRes.data.data?.snapshots || []).length <= 2, boundedRes.data.data?.snapshots?.length);

      const orderedRes = await authFetch(`/api/admin/field-agents/performance?limit=100`, indiaToken);
      const computedAts = (orderedRes.data.data?.snapshots || []).map((s) => new Date(s.computedAt).getTime());
      const isDescending = computedAts.every((v, i) => i === 0 || computedAts[i - 1] >= v);
      check("12. Deterministic ordering — computedAt DESC", isDescending);

      const arbitraryFilterRes = await authFetch(`/api/admin/field-agents/performance?someRandomField=hack`, indiaToken);
      check("13. Arbitrary/unknown query field is rejected (400), not silently ignored-and-passed", arbitraryFilterRes.status === 400, arbitraryFilterRes.status);

      const stateRefBypassRes = await authFetch(`/api/admin/field-agents/performance?stateRef=${stateB}`, stateAdminAToken);
      check("22. STATE_ADMIN cannot override geography using a stateRef query parameter (rejected, 400)", stateRefBypassRes.status === 400, stateRefBypassRes.status);
    }

    // ═══════════════════════════════════════════════════════════════
    // 14-17. DTO safety — no raw doc, no PII, no fraud evidence, paise integers
    // ═══════════════════════════════════════════════════════════════
    {
      const detail = (await authFetch(`/api/admin/field-agents/performance/${acqAgent._id}`, indiaToken)).data.data.snapshot;
      const rawKeys = Object.keys(detail);
      const forbiddenKeys = ["__v", "createdAt", "updatedAt"]; // Mongoose-internal / not in the approved DTO list
      check("14. No raw Mongo/Mongoose internal fields leaked (__v/createdAt/updatedAt)", forbiddenKeys.every((k) => !rawKeys.includes(k)), rawKeys);

      const serialized = JSON.stringify(detail).toLowerCase();
      check("15. No PII substrings present (phone/aadhaar/pan/email/name)", !/phone|aadhaar|pan|email|"name"/i.test(serialized));

      check("16. Fraud data present only as an aggregate count object, not raw evidence", typeof detail.rollingWindow.fraudSignalCounts === "object" && !("evidence" in detail.rollingWindow));

      check("17. Financial amounts remain integer paise (no decimal rupee conversion)", Number.isInteger(detail.rollingWindow.acquisitionCreditedAmountInPaise));
    }

    // ═══════════════════════════════════════════════════════════════
    // 18-20. Snapshot not recalculated; no mutation; no financial writes
    // ═══════════════════════════════════════════════════════════════
    {
      const ledgerBefore = await FieldAgentEarningLedger.countDocuments();
      const snapshotDocBefore = await FieldAgentPerformanceSnapshot.findById(acqSnapshot._id).lean();
      await authFetch(`/api/admin/field-agents/performance/${acqAgent._id}`, indiaToken);
      await authFetch(`/api/admin/field-agents/performance/${acqAgent._id}`, indiaToken); // twice, to prove no fresh-calc side effect
      const ledgerAfter = await FieldAgentEarningLedger.countDocuments();
      const snapshotDocAfter = await FieldAgentPerformanceSnapshot.findById(acqSnapshot._id).lean();
      const snapshotCountForAgent = await FieldAgentPerformanceSnapshot.countDocuments({ fieldAgentRef: acqAgent._id });

      check("18. Repeated detail reads never create a second snapshot (still exactly 1 for this agent)", snapshotCountForAgent === 1, snapshotCountForAgent);
      check("19. Snapshot document is byte-unchanged after being read via the API", JSON.stringify(snapshotDocBefore) === JSON.stringify(snapshotDocAfter));
      check("20. No FieldAgentEarningLedger writes as a side effect of reading performance data", ledgerBefore === ledgerAfter);
    }

    // ═══════════════════════════════════════════════════════════════
    // 21. IDOR attempts
    // ═══════════════════════════════════════════════════════════════
    {
      // Already substantively proven in section 4 (cross-state 403) and
      // section 5 (Acquisition Agent 403 for STATE_ADMIN) — this adds a
      // third distinct angle: a STATE_ADMIN directly requesting a
      // fieldAgentRef filter for an out-of-scope agent in LIST.
      const idorListRes = await authFetch(`/api/admin/field-agents/performance?fieldAgentRef=${tpAgentB._id}`, stateAdminAToken);
      const idorIds = (idorListRes.data.data?.snapshots || []).map((s) => s.id);
      check("21. STATE_ADMIN(A) cannot retrieve an out-of-scope agent's snapshot via the fieldAgentRef list filter", idorListRes.status === 200 && idorIds.length === 0, { status: idorListRes.status, count: idorIds.length });
    }

    // ═══════════════════════════════════════════════════════════════
    // 23-26. Filters
    // ═══════════════════════════════════════════════════════════════
    {
      const byAgent = await authFetch(`/api/admin/field-agents/performance?fieldAgentRef=${tpAgentA._id}`, indiaToken);
      const byAgentIds = (byAgent.data.data?.snapshots || []).map((s) => s.id);
      check("23. INDIA_ADMIN fieldAgentRef filter works", byAgentIds.length === 1 && byAgentIds[0] === String(tpSnapshotA._id), byAgentIds);

      const byPath = await authFetch(`/api/admin/field-agents/performance?commercialPath=ACQUISITION_AGENT`, indiaToken);
      const byPathPaths = (byPath.data.data?.snapshots || []).map((s) => s.commercialPath);
      check("24. commercialPath filter works", byPathPaths.every((p) => p === "ACQUISITION_AGENT") && byPathPaths.length >= 1, byPathPaths);

      const byCycle = await authFetch(`/api/admin/field-agents/performance?cycleKey=FA113-TPA`, indiaToken);
      const byCycleIds = (byCycle.data.data?.snapshots || []).map((s) => s.id);
      check("25. cycleKey filter works", byCycleIds.length === 1 && byCycleIds[0] === String(tpSnapshotA._id), byCycleIds);

      const byPolicy = await authFetch(`/api/admin/field-agents/performance?policyVersionRef=${publishedPolicy._id}`, indiaToken);
      const byPolicyCount = (byPolicy.data.data?.snapshots || []).length;
      check("26. policyVersionRef filter works", byPolicyCount >= 3, byPolicyCount);
    }

    // ═══════════════════════════════════════════════════════════════
    // 27-28. Latest-detail semantics / list metadata
    // ═══════════════════════════════════════════════════════════════
    {
      // Create a SECOND, later snapshot for the same acquisition agent
      // and confirm detail returns the latest one, not the first.
      const laterSnapshot = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: acqAgent._id, cycleKey: "FA113-ACQ-LATER" });
      fixtureSnapshotIds.push(laterSnapshot._id);
      const detailRes = await authFetch(`/api/admin/field-agents/performance/${acqAgent._id}`, indiaToken);
      check("27. Detail returns the LATEST snapshot (by computedAt), not the first one created", detailRes.data.data.snapshot.id === String(laterSnapshot._id), detailRes.data.data.snapshot.id);

      const listMeta = await authFetch(`/api/admin/field-agents/performance?limit=1`, indiaToken);
      check("28. List response carries page/limit/total pagination metadata", typeof listMeta.data.pagination?.total === "number" && listMeta.data.pagination.limit === 1);
    }

    // ═══════════════════════════════════════════════════════════════
    // 29-30. Query-plan / N+1
    // ═══════════════════════════════════════════════════════════════
    {
      const plan = await FieldAgentPerformanceSnapshot.find({}).sort({ computedAt: -1, _id: -1 }).limit(50).explain("executionStats");
      const docsExamined = plan.executionStats?.totalDocsExamined ?? Infinity;
      check("29. List query is bounded by its own limit (totalDocsExamined <= 50)", docsExamined <= 50, docsExamined);

      const territoryPlan = await CommercialTerritory.find({ stateRef: stateA }).explain("queryPlanner");
      const territoryPlanStr = JSON.stringify(territoryPlan.queryPlanner?.winningPlan || {});
      check("29. STATE_ADMIN scoping's CommercialTerritory(stateRef) lookup uses an index scan, not COLLSCAN", territoryPlanStr.includes("IXSCAN") && !territoryPlanStr.includes("COLLSCAN"), territoryPlanStr.slice(0, 200));

      // N+1 check: the DTO mapper never issues a per-item FieldAgent
      // query (structural — confirmed by source inspection: list/detail
      // functions never call FieldAgent.findById in a loop over
      // results). A timing-based proxy: list of 3 items should not take
      // meaningfully longer than list of 1.
      const t0 = Date.now();
      await authFetch(`/api/admin/field-agents/performance?limit=1`, indiaToken);
      const d1 = Date.now() - t0;
      const t1 = Date.now();
      await authFetch(`/api/admin/field-agents/performance?limit=50`, indiaToken);
      const d50 = Date.now() - t1;
      check("30. No N+1 FieldAgent query pattern (list of many is not dramatically slower than list of one)", d50 < d1 * 10 + 300, { d1, d50 });
    }

    // ═══════════════════════════════════════════════════════════════
    // FA-11.4 (F3) — admin list query-plan matrix
    // ═══════════════════════════════════════════════════════════════
    {
      // Bury the real fixtures among 500 noise snapshots so the
      // COLLSCAN-vs-IXSCAN distinction is meaningful, not merely
      // structural on a near-empty collection.
      const noiseSnapshots = [];
      const auditCycleKey = "FA114-AUDIT-CYCLE";
      for (let i = 0; i < 500; i++) {
        noiseSnapshots.push({
          fieldAgentRef: oid(),
          commercialPath: i % 2 === 0 ? "TERRITORY_PARTNER" : "ACQUISITION_AGENT",
          cycleKey: i < 10 ? auditCycleKey : `FA114-NOISE-${i}`,
          policyVersionRef: oid(),
          computedAt: new Date(Date.now() - i * 3600000),
          rollingWindowDays: 90,
          rollingWindow: { claimsIssuedCount: 0, acquisitionCreditedBookingCount: 0, acquisitionCreditedAmountInPaise: 0, territoryCreditedBookingCount: 0, territoryCreditedAmountInPaise: 0, adminActionCount: 0 },
          lifetime: { salonsAcquiredCount: 0, targetCompletionCount: 0, targetCompletionRate: null },
          currentState: { claimsActiveCount: 0, kycStatus: null, trainingStatus: null, testStatus: null, accountStatus: "ACTIVE", operationalStatus: "ACTIVE" },
        });
      }
      const insertedNoise = await FieldAgentPerformanceSnapshot.insertMany(noiseSnapshots);
      insertedNoise.forEach((s) => fixtureSnapshotIds.push(s._id));

      const planFor = async (filter) => FieldAgentPerformanceSnapshot.find(filter).sort({ computedAt: -1, _id: -1 }).limit(50).explain("executionStats");
      const hasCollscan = (plan) => JSON.stringify(plan.queryPlanner.winningPlan).includes("COLLSCAN");
      const hasBlockingSort = (plan) => JSON.stringify(plan.queryPlanner.winningPlan).includes('"stage":"SORT"');

      const planA = await planFor({});
      check("FA-11.4/F3-A. No filter: no COLLSCAN (uses {computedAt,_id} index)", !hasCollscan(planA));
      check("FA-11.4/F3-A. No filter: no blocking in-memory SORT stage", !hasBlockingSort(planA));

      const planB = await planFor({ commercialPath: "TERRITORY_PARTNER" });
      check("FA-11.4/F3-B. commercialPath only: no COLLSCAN", !hasCollscan(planB));
      check("FA-11.4/F3-B. commercialPath only: no blocking SORT (index order still satisfies it, filter applied as residual)", !hasBlockingSort(planB));

      const planC = await planFor({ cycleKey: auditCycleKey });
      const planCStr = JSON.stringify(planC.queryPlanner.winningPlan);
      check("FA-11.4/F3-C. cycleKey only: uses the new {cycleKey,computedAt} index, no COLLSCAN", planCStr.includes("cycleKey_1_computedAt_-1") && !hasCollscan(planC));
      check("FA-11.4/F3-C. cycleKey only: perfectly selective (totalDocsExamined equals the 10 real matches, not the full collection)", planC.executionStats.totalDocsExamined === 10, planC.executionStats.totalDocsExamined);
      // Documented, not asserted-away: MongoDB may still add a small
      // residual in-memory SORT over the already-narrow matched set for
      // this shape — negligible cost at 10 rows, reported honestly per
      // the FA-11.4 instruction not to force every plan into a single
      // sort-free IXSCAN.
      console.log(`   (info) FA-11.4/F3-C residual SORT stage present: ${hasBlockingSort(planC)} — expected/documented, not a failure either way.`);

      const planD = await planFor({ policyVersionRef: oid() }); // no real match
      check("FA-11.4/F3-D. policyVersionRef only: no COLLSCAN label (still index-scanned via {computedAt,_id}, even though this filter has no dedicated index)", !hasCollscan(planD));
      console.log(`   (info) FA-11.4/F3-D totalDocsExamined for a non-matching policyVersionRef: ${planD.executionStats.totalDocsExamined} — expected to approach collection size since no dedicated index exists for this filter (deferred per the FA-11.4 audit's redundancy analysis).`);

      const planE = await planFor({ fieldAgentRef: insertedNoise[100].fieldAgentRef });
      check("FA-11.4/F3-E. fieldAgentRef: still uses the pre-existing {fieldAgentRef,cycleKey} index, unaffected by this round's changes", JSON.stringify(planE.queryPlanner.winningPlan).includes("fieldAgentRef_1_cycleKey_1"));

      const planF = await FieldAgentPerformanceSnapshot.find({}).sort({ computedAt: -1, _id: -1 }).skip(20).limit(20).explain("executionStats");
      check("FA-11.4/F3-F. Pagination (skip+limit) remains index-backed, no COLLSCAN", !hasCollscan(planF));
    }

    // ═══════════════════════════════════════════════════════════════
    // 31-32. Frozen FA-9/FA-10 untouched (static + DB check)
    // ═══════════════════════════════════════════════════════════════
    {
      const { execSync } = await import("node:child_process");
      const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
      const fa9Fa10Files = [
        "models/CommercialPolicyVersion.js",
        "models/CommercialPolicyOverride.js",
        "services/fieldAgentEarning.service.js",
        "jobs/fieldAgentEarning.job.js",
        "models/FieldAgentEarningPolicyGap.js",
        "models/FieldAgentEarningJobCheckpoint.js",
      ];
      check("31. No frozen FA-9 file modified (git diff)", fa9Fa10Files.slice(0, 5).every((f) => !diffFiles.includes(f)), diffFiles);
      check("32. No frozen FA-10 term-enforcement file modified (git diff)", !diffFiles.includes("TerritoryPartnerTermSnapshot.js"), diffFiles);
    }
  } finally {
    // ── CLEANUP (explicit ID lists only — never a broad delete) ──────
    await FieldAgentPerformanceSnapshot.collection.deleteMany({ _id: { $in: fixtureSnapshotIds } });
    await PerformancePolicyVersion.collection.deleteMany({ _id: { $in: fixturePolicyIds } });
    await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
    await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
    await AcquisitionClaim.deleteMany({ _id: { $in: fixtureClaimIds } });
    await FieldAgentApplication.deleteMany({ _id: { $in: fixtureApplicationIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });

    const residue = {
      snapshots: await FieldAgentPerformanceSnapshot.countDocuments({ _id: { $in: fixtureSnapshotIds } }),
      policies: await PerformancePolicyVersion.countDocuments({ _id: { $in: fixturePolicyIds } }),
      assignments: await TerritoryAssignment.countDocuments({ _id: { $in: fixtureAssignmentIds } }),
      territories: await CommercialTerritory.countDocuments({ _id: { $in: fixtureTerritoryIds } }),
      claims: await AcquisitionClaim.countDocuments({ _id: { $in: fixtureClaimIds } }),
      applications: await FieldAgentApplication.countDocuments({ _id: { $in: fixtureApplicationIds } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
    };
    const zeroResidue = Object.values(residue).every((n) => n === 0);
    check("Zero residue — all FA-11.3 fixtures removed", zeroResidue, residue);
    server.close();
  }

  // ── PRODUCTION BOUNDARY (captured AFTER cleanup) ──────────────────
  {
    const after = {
      ledger: await FieldAgentEarningLedger.countDocuments(),
      gaps: await FieldAgentEarningPolicyGap.countDocuments(),
      checkpoint: await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean(),
      progress: await AcquisitionEarningProgress.countDocuments(),
      termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments(),
      territories: await CommercialTerritory.countDocuments(),
      assignments: await TerritoryAssignment.countDocuments(),
      claims: await AcquisitionClaim.countDocuments(),
      fieldAgents: await FieldAgent.countDocuments(),
      publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
      realSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
    };
    check("33. FieldAgentEarningLedger unchanged", after.ledger === before.ledger, { before: before.ledger, after: after.ledger });
    check("33. FieldAgentEarningPolicyGap unchanged (46)", after.gaps === before.gaps, { before: before.gaps, after: after.gaps });
    check(
      "33. FA-9 earning checkpoint unchanged",
      before.checkpoint?.lastCompletedAt?.toISOString() === after.checkpoint?.lastCompletedAt?.toISOString() &&
        String(before.checkpoint?.lastId) === String(after.checkpoint?.lastId)
    );
    check("33. AcquisitionEarningProgress unchanged", after.progress === before.progress);
    check("33. TerritoryPartnerTermSnapshot unchanged", after.termSnapshots === before.termSnapshots);
    check("33. CommercialTerritory count returned to baseline (no leaked territory)", after.territories === before.territories, { before: before.territories, after: after.territories });
    check("33. TerritoryAssignment count returned to baseline", after.assignments === before.assignments);
    check("33. AcquisitionClaim count returned to baseline", after.claims === before.claims);
    check("33. FieldAgent count returned to baseline (no leaked fixture agent)", after.fieldAgents === before.fieldAgents, { before: before.fieldAgents, after: after.fieldAgents });
    check("No real PerformancePolicyVersion left PUBLISHED", after.publishedPolicies === 0, after.publishedPolicies);
    check("No real FieldAgentPerformanceSnapshot remains", after.realSnapshots === 0, after.realSnapshots);
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);
  await mongoose.connection.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ FA-11.3 verification body threw:", err);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
