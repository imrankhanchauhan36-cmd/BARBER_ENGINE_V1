/**
 * BARBER ENGINE V1
 * backend/scripts/verifyFieldAgentComplianceWorkflow.js
 *
 * FA-12.2 — dedicated, real-Mongo, real-HTTP verification for the
 * compliance case workflow + admin review API built on top of the
 * frozen FA-12.1 domain foundation. Mirrors this project's own
 * established methodology (verifyFieldAgentPerformanceAdminApi.js,
 * verifyFieldAgentCommercialPolicy.js): real Express app via
 * app.listen(0), real signed JWTs, real MongoDB, disposable fixtures,
 * explicit zero-residue cleanup.
 *
 * Deliberately does NOT re-test FA-12.1's own schema/index/immutability
 * guarantees in depth (owned by verifyFieldAgentCompliance.js) — this
 * script exercises the FA-12.2 service/HTTP layer built on top of them.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentComplianceWorkflow.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentComplianceCase from "../modules/fieldAgent/models/FieldAgentComplianceCase.js";
import FieldAgentComplianceEvidence from "../modules/fieldAgent/models/FieldAgentComplianceEvidence.js";
import FieldAgentComplianceAuditEvent from "../modules/fieldAgent/models/FieldAgentComplianceAuditEvent.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import { VALID_CASE_TRANSITIONS_MAP } from "../modules/fieldAgent/services/complianceCase.service.js";
import { FA12_CASE_STATUS, FA12_VIOLATION_CATEGORY, FA12_EVIDENCE_SOURCE_TYPE } from "../modules/fieldAgent/constants/compliance.constants.js";

// Untouched-by-FA-12.2 collections — spot-checked before/after.
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import PerformancePolicyVersion from "../modules/fieldAgent/models/PerformancePolicyVersion.js";
import FieldAgentPerformanceSnapshot from "../modules/fieldAgent/models/FieldAgentPerformanceSnapshot.js";

const NAME_PREFIX = "ZTEST_FA122_";
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

const API = "/api/admin/field-agent-compliance";

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
  if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run FA-12.2 verification");
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureTerritoryIds = [];
  const fixtureAssignmentIds = [];
  const fixtureCaseIds = [];
  const fixtureEvidenceIds = [];

  const before = {
    ledger: await FieldAgentEarningLedger.countDocuments(),
    claims: await AcquisitionClaim.countDocuments(),
    publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
    perfSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
    territories: await CommercialTerritory.countDocuments(),
    assignments: await TerritoryAssignment.countDocuments(),
  };

  try {
    const stateA = oid();
    const stateB = oid();

    const mkStateAdmin = async (stateRef) => {
      const u = await User.create({
        name: `${NAME_PREFIX}STATE_ADMIN_${Date.now()}_${Math.random()}`,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        email: `ztest_fa122_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.test`,
        role: "ADMIN",
        adminLevel: "STATE",
        adminSubRole: "PRIMARY",
        countryRef: oid(),
        stateRef,
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(u._id);
      return { user: u, token: generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel: "STATE", stateRef, tokenVersion: u.tokenVersion ?? 0 }) };
    };

    const mkDistrictAdmin = async (stateRef) => {
      const u = await User.create({
        name: `${NAME_PREFIX}DISTRICT_ADMIN_${Date.now()}_${Math.random()}`,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        email: `ztest_fa122_d_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.test`,
        role: "ADMIN",
        adminLevel: "DISTRICT",
        adminSubRole: "PRIMARY",
        countryRef: oid(),
        stateRef,
        districtRef: oid(),
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(u._id);
      return { user: u, token: generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel: "DISTRICT", stateRef, tokenVersion: u.tokenVersion ?? 0 }) };
    };

    const mkPlainUser = async (role) => {
      const u = await User.create({
        name: `${NAME_PREFIX}${role}_${Date.now()}_${Math.random()}`,
        phone: `8${Math.floor(100000000 + Math.random() * 899999999)}`,
        role,
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(u._id);
      return { user: u, token: generateAccessToken({ _id: u._id, role, tokenVersion: u.tokenVersion ?? 0 }) };
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
        agentCode: `ZF122-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE",
        commercialPath,
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      return { fieldAgent, agentUser };
    };

    const mkTerritoryInState = async (stateRef, status = "ACTIVE") => {
      const t = await CommercialTerritory.create({
        name: `${NAME_PREFIX}TERRITORY_${Date.now()}_${Math.random()}`,
        code: `ZF122-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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

    const mkTerritoryPartnerInState = async (stateRef) => {
      const { fieldAgent } = await mkFieldAgent("TERRITORY_PARTNER");
      const territory = await mkTerritoryInState(stateRef);
      await mkActiveAssignment(fieldAgent._id, territory._id);
      return fieldAgent;
    };

    const validEvidence = (overrides = {}) => ({
      sourceType: FA12_EVIDENCE_SOURCE_TYPE.ADMIN_NARRATIVE,
      description: "FA-12.2 verification fixture evidence.",
      ...overrides,
    });

    // ── FIXTURES ───────────────────────────────────────────────────
    const { token: stateAdminAToken } = await mkStateAdmin(stateA);
    const { token: stateAdminBToken } = await mkStateAdmin(stateB);
    const { token: districtAdminToken } = await mkDistrictAdmin(stateA);
    const { token: fieldAgentToken } = await mkPlainUser("FIELD_AGENT");
    const { token: plainUserToken } = await mkPlainUser("USER");

    const tpAgentA = await mkTerritoryPartnerInState(stateA); // in STATE_ADMIN(A)'s scope
    const tpAgentB = await mkTerritoryPartnerInState(stateB); // out of scope for STATE_ADMIN(A)
    const { fieldAgent: acqAgent } = await mkFieldAgent("ACQUISITION_AGENT");

    // ════════════════════════════════════════════════════════════════
    // 1. FOUNDING EVIDENCE + CASE SUCCESS
    // ════════════════════════════════════════════════════════════════
    let case1Id, case1Version;
    {
      const auditBefore = await FieldAgentComplianceAuditEvent.countDocuments();
      const res = await authFetch(`${API}/cases`, indiaToken, {
        method: "POST",
        body: JSON.stringify({
          fieldAgentId: String(tpAgentA._id),
          category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
          evidence: validEvidence(),
        }),
      });
      check("1. Open case with founding evidence -> 201", res.status === 201, res.status);
      check("1. Response includes both case and foundingEvidence", !!res.data.data?.case?.id && !!res.data.data?.foundingEvidence?.id);
      check("1. Case status is OPEN, version 0", res.data.data?.case?.status === "OPEN" && res.data.data?.case?.version === 0);
      check("1. Founding evidence caseRef matches the new case", res.data.data?.foundingEvidence?.caseRef === res.data.data?.case?.id);
      case1Id = res.data.data.case.id;
      case1Version = res.data.data.case.version;
      fixtureCaseIds.push(case1Id);
      fixtureEvidenceIds.push(res.data.data.foundingEvidence.id);

      const caseCount = await FieldAgentComplianceCase.countDocuments({ _id: case1Id });
      const evidenceCount = await FieldAgentComplianceEvidence.countDocuments({ caseRef: case1Id });
      check("1. Exactly one case and one evidence document persisted", caseCount === 1 && evidenceCount === 1);

      const auditAfter = await FieldAgentComplianceAuditEvent.countDocuments();
      check("1./21. Exactly 2 audit events created (EVIDENCE_FILED + CASE_OPENED)", auditAfter - auditBefore === 2, auditAfter - auditBefore);
      const openedEvent = await FieldAgentComplianceAuditEvent.findOne({ action: "CASE_OPENED", entityId: case1Id }).lean();
      check("21. CASE_OPENED audit event has correct entityType/actorType", openedEvent?.entityType === "FIELD_AGENT_COMPLIANCE_CASE" && openedEvent?.actorType === "ADMIN");
    }

    // ════════════════════════════════════════════════════════════════
    // 2. ATOMIC ROLLBACK — invalid founding evidence must roll back the case too
    // ════════════════════════════════════════════════════════════════
    {
      const agentForRollback = await mkTerritoryPartnerInState(stateA);
      const casesBefore = await FieldAgentComplianceCase.countDocuments({ fieldAgentRef: agentForRollback._id });
      const res = await authFetch(`${API}/cases`, indiaToken, {
        method: "POST",
        body: JSON.stringify({
          fieldAgentId: String(agentForRollback._id),
          category: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE,
          evidence: validEvidence({ description: "x".repeat(3000) }), // exceeds EVIDENCE_DESCRIPTION_MAX_LENGTH -> schema ValidationError inside the transaction
        }),
      });
      check("2. Oversized founding-evidence description rejected -> 400", res.status === 400, res.status);
      const casesAfter = await FieldAgentComplianceCase.countDocuments({ fieldAgentRef: agentForRollback._id });
      check("2. No case was left behind despite the failed founding evidence (atomic rollback)", casesAfter === casesBefore, { casesBefore, casesAfter });
    }

    // ════════════════════════════════════════════════════════════════
    // 3. DUPLICATE ACTIVE CASE
    // ════════════════════════════════════════════════════════════════
    {
      const dupRes = await authFetch(`${API}/cases`, indiaToken, {
        method: "POST",
        body: JSON.stringify({
          fieldAgentId: String(tpAgentA._id),
          category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, // same (fieldAgentRef,category) as case1
          evidence: validEvidence(),
        }),
      });
      check("3. Duplicate active case for the same (fieldAgentRef,category) rejected -> 409", dupRes.status === 409, dupRes.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 4. REAL CONCURRENT CASE CREATION
    // ════════════════════════════════════════════════════════════════
    {
      const raceAgent = await mkTerritoryPartnerInState(stateA);
      const attempts = Array.from({ length: 6 }, () =>
        authFetch(`${API}/cases`, indiaToken, {
          method: "POST",
          body: JSON.stringify({ fieldAgentId: String(raceAgent._id), category: FA12_VIOLATION_CATEGORY.FRAUD_SIGNAL_SUPPORTED_REVIEW, evidence: validEvidence() }),
        })
      );
      const results = await Promise.all(attempts);
      const succeeded = results.filter((r) => r.status === 201);
      const conflicted = results.filter((r) => r.status === 409);
      check("4. Real concurrent case creation: exactly 1 of 6 succeeds", succeeded.length === 1, results.map((r) => r.status));
      check("4. The other 5 concurrent attempts are cleanly rejected (409)", conflicted.length === 5, results.map((r) => r.status));
      if (succeeded[0]) fixtureCaseIds.push(succeeded[0].data.data.case.id);
      const caseCount = await FieldAgentComplianceCase.countDocuments({ fieldAgentRef: raceAgent._id });
      check("4. Exactly one case document survives the race", caseCount === 1, caseCount);
      const evidenceCount = await FieldAgentComplianceEvidence.countDocuments({ fieldAgentRef: raceAgent._id });
      check("4. No orphan founding evidence from the losing attempts (exactly 1)", evidenceCount === 1, evidenceCount);
      if (succeeded[0]) fixtureEvidenceIds.push(succeeded[0].data.data.foundingEvidence.id);
    }

    // ════════════════════════════════════════════════════════════════
    // 5. STANDALONE EVIDENCE
    // ════════════════════════════════════════════════════════════════
    {
      const res = await authFetch(`${API}/evidence`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence() }),
      });
      check("5. Standalone evidence filed -> 201", res.status === 201, res.status);
      check("5. Standalone evidence has caseRef null", res.data.data?.evidence?.caseRef === null, res.data.data?.evidence?.caseRef);
      fixtureEvidenceIds.push(res.data.data.evidence.id);
    }

    // ════════════════════════════════════════════════════════════════
    // 6. ADDITIONAL EVIDENCE FOR AN ACTIVE CASE
    // ════════════════════════════════════════════════════════════════
    {
      const auditBefore = await FieldAgentComplianceAuditEvent.countDocuments({ action: "EVIDENCE_ATTACHED_TO_CASE" });
      const res = await authFetch(`${API}/cases/${case1Id}/evidence`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ evidenceType: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, ...validEvidence({ description: "Second, additional piece of evidence for the same case." }) }),
      });
      check("6. Additional evidence for an active case -> 201", res.status === 201, res.status);
      check("6. Additional evidence caseRef matches the case", res.data.data?.evidence?.caseRef === case1Id);
      fixtureEvidenceIds.push(res.data.data.evidence.id);
      const auditAfter = await FieldAgentComplianceAuditEvent.countDocuments({ action: "EVIDENCE_ATTACHED_TO_CASE" });
      check("6. Exactly one EVIDENCE_ATTACHED_TO_CASE audit event written", auditAfter - auditBefore === 1);

      const evidenceCountForCase = await FieldAgentComplianceEvidence.countDocuments({ caseRef: case1Id });
      check("6. Case now has 2 evidence rows (founding + additional)", evidenceCountForCase === 2, evidenceCountForCase);
    }

    // ════════════════════════════════════════════════════════════════
    // 7. EVIDENCE IMMUTABILITY (spot-check — full sweep owned by FA-12.1's own suite)
    // ════════════════════════════════════════════════════════════════
    {
      let blocked = false;
      try {
        await FieldAgentComplianceEvidence.updateOne({ _id: fixtureEvidenceIds[0] }, { $set: { description: "mutated" } });
      } catch (err) {
        blocked = /immutable/i.test(err.message);
      }
      check("7. Evidence created via FA-12.2's own service is still immutable at the model level", blocked);
    }

    // ════════════════════════════════════════════════════════════════
    // 8. EVIDENCE DEDUPE (standalone + case-attached)
    // ════════════════════════════════════════════════════════════════
    {
      const dk = `ztest-fa122-dedupe-${Date.now()}`;
      const first = await authFetch(`${API}/evidence`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.FRAUD_SIGNAL_SUPPORTED_REVIEW, sourceType: FA12_EVIDENCE_SOURCE_TYPE.FRAUD_SIGNAL, sourceRef: String(oid()), description: "Dedupe test evidence.", dedupeKey: dk }),
      });
      check("8. First deterministic evidence filed -> 201", first.status === 201, first.status);
      fixtureEvidenceIds.push(first.data.data.evidence.id);

      const second = await authFetch(`${API}/evidence`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.FRAUD_SIGNAL_SUPPORTED_REVIEW, sourceType: FA12_EVIDENCE_SOURCE_TYPE.FRAUD_SIGNAL, description: "Duplicate citation.", dedupeKey: dk }),
      });
      check("8. Duplicate dedupeKey filing is idempotent -> 201 returning the SAME evidence", second.status === 201 && second.data.data.evidence.id === first.data.data.evidence.id, second.data.data?.evidence?.id);

      const countForKey = await FieldAgentComplianceEvidence.countDocuments({ dedupeKey: dk });
      check("8. Exactly one evidence row exists for this dedupeKey", countForKey === 1, countForKey);
    }

    // ════════════════════════════════════════════════════════════════
    // 9-10. TRANSITION MATRIX — every allowed + every forbidden transition
    // ════════════════════════════════════════════════════════════════
    {
      const ALL_STATUSES = Object.values(FA12_CASE_STATUS);
      const TERMINAL = ["DISMISSED", "RESOLVED"];
      for (const fromStatus of ALL_STATUSES) {
        const allowedTargets = VALID_CASE_TRANSITIONS_MAP[fromStatus] || [];
        for (const toStatus of ALL_STATUSES) {
          if (toStatus === fromStatus) continue;
          const isAllowed = allowedTargets.includes(toStatus);

          // A FRESH FieldAgent per cell — completely eliminates any
          // one-active-case-per-(fieldAgentRef,category) interference
          // between matrix cells.
          const cellAgent = await mkTerritoryPartnerInState(stateA);
          const openRes = await authFetch(`${API}/cases`, indiaToken, {
            method: "POST",
            body: JSON.stringify({ fieldAgentId: String(cellAgent._id), category: FA12_VIOLATION_CATEGORY.TERRITORY_CLAIM_LIFECYCLE_CONCERN, evidence: validEvidence() }),
          });
          const cId = openRes.data.data.case.id;
          fixtureCaseIds.push(cId);
          fixtureEvidenceIds.push(openRes.data.data.foundingEvidence.id);

          // Force the case directly to `fromStatus` via a raw update
          // (transitions themselves are exercised through the real
          // HTTP API separately below — this section isolates the
          // matrix SHAPE itself, not how a case realistically arrives
          // at a given status).
          if (fromStatus !== "OPEN") {
            const setOp = TERMINAL.includes(fromStatus)
              ? { $set: { status: fromStatus, version: 1 }, $unset: { activeCaseMarker: "" } }
              : { $set: { status: fromStatus, version: 1, activeCaseMarker: true } };
            const updateResult = await FieldAgentComplianceCase.collection.updateOne({ _id: new mongoose.Types.ObjectId(cId) }, setOp);
            if (updateResult.modifiedCount !== 1) throw new Error(`Matrix setup failed to force case ${cId} to ${fromStatus}`);
          }
          const versionNow = fromStatus === "OPEN" ? 0 : 1;

          const decisionPayload = toStatus === "UNDER_REVIEW" ? undefined : { outcome: "NO_ACTION", reasoning: "Matrix test decision." };
          const res = await authFetch(`${API}/cases/${cId}/transition`, indiaToken, {
            method: "POST",
            body: JSON.stringify({ expectedVersion: versionNow, toStatus, reason: "Matrix test.", ...(decisionPayload ? { decision: decisionPayload } : {}) }),
          });

          if (isAllowed) {
            check(`9. Allowed transition ${fromStatus} -> ${toStatus} succeeds (200)`, res.status === 200, res.status);
          } else {
            check(`10. Forbidden transition ${fromStatus} -> ${toStatus} rejected (409)`, res.status === 409, res.status);
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // 11. STALE VERSION CONFLICT
    // ════════════════════════════════════════════════════════════════
    let case11Id;
    {
      const openRes = await authFetch(`${API}/cases`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(tpAgentB._id), category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, evidence: validEvidence() }),
      });
      case11Id = openRes.data.data.case.id;
      fixtureCaseIds.push(case11Id);
      fixtureEvidenceIds.push(openRes.data.data.foundingEvidence.id);

      const firstTransition = await authFetch(`${API}/cases/${case11Id}/transition`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 0, toStatus: "UNDER_REVIEW", reason: "Move to review." }),
      });
      check("11. First transition with correct version succeeds", firstTransition.status === 200, firstTransition.status);

      const staleTransition = await authFetch(`${API}/cases/${case11Id}/transition`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 0, toStatus: "WARNING_ISSUED", reason: "Stale attempt.", decision: { outcome: "WARNING_ISSUED", reasoning: "test" } }),
      });
      check("11. Stale expectedVersion (0, now actually 1) rejected -> 409", staleTransition.status === 409, staleTransition.status);

      const caseAfter = await FieldAgentComplianceCase.findById(case11Id).lean();
      check("11. Case status unaffected by the rejected stale transition (still UNDER_REVIEW)", caseAfter.status === "UNDER_REVIEW");
    }

    // ════════════════════════════════════════════════════════════════
    // 12. CONCURRENT TRANSITION RACE
    // ════════════════════════════════════════════════════════════════
    {
      const attempts = [
        authFetch(`${API}/cases/${case11Id}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "WARNING_ISSUED", reason: "race a", decision: { outcome: "WARNING_ISSUED", reasoning: "a" } }) }),
        authFetch(`${API}/cases/${case11Id}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "ESCALATED", reason: "race b", decision: { outcome: "ESCALATED_FOR_ENFORCEMENT", reasoning: "b" } }) }),
        authFetch(`${API}/cases/${case11Id}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "DISMISSED", reason: "race c", decision: { outcome: "DISMISSED", reasoning: "c" } }) }),
      ];
      const results = await Promise.all(attempts);
      const succeeded = results.filter((r) => r.status === 200);
      check("12. Concurrent transition race: exactly 1 of 3 succeeds", succeeded.length === 1, results.map((r) => r.status));
      const auditCount = await FieldAgentComplianceAuditEvent.countDocuments({ entityId: case11Id, action: { $in: ["CASE_WARNING_ISSUED", "CASE_ESCALATED", "CASE_DISMISSED"] } });
      check("12. Exactly one audit event written for the race, no duplicates", auditCount === 1, auditCount);
    }

    // ════════════════════════════════════════════════════════════════
    // 13-16. ACTIVE-MARKER SEMANTICS AT EACH STATUS
    // ════════════════════════════════════════════════════════════════
    {
      const mkCaseAt = async (agent, category) => {
        const r = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agent._id), category, evidence: validEvidence() }) });
        fixtureCaseIds.push(r.data.data.case.id);
        fixtureEvidenceIds.push(r.data.data.foundingEvidence.id);
        return r.data.data.case.id;
      };

      const agentWarn = await mkTerritoryPartnerInState(stateA);
      const cWarnId = await mkCaseAt(agentWarn, FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE);
      await authFetch(`${API}/cases/${cWarnId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "UNDER_REVIEW", reason: "r" }) });
      await authFetch(`${API}/cases/${cWarnId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "WARNING_ISSUED", reason: "r", decision: { outcome: "WARNING_ISSUED", reasoning: "r" } }) });
      const cWarn = await FieldAgentComplianceCase.findById(cWarnId).lean();
      check("13. activeCaseMarker retained at WARNING_ISSUED", cWarn.status === "WARNING_ISSUED" && cWarn.activeCaseMarker === true);
      const dupWarn = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agentWarn._id), category: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, evidence: validEvidence() }) });
      check("13. Slot still occupied at WARNING_ISSUED (new case for same agent/category -> 409)", dupWarn.status === 409, dupWarn.status);

      const agentEsc = await mkTerritoryPartnerInState(stateA);
      const cEscId = await mkCaseAt(agentEsc, FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE);
      await authFetch(`${API}/cases/${cEscId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "UNDER_REVIEW", reason: "r" }) });
      await authFetch(`${API}/cases/${cEscId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "ESCALATED", reason: "r", decision: { outcome: "ESCALATED_FOR_ENFORCEMENT", reasoning: "r" } }) });
      const cEsc = await FieldAgentComplianceCase.findById(cEscId).lean();
      check("14. activeCaseMarker retained at ESCALATED", cEsc.status === "ESCALATED" && cEsc.activeCaseMarker === true);

      const agentDismiss = await mkTerritoryPartnerInState(stateA);
      const cDismissId = await mkCaseAt(agentDismiss, FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH);
      await authFetch(`${API}/cases/${cDismissId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "DISMISSED", reason: "r", decision: { outcome: "DISMISSED", reasoning: "r" } }) });
      const cDismiss = await FieldAgentComplianceCase.findById(cDismissId).lean();
      check("15. activeCaseMarker removed at DISMISSED", cDismiss.status === "DISMISSED" && cDismiss.activeCaseMarker === undefined);
      const newAfterDismiss = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agentDismiss._id), category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, evidence: validEvidence() }) });
      check("15. New case for same agent/category possible after DISMISSED", newAfterDismiss.status === 201, newAfterDismiss.status);
      if (newAfterDismiss.status === 201) {
        fixtureCaseIds.push(newAfterDismiss.data.data.case.id);
        fixtureEvidenceIds.push(newAfterDismiss.data.data.foundingEvidence.id);
      }

      const agentResolve = await mkTerritoryPartnerInState(stateA);
      const cResolveId = await mkCaseAt(agentResolve, FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH);
      await authFetch(`${API}/cases/${cResolveId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "RESOLVED", reason: "r", decision: { outcome: "NO_ACTION", reasoning: "r" } }) });
      const cResolve = await FieldAgentComplianceCase.findById(cResolveId).lean();
      check("16. activeCaseMarker removed at RESOLVED", cResolve.status === "RESOLVED" && cResolve.activeCaseMarker === undefined);

      // stash for reopen tests
      global.__fa122_cResolveId = cResolveId;
      global.__fa122_cDismissId = cDismissId;
      global.__fa122_agentResolve = agentResolve;
      global.__fa122_agentDismiss = agentDismiss;
    }

    // ════════════════════════════════════════════════════════════════
    // 17-18. REOPEN RESOLVED / DISMISSED
    // ════════════════════════════════════════════════════════════════
    {
      const cResolveId = global.__fa122_cResolveId;

      const reopenResolved = await authFetch(`${API}/cases/${cResolveId}/reopen`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "Offline communication warranted a second look." }) });
      check("17. Reopen a RESOLVED case -> 200", reopenResolved.status === 200, reopenResolved.status);
      check("17. Reopened case status is UNDER_REVIEW with marker restored", reopenResolved.data.data?.case?.status === "UNDER_REVIEW");
      const cResolveAfter = await FieldAgentComplianceCase.findById(cResolveId).lean();
      // version: 0 at open, 1 after the transition to RESOLVED, 2 after reopen.
      check("17. activeCaseMarker restored, reopenedHistory has 1 entry, version incremented", cResolveAfter.activeCaseMarker === true && cResolveAfter.reopenedHistory.length === 1 && cResolveAfter.version === 2, cResolveAfter);

      // Dedicated fresh case for the DISMISSED-reopen test — section 15
      // (above) already opened a SECOND active case for
      // (agentDismiss, ADMIN_OBSERVED_POLICY_BREACH) to prove
      // post-DISMISSED case creation, so cDismissId's own slot is no
      // longer free; reusing it here would collide with test 19's own
      // scenario instead of testing a clean reopen.
      const freshDismissAgent = await mkTerritoryPartnerInState(stateA);
      const freshDismissOpen = await authFetch(`${API}/cases`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(freshDismissAgent._id), category: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, evidence: validEvidence() }),
      });
      const freshDismissCaseId = freshDismissOpen.data.data.case.id;
      fixtureCaseIds.push(freshDismissCaseId);
      fixtureEvidenceIds.push(freshDismissOpen.data.data.foundingEvidence.id);
      await authFetch(`${API}/cases/${freshDismissCaseId}/transition`, indiaToken, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 0, toStatus: "DISMISSED", reason: "r", decision: { outcome: "DISMISSED", reasoning: "r" } }),
      });

      const reopenDismissed = await authFetch(`${API}/cases/${freshDismissCaseId}/reopen`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "New context received offline." }) });
      check("18. Reopen a DISMISSED case -> 200", reopenDismissed.status === 200, reopenDismissed.status);

      const noReasonReopen = await authFetch(`${API}/cases/${cResolveId}/reopen`, indiaToken, { method: "POST", body: JSON.stringify({}) });
      check("Reopen without a reason rejected -> 400", noReasonReopen.status === 400, noReasonReopen.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 19. REOPEN CONFLICT WHEN ANOTHER ACTIVE CASE EXISTS
    // ════════════════════════════════════════════════════════════════
    {
      const agent = await mkTerritoryPartnerInState(stateA);
      const category = FA12_VIOLATION_CATEGORY.TERRITORY_CLAIM_LIFECYCLE_CONCERN;
      const first = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agent._id), category, evidence: validEvidence() }) });
      const firstCaseId = first.data.data.case.id;
      fixtureCaseIds.push(firstCaseId);
      fixtureEvidenceIds.push(first.data.data.foundingEvidence.id);
      await authFetch(`${API}/cases/${firstCaseId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "DISMISSED", reason: "r", decision: { outcome: "DISMISSED", reasoning: "r" } }) });

      const second = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agent._id), category, evidence: validEvidence() }) });
      const secondCaseId = second.data.data.case.id;
      fixtureCaseIds.push(secondCaseId);
      fixtureEvidenceIds.push(second.data.data.foundingEvidence.id);

      const reopenAttempt = await authFetch(`${API}/cases/${firstCaseId}/reopen`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "attempt reopen while a newer case is active" }) });
      check("19. Reopening a terminal case while another active case exists for the same (agent,category) fails safely -> 409", reopenAttempt.status === 409, reopenAttempt.status);

      const firstAfter = await FieldAgentComplianceCase.findById(firstCaseId).lean();
      check("19. The terminal case remains terminal, untouched", firstAfter.status === "DISMISSED" && firstAfter.activeCaseMarker === undefined);
      const secondAfter = await FieldAgentComplianceCase.findById(secondCaseId).lean();
      check("19. The newer active case is completely untouched", secondAfter.status === "OPEN" && secondAfter.activeCaseMarker === true);
    }

    // ════════════════════════════════════════════════════════════════
    // 20. DUPLICATE REOPEN SAFETY (concurrent race)
    // ════════════════════════════════════════════════════════════════
    {
      const agent = await mkTerritoryPartnerInState(stateA);
      const category = FA12_VIOLATION_CATEGORY.FRAUD_SIGNAL_SUPPORTED_REVIEW;
      const openRes = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agent._id), category, evidence: validEvidence() }) });
      const cId = openRes.data.data.case.id;
      fixtureCaseIds.push(cId);
      fixtureEvidenceIds.push(openRes.data.data.foundingEvidence.id);
      await authFetch(`${API}/cases/${cId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "RESOLVED", reason: "r", decision: { outcome: "NO_ACTION", reasoning: "r" } }) });

      const attempts = Array.from({ length: 4 }, () => authFetch(`${API}/cases/${cId}/reopen`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "concurrent reopen attempt" }) }));
      const results = await Promise.all(attempts);
      const succeeded = results.filter((r) => r.status === 200);
      check("20. Concurrent reopen race: exactly 1 of 4 succeeds", succeeded.length === 1, results.map((r) => r.status));

      const reopenedAudit = await FieldAgentComplianceAuditEvent.countDocuments({ entityId: cId, action: "CASE_REOPENED" });
      check("20. Exactly one CASE_REOPENED audit event, no duplicates", reopenedAudit === 1, reopenedAudit);
      const caseAfter = await FieldAgentComplianceCase.findById(cId).lean();
      check("20. reopenedHistory has exactly one entry (no duplicate history rows)", caseAfter.reopenedHistory.length === 1, caseAfter.reopenedHistory.length);
    }

    // ════════════════════════════════════════════════════════════════
    // 22. AUDIT IMMUTABILITY (spot-check — full sweep owned by FA-12.1's own suite)
    // ════════════════════════════════════════════════════════════════
    {
      const anEvent = await FieldAgentComplianceAuditEvent.findOne({ action: "CASE_OPENED" }).lean();
      let blocked = false;
      try {
        await FieldAgentComplianceAuditEvent.updateOne({ _id: anEvent._id }, { $set: { reason: "mutated" } });
      } catch (err) {
        blocked = /immutable/i.test(err.message);
      }
      check("22. Audit events created by FA-12.2's own services are still immutable at the model level", blocked);

      // No client-facing route ever creates an audit event directly —
      // structural confirmation: the compliance router exposes no
      // /audit-events write route at all.
      const noDirectAuditRoute = await authFetch(`${API}/audit-events`, indiaToken, { method: "POST", body: JSON.stringify({ action: "CASE_OPENED" }) });
      check("22. No route exists for direct client-side audit event creation (404)", noDirectAuditRoute.status === 404, noDirectAuditRoute.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 23-29. AUTHORIZATION MATRIX
    // ════════════════════════════════════════════════════════════════
    {
      // 23. INDIA_ADMIN full authority — already proven throughout
      // (every case/evidence/transition/reopen above used indiaToken
      // successfully).
      check("23. INDIA_ADMIN full authority proven throughout this run (open/evidence/transition/reopen all succeeded)", true);

      // 24. STATE_ADMIN own-state Territory Partner scope.
      const stateOwnRes = await authFetch(`${API}/evidence`, stateAdminAToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence() }),
      });
      check("24. STATE_ADMIN(A) can file evidence for a same-state Territory Partner -> 201", stateOwnRes.status === 201, stateOwnRes.status);
      if (stateOwnRes.status === 201) fixtureEvidenceIds.push(stateOwnRes.data.data.evidence.id);

      const stateOwnListRes = await authFetch(`${API}/cases?fieldAgentRef=${tpAgentA._id}`, stateAdminAToken);
      check("24. STATE_ADMIN(A) can list cases for a same-state Territory Partner -> 200", stateOwnListRes.status === 200, stateOwnListRes.status);

      // 25. STATE_ADMIN cross-state denial.
      const crossStateRes = await authFetch(`${API}/evidence`, stateAdminAToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(tpAgentB._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence() }),
      });
      check("25. STATE_ADMIN(A) denied for a cross-state Territory Partner -> 403", crossStateRes.status === 403, crossStateRes.status);

      // 26. STATE_ADMIN Acquisition Agent denial.
      const acqDenyRes = await authFetch(`${API}/evidence`, stateAdminAToken, {
        method: "POST",
        body: JSON.stringify({ fieldAgentId: String(acqAgent._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence() }),
      });
      check("26. STATE_ADMIN(A) denied for an Acquisition Agent (INDIA-only) -> 403", acqDenyRes.status === 403, acqDenyRes.status);

      // 27. STATE_ADMIN zero decision authority — denied even for their own-state, in-scope case.
      const scopedCaseRes = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), category: FA12_VIOLATION_CATEGORY.TERRITORY_CLAIM_LIFECYCLE_CONCERN, evidence: validEvidence() }) });
      const scopedCaseId = scopedCaseRes.data.data.case.id;
      fixtureCaseIds.push(scopedCaseId);
      fixtureEvidenceIds.push(scopedCaseRes.data.data.foundingEvidence.id);

      const stateTransitionDenied = await authFetch(`${API}/cases/${scopedCaseId}/transition`, stateAdminAToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "UNDER_REVIEW", reason: "attempt" }) });
      check("27. STATE_ADMIN(A) cannot transition even a same-state, in-scope case -> 403", stateTransitionDenied.status === 403, stateTransitionDenied.status);
      const stateReopenDenied = await authFetch(`${API}/cases/${scopedCaseId}/reopen`, stateAdminAToken, { method: "POST", body: JSON.stringify({ reason: "attempt" }) });
      check("27. STATE_ADMIN(A) cannot reopen -> 403", stateReopenDenied.status === 403, stateReopenDenied.status);

      // 28. DISTRICT_ADMIN denial.
      const districtDenied = await authFetch(`${API}/cases`, districtAdminToken);
      check("28. DISTRICT_ADMIN denied for list -> 403", districtDenied.status === 403, districtDenied.status);
      const districtFileDenied = await authFetch(`${API}/evidence`, districtAdminToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence() }) });
      check("28. DISTRICT_ADMIN denied for filing evidence -> 403", districtFileDenied.status === 403, districtFileDenied.status);

      // 29. FIELD_AGENT denial.
      const faDenied = await authFetch(`${API}/cases`, fieldAgentToken);
      check("29. FIELD_AGENT denied for list -> 403", faDenied.status === 403, faDenied.status);
      const userDenied = await authFetch(`${API}/cases`, plainUserToken);
      check("29. USER denied for list -> 403", userDenied.status === 403, userDenied.status);
      const noAuthDenied = await authFetch(`${API}/cases`, null);
      check("29. Unauthenticated denied -> 401", noAuthDenied.status === 401, noAuthDenied.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 30. IDOR PROTECTION
    // ════════════════════════════════════════════════════════════════
    {
      const idorListRes = await authFetch(`${API}/cases?fieldAgentRef=${tpAgentB._id}`, stateAdminAToken);
      const idorIds = (idorListRes.data.data?.cases || []).map((c) => c.id);
      check("30. STATE_ADMIN(A) cannot retrieve an out-of-scope agent's cases via the fieldAgentRef list filter", idorListRes.status === 200 && idorIds.length === 0, { status: idorListRes.status, count: idorIds.length });

      // KYC_ELIGIBILITY_LAPSE — deliberately a different category than
      // section 11/12's own (tpAgentB, ADMIN_OBSERVED_POLICY_BREACH)
      // case, whose final status after the concurrent-transition race
      // is non-deterministic and may still occupy that slot.
      const bAgentCaseRes = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentB._id), category: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, evidence: validEvidence() }) });
      const bCaseId = bAgentCaseRes.data.data.case.id;
      fixtureCaseIds.push(bCaseId);
      fixtureEvidenceIds.push(bAgentCaseRes.data.data.foundingEvidence.id);
      const idorDetailRes = await authFetch(`${API}/cases/${bCaseId}`, stateAdminAToken);
      check("30. STATE_ADMIN(A) cannot fetch a cross-state case's detail directly by id -> 403", idorDetailRes.status === 403, idorDetailRes.status);

      const idorEvidenceAttach = await authFetch(`${API}/cases/${bCaseId}/evidence`, stateAdminAToken, { method: "POST", body: JSON.stringify({ evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence() }) });
      check("30. STATE_ADMIN(A) cannot attach evidence to a cross-state case -> 403", idorEvidenceAttach.status === 403, idorEvidenceAttach.status);

      const arbitraryCaseRes = await authFetch(`${API}/cases/${oid()}`, indiaToken);
      check("30. Arbitrary/nonexistent caseId -> 404", arbitraryCaseRes.status === 404, arbitraryCaseRes.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 31. STRICT VALIDATOR REJECTION
    // ════════════════════════════════════════════════════════════════
    {
      const unknownField = await authFetch(`${API}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence(), notARealField: "hack" }) });
      check("31. Unknown field rejected -> 400", unknownField.status === 400, unknownField.status);

      const invalidEnum = await authFetch(`${API}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: "NOT_REAL", ...validEvidence() }) });
      check("31. Invalid evidenceType enum rejected -> 400", invalidEnum.status === 400, invalidEnum.status);

      const oversizedDescription = await authFetch(`${API}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence({ description: "x".repeat(2001) }) }) });
      check("31. Oversized description rejected -> 400", oversizedDescription.status === 400, oversizedDescription.status);

      const oversizedReason = await authFetch(`${API}/cases/${case1Id}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: case1Version, toStatus: "UNDER_REVIEW", reason: "x".repeat(501) }) });
      check("31. Oversized transition reason rejected -> 400", oversizedReason.status === 400, oversizedReason.status);

      const riggedFields = await authFetch(`${API}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, ...validEvidence(), reportedBy: "bogus", status: "PUBLISHED" }) });
      check("31. Server-controlled field injection (reportedBy/status) rejected -> 400", riggedFields.status === 400, riggedFields.status);

      const mongoOperatorInjection = await authFetch(`${API}/cases?fieldAgentRef[$ne]=null`, indiaToken);
      check("31. Mongo operator injection attempt in query is rejected (400), not silently executed", mongoOperatorInjection.status === 400, mongoOperatorInjection.status);

      const regexInjection = await authFetch(`${API}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(tpAgentA._id), evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE, sourceType: FA12_EVIDENCE_SOURCE_TYPE.ADMIN_NARRATIVE, description: { $regex: ".*" } }) });
      check("31. Object-typed field where a string is expected is rejected -> 400 (no regex-DoS surface)", regexInjection.status === 400, regexInjection.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 32. PAGINATION / SORT / FILTER SAFETY
    // ════════════════════════════════════════════════════════════════
    {
      const badPage = await authFetch(`${API}/cases?page=0`, indiaToken);
      check("32. page=0 rejected -> 400", badPage.status === 400, badPage.status);
      const badLimit = await authFetch(`${API}/cases?limit=99999`, indiaToken);
      check("32. limit over max rejected -> 400", badLimit.status === 400, badLimit.status);

      const bounded = await authFetch(`${API}/cases?limit=2`, indiaToken);
      check("32. Pagination is bounded (limit=2 returns at most 2 items)", (bounded.data.data?.cases || []).length <= 2, bounded.data.data?.cases?.length);

      const ordered = await authFetch(`${API}/cases?limit=100`, indiaToken);
      const createdAts = (ordered.data.data?.cases || []).map((c) => new Date(c.createdAt).getTime());
      const isDescending = createdAts.every((v, i) => i === 0 || createdAts[i - 1] >= v);
      check("32. Deterministic ordering — createdAt DESC", isDescending);

      const statusFilter = await authFetch(`${API}/cases?status=RESOLVED&limit=100`, indiaToken);
      const allResolved = (statusFilter.data.data?.cases || []).every((c) => c.status === "RESOLVED");
      check("32. status filter works (all returned rows are RESOLVED)", statusFilter.status === 200 && allResolved, statusFilter.status);

      const invalidStatusFilter = await authFetch(`${API}/cases?status=NOT_REAL`, indiaToken);
      check("32. Invalid status filter value rejected -> 400", invalidStatusFilter.status === 400, invalidStatusFilter.status);
    }

    // ════════════════════════════════════════════════════════════════
    // 33. TERMINAL EVIDENCE RESTRICTION
    // ════════════════════════════════════════════════════════════════
    {
      // A dedicated fresh terminal case for this test.
      const agent = await mkTerritoryPartnerInState(stateA);
      const openRes = await authFetch(`${API}/cases`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId: String(agent._id), category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, evidence: validEvidence() }) });
      const cId = openRes.data.data.case.id;
      fixtureCaseIds.push(cId);
      fixtureEvidenceIds.push(openRes.data.data.foundingEvidence.id);
      await authFetch(`${API}/cases/${cId}/transition`, indiaToken, { method: "POST", body: JSON.stringify({ expectedVersion: 0, toStatus: "DISMISSED", reason: "r", decision: { outcome: "DISMISSED", reasoning: "r" } }) });

      const attachToTerminal = await authFetch(`${API}/cases/${cId}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ evidenceType: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, ...validEvidence() }) });
      check("33. Adding evidence to a terminal (DISMISSED) case is rejected -> 409", attachToTerminal.status === 409, attachToTerminal.status);

      const reopenThenAttach = await authFetch(`${API}/cases/${cId}/reopen`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "reopen to allow new evidence" }) });
      check("33. Reopening the case succeeds", reopenThenAttach.status === 200, reopenThenAttach.status);
      const attachAfterReopen = await authFetch(`${API}/cases/${cId}/evidence`, indiaToken, { method: "POST", body: JSON.stringify({ evidenceType: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH, ...validEvidence() }) });
      check("33. Evidence CAN be added once the case is reopened (active again)", attachAfterReopen.status === 201, attachAfterReopen.status);
      if (attachAfterReopen.status === 201) fixtureEvidenceIds.push(attachAfterReopen.data.data.evidence.id);
    }
  } finally {
    // ── CLEANUP (explicit ID lists only — never a broad delete) ──────
    await FieldAgentComplianceAuditEvent.collection.deleteMany({ entityId: { $in: [...fixtureCaseIds.map((id) => new mongoose.Types.ObjectId(id)), ...fixtureEvidenceIds.map((id) => new mongoose.Types.ObjectId(id))] } });
    await FieldAgentComplianceCase.collection.deleteMany({ _id: { $in: fixtureCaseIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    await FieldAgentComplianceEvidence.collection.deleteMany({ _id: { $in: fixtureEvidenceIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
    await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });

    const residue = {
      cases: await FieldAgentComplianceCase.countDocuments({ _id: { $in: fixtureCaseIds.map((id) => new mongoose.Types.ObjectId(id)) } }),
      evidence: await FieldAgentComplianceEvidence.countDocuments({ _id: { $in: fixtureEvidenceIds.map((id) => new mongoose.Types.ObjectId(id)) } }),
      territories: await CommercialTerritory.countDocuments({ _id: { $in: fixtureTerritoryIds } }),
      assignments: await TerritoryAssignment.countDocuments({ _id: { $in: fixtureAssignmentIds } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
    };
    const zeroResidue = Object.values(residue).every((n) => n === 0);
    check("34. Zero residue — all FA-12.2 fixtures removed", zeroResidue, residue);
    server.close();
  }

  // ── PRODUCTION BOUNDARY (captured AFTER cleanup) ────────────────
  {
    const after = {
      ledger: await FieldAgentEarningLedger.countDocuments(),
      claims: await AcquisitionClaim.countDocuments(),
      publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
      perfSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
      territories: await CommercialTerritory.countDocuments(),
      assignments: await TerritoryAssignment.countDocuments(),
    };
    check("34. FieldAgentEarningLedger unchanged", after.ledger === before.ledger, { before: before.ledger, after: after.ledger });
    check("34. AcquisitionClaim count unchanged", after.claims === before.claims, { before: before.claims, after: after.claims });
    check("34. No real published PerformancePolicyVersion left behind", after.publishedPolicies === 0, after.publishedPolicies);
    check("34. No real FieldAgentPerformanceSnapshot left behind", after.perfSnapshots === 0, after.perfSnapshots);
    check("34. CommercialTerritory count returned to baseline", after.territories === before.territories, { before: before.territories, after: after.territories });
    check("34. TerritoryAssignment count returned to baseline", after.assignments === before.assignments, { before: before.assignments, after: after.assignments });
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);
  await mongoose.connection.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ FA-12.2 verification body threw:", err);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
