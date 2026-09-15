/**
 * BARBER ENGINE V1
 * backend/scripts/verifyFieldAgentCompliance.js
 *
 * FA-12.1 — dedicated, real-Mongo verification for the Field Agent
 * Compliance/Penalty DOMAIN FOUNDATION ONLY: three models
 * (FieldAgentComplianceEvidence, FieldAgentComplianceCase,
 * FieldAgentComplianceAuditEvent), their schema constraints, indexes,
 * immutability, and lifecycle/audit-action constants.
 *
 * Deliberately NOT covered here (FA-12.2+ scope, not yet implemented):
 * evidence-filing service logic, case transition service, admin API,
 * authorization/scoping, audit-event-writing on real transitions.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentCompliance.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentComplianceEvidence from "../modules/fieldAgent/models/FieldAgentComplianceEvidence.js";
import FieldAgentComplianceCase from "../modules/fieldAgent/models/FieldAgentComplianceCase.js";
import FieldAgentComplianceAuditEvent from "../modules/fieldAgent/models/FieldAgentComplianceAuditEvent.js";
import {
  FA12_VIOLATION_CATEGORY,
  FA12_EVIDENCE_SOURCE_TYPE,
  FA12_CASE_STATUS,
  FA12_CASE_TERMINAL_STATUSES,
  FA12_CASE_ACTIVE_STATUSES,
  FA12_AUDIT_ENTITY_TYPE,
  FA12_AUDIT_ACTOR_TYPE,
  FA12_AUDIT_ACTION,
  EVIDENCE_DESCRIPTION_MAX_LENGTH,
} from "../modules/fieldAgent/constants/compliance.constants.js";

// Untouched-by-FA-12 collections — spot-checked before/after.
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import FieldAgentEarningJobCheckpoint from "../modules/fieldAgent/models/FieldAgentEarningJobCheckpoint.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import TerritoryPartnerTermSnapshot from "../modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import PerformancePolicyVersion from "../modules/fieldAgent/models/PerformancePolicyVersion.js";
import FieldAgentPerformanceSnapshot from "../modules/fieldAgent/models/FieldAgentPerformanceSnapshot.js";

const NAME_PREFIX = "ZTEST_FA12_";
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

  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
  if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run FA-12.1 verification");

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureEvidenceIds = [];
  const fixtureCaseIds = [];
  const fixtureAuditEventIds = [];

  const before = {
    evidence: await FieldAgentComplianceEvidence.countDocuments(),
    cases: await FieldAgentComplianceCase.countDocuments(),
    auditEvents: await FieldAgentComplianceAuditEvent.countDocuments(),
    ledger: await FieldAgentEarningLedger.countDocuments(),
    gaps: await FieldAgentEarningPolicyGap.countDocuments(),
    checkpoint: await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean(),
    progress: await AcquisitionEarningProgress.countDocuments(),
    termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments(),
    claims: await AcquisitionClaim.countDocuments(),
    assignments: await TerritoryAssignment.countDocuments(),
    publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
    perfSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
  };

  try {
    const mkFieldAgent = async (commercialPath = "TERRITORY_PARTNER") => {
      const agentUser = await User.create({
        name: `${NAME_PREFIX}AGENT_${Date.now()}_${Math.random()}`,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        role: "FIELD_AGENT",
        accountStatus: "ACTIVE",
      });
      fixtureUserIds.push(agentUser._id);
      const fieldAgent = await FieldAgent.create({
        userRef: agentUser._id,
        applicationRef: oid(),
        agentCode: `ZF12-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE",
        commercialPath,
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      return fieldAgent;
    };

    // ── 1-4. SCHEMA VALIDATION / REQUIRED FIELDS / BOUNDED DESCRIPTION ──
    const agent1 = await mkFieldAgent("TERRITORY_PARTNER");
    {
      let missingFieldRejected = false;
      try {
        await FieldAgentComplianceEvidence.create({ fieldAgentRef: agent1._id }); // missing required fields
      } catch (err) {
        missingFieldRejected = err.name === "ValidationError";
      }
      check("1/3. Evidence rejects creation with missing required fields", missingFieldRejected);

      let tooLongRejected = false;
      try {
        await FieldAgentComplianceEvidence.create({
          fieldAgentRef: agent1._id,
          evidenceType: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
          sourceType: FA12_EVIDENCE_SOURCE_TYPE.ADMIN_NARRATIVE,
          description: "x".repeat(EVIDENCE_DESCRIPTION_MAX_LENGTH + 1),
          reportedBy: indiaAdmin._id,
        });
      } catch (err) {
        tooLongRejected = err.name === "ValidationError";
      }
      check("4. Evidence rejects a description longer than the bounded max length", tooLongRejected);

      let invalidEnumRejected = false;
      try {
        await FieldAgentComplianceEvidence.create({
          fieldAgentRef: agent1._id,
          evidenceType: "NOT_A_REAL_CATEGORY",
          sourceType: FA12_EVIDENCE_SOURCE_TYPE.ADMIN_NARRATIVE,
          description: "test",
          reportedBy: indiaAdmin._id,
        });
      } catch (err) {
        invalidEnumRejected = err.name === "ValidationError";
      }
      check("2. Evidence rejects an evidenceType outside the approved taxonomy", invalidEnumRejected);
    }

    // ── 5. sourceSnapshot bounded structure ──────────────────────────
    {
      const ev = await FieldAgentComplianceEvidence.create({
        fieldAgentRef: agent1._id,
        evidenceType: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE,
        sourceType: FA12_EVIDENCE_SOURCE_TYPE.KYC_STATUS,
        sourceSnapshot: { kycStatus: "EXPIRED", asOf: new Date() },
        description: "KYC lapsed to EXPIRED.",
        reportedBy: indiaAdmin._id,
      });
      fixtureEvidenceIds.push(ev._id);
      const lean = await FieldAgentComplianceEvidence.findById(ev._id).lean();
      const snapshotKeys = Object.keys(lean.sourceSnapshot).sort();
      const allowedKeys = ["fraudSignalType", "fraudSignalSeverity", "kycStatus", "territoryAssignmentStatus", "territoryAssignmentEndReason", "acquisitionClaimStatus", "acquisitionClaimEndedReason", "asOf"].sort();
      check("5. sourceSnapshot only ever contains the explicitly whitelisted field set (never an arbitrary Mixed dump)", snapshotKeys.every((k) => allowedKeys.includes(k)), snapshotKeys);
      check("5. sourceSnapshot.kycStatus stored correctly", lean.sourceSnapshot.kycStatus === "EXPIRED");
    }

    // ── 6. IMMUTABLE EVIDENCE BEHAVIOR (comprehensive mutation-path sweep) ──
    {
      const targetId = fixtureEvidenceIds[0];
      const results = {};

      try {
        const doc = await FieldAgentComplianceEvidence.findById(targetId);
        doc.description = "mutated";
        await doc.save();
        results.saveOnExisting = "NOT_BLOCKED";
      } catch (err) {
        results.saveOnExisting = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      try {
        await FieldAgentComplianceEvidence.findOneAndUpdate({ _id: targetId }, { $set: { description: "mutated" } });
        results.findOneAndUpdate = "NOT_BLOCKED";
      } catch (err) {
        results.findOneAndUpdate = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      try {
        await FieldAgentComplianceEvidence.updateOne({ _id: targetId }, { $set: { description: "mutated" } });
        results.updateOne = "NOT_BLOCKED";
      } catch (err) {
        results.updateOne = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      try {
        await FieldAgentComplianceEvidence.updateMany({ _id: targetId }, { $set: { description: "mutated" } });
        results.updateMany = "NOT_BLOCKED";
      } catch (err) {
        results.updateMany = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      try {
        await FieldAgentComplianceEvidence.findByIdAndUpdate(targetId, { $set: { description: "mutated" } });
        results.findByIdAndUpdate = "NOT_BLOCKED";
      } catch (err) {
        results.findByIdAndUpdate = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      if (typeof FieldAgentComplianceEvidence.prototype?.update === "function" || typeof FieldAgentComplianceEvidence.update === "function") {
        try {
          await FieldAgentComplianceEvidence.update({ _id: targetId }, { $set: { description: "mutated" } });
          results.update = "NOT_BLOCKED";
        } catch (err) {
          results.update = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
        }
      } else {
        results.update = "NOT_APPLICABLE (Mongoose 7+ removed Model.update())";
      }

      try {
        await FieldAgentComplianceEvidence.replaceOne({ _id: targetId }, { description: "mutated" });
        results.replaceOne = "NOT_BLOCKED";
      } catch (err) {
        results.replaceOne = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      try {
        await FieldAgentComplianceEvidence.findOneAndReplace({ _id: targetId }, { description: "mutated" });
        results.findOneAndReplace = "NOT_BLOCKED";
      } catch (err) {
        results.findOneAndReplace = /immutable/i.test(err.message) ? "BLOCKED" : `OTHER_ERROR:${err.message}`;
      }

      let deleteBlocked = true;
      try {
        await FieldAgentComplianceEvidence.deleteOne({ _id: targetId });
        deleteBlocked = false;
      } catch (err) {
        deleteBlocked = /immutable/i.test(err.message);
      }

      const allBlocked = Object.entries(results).every(([, v]) => v === "BLOCKED" || v.startsWith("NOT_APPLICABLE"));
      check("6. Evidence: all applicable mutation paths blocked (save/findOneAndUpdate/updateOne/updateMany/findByIdAndUpdate/update/replaceOne/findOneAndReplace)", allBlocked, results);
      check("6. Evidence: deleteOne blocked", deleteBlocked);

      const stillThere = await FieldAgentComplianceEvidence.findById(targetId).lean();
      check("6. Evidence document unchanged after every blocked attempt", stillThere.description === "KYC lapsed to EXPIRED.");
    }

    // ── 7. IMMUTABLE AUDITEVENT BEHAVIOR ─────────────────────────────
    {
      const ae = await FieldAgentComplianceAuditEvent.create({
        entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_EVIDENCE,
        entityId: fixtureEvidenceIds[0],
        actorRef: indiaAdmin._id,
        actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
        action: FA12_AUDIT_ACTION.EVIDENCE_FILED,
        newValue: { evidenceType: "KYC_ELIGIBILITY_LAPSE" },
      });
      fixtureAuditEventIds.push(ae._id);

      let updateBlocked = true;
      try {
        await FieldAgentComplianceAuditEvent.updateOne({ _id: ae._id }, { $set: { reason: "mutated" } });
        updateBlocked = false;
      } catch (err) {
        updateBlocked = /immutable/i.test(err.message);
      }
      let deleteBlocked = true;
      try {
        await FieldAgentComplianceAuditEvent.findOneAndDelete({ _id: ae._id });
        deleteBlocked = false;
      } catch (err) {
        deleteBlocked = /immutable/i.test(err.message);
      }
      let replaceBlocked = true;
      try {
        await FieldAgentComplianceAuditEvent.replaceOne({ _id: ae._id }, { action: "CASE_OPENED" });
        replaceBlocked = false;
      } catch (err) {
        replaceBlocked = /immutable/i.test(err.message);
      }
      check("7. AuditEvent: updateOne blocked", updateBlocked);
      check("7. AuditEvent: findOneAndDelete blocked", deleteBlocked);
      check("7. AuditEvent: replaceOne blocked", replaceBlocked);
    }

    // ── 8-9. CASE VERSION DEFAULT / CATEGORY IMMUTABILITY ────────────
    let case1;
    {
      case1 = await FieldAgentComplianceCase.create({
        fieldAgentRef: agent1._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(case1._id);
      check("8. Case.version defaults to 0", case1.version === 0, case1.version);
      check("8. Case.status defaults to OPEN", case1.status === FA12_CASE_STATUS.OPEN);
      check("8. Case.activeCaseMarker defaults to true", case1.activeCaseMarker === true);

      let categoryChangeRejected = false;
      try {
        const doc = await FieldAgentComplianceCase.findById(case1._id);
        doc.category = FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH;
        await doc.save();
        const fresh = await FieldAgentComplianceCase.findById(case1._id).lean();
        categoryChangeRejected = fresh.category === FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE;
      } catch (err) {
        categoryChangeRejected = true;
      }
      check("9. Case.category cannot be changed after creation (schema immutable:true)", categoryChangeRejected);

      // Status, by contrast, MUST remain mutable (FA-12.2 will drive
      // real transitions) — confirm the schema permits it structurally.
      const doc2 = await FieldAgentComplianceCase.findById(case1._id);
      doc2.status = FA12_CASE_STATUS.UNDER_REVIEW;
      doc2.version = 1;
      await doc2.save();
      const fresh2 = await FieldAgentComplianceCase.findById(case1._id).lean();
      check("Case.status remains mutable at the schema level (unlike Evidence/AuditEvent)", fresh2.status === FA12_CASE_STATUS.UNDER_REVIEW && fresh2.version === 1);
    }

    // ── 10-11. dedupeKey (sparse unique) + ADMIN_NARRATIVE without it ──
    {
      const dk = `evidence:test:${oid()}`;
      const e1 = await FieldAgentComplianceEvidence.create({
        fieldAgentRef: agent1._id,
        evidenceType: FA12_VIOLATION_CATEGORY.FRAUD_SIGNAL_SUPPORTED_REVIEW,
        sourceType: FA12_EVIDENCE_SOURCE_TYPE.FRAUD_SIGNAL,
        sourceRef: oid(),
        sourceSnapshot: { fraudSignalType: "CROSS_AGENT_SALON_CYCLING", fraudSignalSeverity: "HIGH", asOf: new Date() },
        description: "Cited fraud signal for review.",
        reportedBy: indiaAdmin._id,
        dedupeKey: dk,
      });
      fixtureEvidenceIds.push(e1._id);

      let dupeRejected = false;
      try {
        await FieldAgentComplianceEvidence.create({
          fieldAgentRef: agent1._id,
          evidenceType: FA12_VIOLATION_CATEGORY.FRAUD_SIGNAL_SUPPORTED_REVIEW,
          sourceType: FA12_EVIDENCE_SOURCE_TYPE.FRAUD_SIGNAL,
          description: "Duplicate citation of the same signal.",
          reportedBy: indiaAdmin._id,
          dedupeKey: dk,
        });
      } catch (err) {
        dupeRejected = err.code === 11000;
      }
      check("10. Duplicate dedupeKey rejected with E11000", dupeRejected);

      // 11. Multiple ADMIN_NARRATIVE rows (no dedupeKey at all) must
      // coexist without ever being forced through a fabricated key.
      const n1 = await FieldAgentComplianceEvidence.create({
        fieldAgentRef: agent1._id,
        evidenceType: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        sourceType: FA12_EVIDENCE_SOURCE_TYPE.ADMIN_NARRATIVE,
        description: "First narrative report.",
        reportedBy: indiaAdmin._id,
      });
      const n2 = await FieldAgentComplianceEvidence.create({
        fieldAgentRef: agent1._id,
        evidenceType: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        sourceType: FA12_EVIDENCE_SOURCE_TYPE.ADMIN_NARRATIVE,
        description: "Second, unrelated narrative report.",
        reportedBy: indiaAdmin._id,
      });
      fixtureEvidenceIds.push(n1._id, n2._id);
      check("11. Two ADMIN_NARRATIVE rows with no dedupeKey coexist without conflict", !!n1._id && !!n2._id);
      check("11. Neither ADMIN_NARRATIVE row was forced through a fabricated dedupeKey", n1.dedupeKey === undefined && n2.dedupeKey === undefined);
    }

    // ── 12. ACTIVE-CASE UNIQUENESS FOUNDATION ────────────────────────
    {
      const agent2 = await mkFieldAgent("TERRITORY_PARTNER");
      const c1 = await FieldAgentComplianceCase.create({
        fieldAgentRef: agent2._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(c1._id);

      let secondActiveRejected = false;
      try {
        await FieldAgentComplianceCase.create({
          fieldAgentRef: agent2._id,
          commercialPath: "TERRITORY_PARTNER",
          category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
          openedBy: indiaAdmin._id,
        });
      } catch (err) {
        secondActiveRejected = err.code === 11000;
      }
      check("12. A second ACTIVE case for the same (fieldAgentRef, category) is rejected (E11000)", secondActiveRejected);

      // Once the marker is unset (simulating what FA-12.2's transition
      // service will do on reaching a terminal status), a new case for
      // the same (fieldAgentRef, category) must be creatable again.
      await FieldAgentComplianceCase.collection.updateOne({ _id: c1._id }, { $unset: { activeCaseMarker: "" }, $set: { status: FA12_CASE_STATUS.RESOLVED } });
      const c2 = await FieldAgentComplianceCase.create({
        fieldAgentRef: agent2._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(c2._id);
      check("12. A new case for the same (fieldAgentRef, category) is creatable once the prior one's marker is unset", !!c2._id);

      // A DIFFERENT category for the SAME agent must never be blocked
      // by the first category's own active case.
      const c3 = await FieldAgentComplianceCase.create({
        fieldAgentRef: agent2._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.KYC_ELIGIBILITY_LAPSE,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(c3._id);
      check("12. A different category for the same agent is never blocked by another category's active case", !!c3._id);
    }

    // ── 12-CORRECTION. WARNING_ISSUED/ESCALATED REMAIN ACTIVE ────────
    // Pre-FA-12.2-implementation architecture ruling: WARNING_ISSUED
    // and ESCALATED are NOT terminal — a warned/escalated case is
    // continuing compliance workflow and must keep occupying the
    // one-active-case-per-(fieldAgentRef,category) slot. Only
    // DISMISSED/RESOLVED actually free the slot. This corrects
    // FA-12.1's own original (mistaken) classification.
    {
      check(
        "1. FA12_CASE_ACTIVE_STATUSES contains exactly the 4 corrected active statuses",
        [...FA12_CASE_ACTIVE_STATUSES].sort().join(",") === ["OPEN", "UNDER_REVIEW", "WARNING_ISSUED", "ESCALATED"].sort().join(","),
        FA12_CASE_ACTIVE_STATUSES
      );
      check(
        "2. FA12_CASE_TERMINAL_STATUSES contains exactly DISMISSED/RESOLVED, no more",
        [...FA12_CASE_TERMINAL_STATUSES].sort().join(",") === ["DISMISSED", "RESOLVED"].sort().join(","),
        FA12_CASE_TERMINAL_STATUSES
      );

      // 3/5. WARNING_ISSUED retains activeCaseMarker and still blocks a
      // second active case for the same (fieldAgentRef, category).
      const agentW = await mkFieldAgent("TERRITORY_PARTNER");
      const caseW = await FieldAgentComplianceCase.create({
        fieldAgentRef: agentW._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(caseW._id);
      // Simulate what FA-12.2's transition service will do on reaching
      // WARNING_ISSUED — status changes, marker is left untouched.
      await FieldAgentComplianceCase.collection.updateOne({ _id: caseW._id }, { $set: { status: FA12_CASE_STATUS.WARNING_ISSUED, version: 1 } });
      const caseWFresh = await FieldAgentComplianceCase.findById(caseW._id).lean();
      check("3. A case at WARNING_ISSUED retains activeCaseMarker:true", caseWFresh.status === FA12_CASE_STATUS.WARNING_ISSUED && caseWFresh.activeCaseMarker === true);

      let blockedAtWarning = false;
      try {
        await FieldAgentComplianceCase.create({
          fieldAgentRef: agentW._id,
          commercialPath: "TERRITORY_PARTNER",
          category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
          openedBy: indiaAdmin._id,
        });
      } catch (err) {
        blockedAtWarning = err.code === 11000;
      }
      check("5. A second active case for the same (fieldAgentRef, category) is still rejected while the first sits at WARNING_ISSUED", blockedAtWarning);

      // 4/6. ESCALATED retains activeCaseMarker and still blocks a
      // second active case for the same (fieldAgentRef, category).
      const agentE = await mkFieldAgent("TERRITORY_PARTNER");
      const caseE = await FieldAgentComplianceCase.create({
        fieldAgentRef: agentE._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(caseE._id);
      await FieldAgentComplianceCase.collection.updateOne({ _id: caseE._id }, { $set: { status: FA12_CASE_STATUS.ESCALATED, version: 1 } });
      const caseEFresh = await FieldAgentComplianceCase.findById(caseE._id).lean();
      check("4. A case at ESCALATED retains activeCaseMarker:true", caseEFresh.status === FA12_CASE_STATUS.ESCALATED && caseEFresh.activeCaseMarker === true);

      let blockedAtEscalated = false;
      try {
        await FieldAgentComplianceCase.create({
          fieldAgentRef: agentE._id,
          commercialPath: "TERRITORY_PARTNER",
          category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
          openedBy: indiaAdmin._id,
        });
      } catch (err) {
        blockedAtEscalated = err.code === 11000;
      }
      check("6. A second active case for the same (fieldAgentRef, category) is still rejected while the first sits at ESCALATED", blockedAtEscalated);

      // 7. Only once WARNING_ISSUED/ESCALATED progress to an actual
      // terminal status (DISMISSED/RESOLVED) and the marker is unset
      // does a new case become possible again.
      await FieldAgentComplianceCase.collection.updateOne({ _id: caseW._id }, { $set: { status: FA12_CASE_STATUS.RESOLVED, version: 2 }, $unset: { activeCaseMarker: "" } });
      const caseWTerminal = await FieldAgentComplianceCase.findById(caseW._id).lean();
      check("Terminal-state marker: RESOLVED case has activeCaseMarker absent", caseWTerminal.status === FA12_CASE_STATUS.RESOLVED && caseWTerminal.activeCaseMarker === undefined);

      const caseWNew = await FieldAgentComplianceCase.create({
        fieldAgentRef: agentW._id,
        commercialPath: "TERRITORY_PARTNER",
        category: FA12_VIOLATION_CATEGORY.ADMIN_OBSERVED_POLICY_BREACH,
        openedBy: indiaAdmin._id,
      });
      fixtureCaseIds.push(caseWNew._id);
      check("7. A new case for the same (fieldAgentRef, category) becomes possible only after the prior one reaches a real terminal status (RESOLVED) with marker unset", !!caseWNew._id);
    }

    // ── 13. EXACT INDEX INVENTORY ─────────────────────────────────────
    {
      const evidenceIndexes = await FieldAgentComplianceEvidence.collection.indexes();
      check("13. Evidence has {fieldAgentRef,reportedAt} index", evidenceIndexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,reportedAt"));
      check("13. Evidence has sparse {caseRef} index", evidenceIndexes.some((i) => Object.keys(i.key).join(",") === "caseRef" && i.sparse));
      check("13. Evidence has unique sparse {dedupeKey} index", evidenceIndexes.some((i) => Object.keys(i.key).join(",") === "dedupeKey" && i.unique && i.sparse));
      check("13. Evidence has exactly 4 indexes (_id + 3 approved, no speculative extras)", evidenceIndexes.length === 4, evidenceIndexes.map((i) => i.name));

      const caseIndexes = await FieldAgentComplianceCase.collection.indexes();
      check("13. Case has {fieldAgentRef,status} index", caseIndexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,status"));
      check("13. Case has {fieldAgentRef,createdAt} index", caseIndexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,createdAt"));
      check("13. Case has {status,createdAt} index", caseIndexes.some((i) => Object.keys(i.key).join(",") === "status,createdAt"));
      check(
        "13. Case has the {fieldAgentRef,category} partial-unique active-case index",
        caseIndexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,category" && i.unique && JSON.stringify(i.partialFilterExpression) === JSON.stringify({ activeCaseMarker: { $exists: true } }))
      );
      check("13. Case has exactly 5 indexes (_id + 4 approved, no speculative extras)", caseIndexes.length === 5, caseIndexes.map((i) => i.name));

      const auditIndexes = await FieldAgentComplianceAuditEvent.collection.indexes();
      check("13. AuditEvent has {entityType,entityId,createdAt} index", auditIndexes.some((i) => Object.keys(i.key).join(",") === "entityType,entityId,createdAt"));
      check("13. AuditEvent has exactly 2 indexes (_id + 1 approved, no speculative extras)", auditIndexes.length === 2, auditIndexes.map((i) => i.name));
    }

    // ── 12/13-ADD. TIMESTAMP BEHAVIOR + NO TTL INDEXES ───────────────
    // (spec items 12/13 — not previously asserted explicitly; the
    // models already behave correctly via {timestamps:true} and no
    // `expires`/TTL option anywhere, this just makes it a real check.)
    {
      const evLean = await FieldAgentComplianceEvidence.findById(fixtureEvidenceIds[0]).lean();
      check("12. Evidence.createdAt/updatedAt populated as real Dates on creation", evLean.createdAt instanceof Date && evLean.updatedAt instanceof Date);

      const caseLean = await FieldAgentComplianceCase.findById(case1._id).lean();
      check("12. Case.createdAt/updatedAt populated as real Dates on creation", caseLean.createdAt instanceof Date && caseLean.updatedAt instanceof Date);

      const aeLean = await FieldAgentComplianceAuditEvent.findById(fixtureAuditEventIds[0]).lean();
      check("12. AuditEvent.createdAt populated as a real Date on creation (updatedAt intentionally disabled)", aeLean.createdAt instanceof Date && aeLean.updatedAt === undefined);

      const allIndexesAcrossModels = [
        ...(await FieldAgentComplianceEvidence.collection.indexes()),
        ...(await FieldAgentComplianceCase.collection.indexes()),
        ...(await FieldAgentComplianceAuditEvent.collection.indexes()),
      ];
      check("13. No TTL index exists on any FA-12.1 collection (no expireAfterSeconds anywhere)", allIndexesAcrossModels.every((i) => i.expireAfterSeconds === undefined));
    }

    // ── 14-15. LIFECYCLE / AUDIT-ACTION CONSTANTS ────────────────────
    {
      check("14. FA12_CASE_STATUS has exactly the 6 approved values", Object.values(FA12_CASE_STATUS).sort().join(",") === ["OPEN", "UNDER_REVIEW", "WARNING_ISSUED", "ESCALATED", "DISMISSED", "RESOLVED"].sort().join(","));
      check("14. FA12_CASE_TERMINAL_STATUSES contains exactly DISMISSED/RESOLVED (corrected)", [...FA12_CASE_TERMINAL_STATUSES].sort().join(",") === ["DISMISSED", "RESOLVED"].sort().join(","));
      check("14. FA12_CASE_ACTIVE_STATUSES contains exactly OPEN/UNDER_REVIEW/WARNING_ISSUED/ESCALATED (corrected)", [...FA12_CASE_ACTIVE_STATUSES].sort().join(",") === ["OPEN", "UNDER_REVIEW", "WARNING_ISSUED", "ESCALATED"].sort().join(","));
      check("14. No SUSPENDED/BLOCKED value exists anywhere in FA12_CASE_STATUS (locked)", !Object.values(FA12_CASE_STATUS).some((v) => /SUSPEND|BLOCK/i.test(v)));

      check(
        "15. FA12_AUDIT_ACTION contains exactly the 9 approved actions, no more",
        Object.values(FA12_AUDIT_ACTION).sort().join(",") ===
          ["EVIDENCE_FILED", "EVIDENCE_ATTACHED_TO_CASE", "CASE_OPENED", "CASE_UNDER_REVIEW", "CASE_WARNING_ISSUED", "CASE_ESCALATED", "CASE_DISMISSED", "CASE_RESOLVED", "CASE_REOPENED"].sort().join(",")
      );
      check("15. FA12_AUDIT_ACTOR_TYPE contains only ADMIN", Object.values(FA12_AUDIT_ACTOR_TYPE).join(",") === "ADMIN");

      check(
        "B. Final V1 taxonomy contains exactly the 4 approved categories, no more",
        Object.values(FA12_VIOLATION_CATEGORY).sort().join(",") ===
          ["KYC_ELIGIBILITY_LAPSE", "FRAUD_SIGNAL_SUPPORTED_REVIEW", "ADMIN_OBSERVED_POLICY_BREACH", "TERRITORY_CLAIM_LIFECYCLE_CONCERN"].sort().join(",")
      );
      check(
        "B. Taxonomy excludes all deferred categories (CUSTOMER_COMPLAINT/FINANCIAL_ANOMALY/CONTRACTUAL_BREACH)",
        !Object.values(FA12_VIOLATION_CATEGORY).some((v) => /COMPLAINT|FINANCIAL|CONTRACTUAL/i.test(v))
      );
    }

    // ── 16. NO FORBIDDEN IMPORTS/WRITES ──────────────────────────────
    {
      const fs = await import("node:fs");
      const filesToCheck = [
        "../modules/fieldAgent/models/FieldAgentComplianceEvidence.js",
        "../modules/fieldAgent/models/FieldAgentComplianceCase.js",
        "../modules/fieldAgent/models/FieldAgentComplianceAuditEvent.js",
        "../modules/fieldAgent/constants/compliance.constants.js",
      ];
      const forbiddenImportPatterns = [
        "models/User.js\"", // FA-12.1 files must not import User for writing (refs are bare ObjectId, not model imports)
        "FieldAgentEarningLedger",
        "AcquisitionEarningProgress",
        "FieldAgentEarningPolicyGap",
        "TerritoryAssignment.js",
        "AcquisitionClaim.js",
        "Booking.js",
        "WalletLedger",
        "FieldAgentPerformanceSnapshot",
        "PerformancePolicyVersion",
        "SupportTicket",
      ];
      let anyForbidden = false;
      const hits = [];
      for (const rel of filesToCheck) {
        const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
        // Scan only actual `import ... from "..."` statement lines —
        // not comment prose (which legitimately names these models to
        // document what must NEVER be imported).
        const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
        for (const pattern of forbiddenImportPatterns) {
          if (importLines.some((line) => line.includes(pattern))) {
            anyForbidden = true;
            hits.push(`${rel}: ${pattern}`);
          }
        }
      }
      check("16. No FA-12.1 file imports any frozen financial/business model", !anyForbidden, hits);

      // Confirm no controller/route/service file exists yet — FA-12.1
      // is domain foundation only.
      const noControllerYet = !fs.existsSync(new URL("../modules/fieldAgent/controllers/adminFieldAgentCompliance.controller.js", import.meta.url));
      const noServiceYet = !fs.existsSync(new URL("../modules/fieldAgent/services/fieldAgentCompliance.service.js", import.meta.url));
      check("16. No admin controller exists yet (correctly deferred to FA-12.2/12.3)", noControllerYet);
      check("16. No service-layer file exists yet (correctly deferred to FA-12.2)", noServiceYet);
    }
  } finally {
    // ── CLEANUP (explicit ID lists only — never a broad delete) ──────
    await FieldAgentComplianceAuditEvent.collection.deleteMany({ _id: { $in: fixtureAuditEventIds } });
    await FieldAgentComplianceCase.collection.deleteMany({ _id: { $in: fixtureCaseIds } });
    await FieldAgentComplianceEvidence.collection.deleteMany({ _id: { $in: fixtureEvidenceIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });

    const residue = {
      evidence: await FieldAgentComplianceEvidence.countDocuments({ _id: { $in: fixtureEvidenceIds } }),
      cases: await FieldAgentComplianceCase.countDocuments({ _id: { $in: fixtureCaseIds } }),
      auditEvents: await FieldAgentComplianceAuditEvent.countDocuments({ _id: { $in: fixtureAuditEventIds } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
    };
    const zeroResidue = Object.values(residue).every((n) => n === 0);
    check("18. Zero residue — all FA-12.1 fixtures removed", zeroResidue, residue);
  }

  // ── 17. PRODUCTION BOUNDARY (captured AFTER cleanup) ──────────────
  {
    const after = {
      evidence: await FieldAgentComplianceEvidence.countDocuments(),
      cases: await FieldAgentComplianceCase.countDocuments(),
      auditEvents: await FieldAgentComplianceAuditEvent.countDocuments(),
      ledger: await FieldAgentEarningLedger.countDocuments(),
      gaps: await FieldAgentEarningPolicyGap.countDocuments(),
      checkpoint: await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean(),
      progress: await AcquisitionEarningProgress.countDocuments(),
      termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments(),
      claims: await AcquisitionClaim.countDocuments(),
      assignments: await TerritoryAssignment.countDocuments(),
      publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
      perfSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
    };
    check("17. No real FieldAgentComplianceEvidence remains", after.evidence === 0, after.evidence);
    check("17. No real FieldAgentComplianceCase remains", after.cases === 0, after.cases);
    check("17. No real FieldAgentComplianceAuditEvent remains", after.auditEvents === 0, after.auditEvents);
    check("17. FieldAgentEarningLedger unchanged", after.ledger === before.ledger, { before: before.ledger, after: after.ledger });
    check("17. FieldAgentEarningPolicyGap unchanged", after.gaps === before.gaps, { before: before.gaps, after: after.gaps });
    check(
      "17. FA-9 earning checkpoint unchanged",
      before.checkpoint?.lastCompletedAt?.toISOString() === after.checkpoint?.lastCompletedAt?.toISOString() &&
        String(before.checkpoint?.lastId) === String(after.checkpoint?.lastId)
    );
    check("17. AcquisitionEarningProgress unchanged", after.progress === before.progress);
    check("17. TerritoryPartnerTermSnapshot unchanged", after.termSnapshots === before.termSnapshots);
    check("17. AcquisitionClaim count unchanged", after.claims === before.claims, { before: before.claims, after: after.claims });
    check("17. TerritoryAssignment count unchanged", after.assignments === before.assignments, { before: before.assignments, after: after.assignments });
    check("17. No real published PerformancePolicyVersion left behind", after.publishedPolicies === 0, after.publishedPolicies);
    check("17. No real FieldAgentPerformanceSnapshot left behind", after.perfSnapshots === 0, after.perfSnapshots);
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);
  await mongoose.connection.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ FA-12.1 verification body threw:", err);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
