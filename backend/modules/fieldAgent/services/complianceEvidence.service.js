/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/complianceEvidence.service.js
 *
 * FA-12.2 — evidence filing operations that do NOT create a case:
 * standalone evidence (never associated with any case in V1), and
 * additional evidence for an ALREADY-EXISTING, ACTIVE case (caseRef
 * supplied AT CREATION TIME — see file header of
 * FieldAgentComplianceEvidence.js and this phase's own architecture
 * ruling). There is no retroactive attachment path anywhere in this
 * file, and none is ever added: `caseRef` is set exactly once, when
 * the document is created, never afterward.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentComplianceCase from "../models/FieldAgentComplianceCase.js";
import FieldAgentComplianceEvidence from "../models/FieldAgentComplianceEvidence.js";
import FieldAgentComplianceAuditEvent from "../models/FieldAgentComplianceAuditEvent.js";
import {
  FA12_VIOLATION_CATEGORY,
  FA12_EVIDENCE_SOURCE_TYPE,
  FA12_CASE_ACTIVE_STATUSES,
  FA12_AUDIT_ENTITY_TYPE,
  FA12_AUDIT_ACTOR_TYPE,
  FA12_AUDIT_ACTION,
} from "../constants/compliance.constants.js";
import { canAdminActOnFieldAgent, resolveStateAdminAuthorizedFieldAgentIds } from "./complianceAuthorization.service.js";

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const validateEvidenceShape = ({ evidenceType, sourceType }) => {
  if (!Object.values(FA12_VIOLATION_CATEGORY).includes(evidenceType)) {
    throw Errors.badRequest(`evidenceType must be one of: ${Object.values(FA12_VIOLATION_CATEGORY).join(", ")}`);
  }
  if (!Object.values(FA12_EVIDENCE_SOURCE_TYPE).includes(sourceType)) {
    throw Errors.badRequest(`sourceType must be one of: ${Object.values(FA12_EVIDENCE_SOURCE_TYPE).join(", ")}`);
  }
};

export const toEvidenceDTO = (e) => ({
  id: e._id,
  fieldAgentRef: e.fieldAgentRef,
  evidenceType: e.evidenceType,
  sourceType: e.sourceType,
  sourceRef: e.sourceRef,
  sourceSnapshot: e.sourceSnapshot,
  description: e.description,
  reportedBy: e.reportedBy,
  reportedAt: e.reportedAt,
  caseRef: e.caseRef ?? null,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

// ─── STANDALONE EVIDENCE ──────────────────────────────────────────────
export const fileStandaloneEvidence = async ({ admin, fieldAgentId, evidenceType, sourceType, sourceRef, sourceSnapshot, description, dedupeKey }) => {
  validateEvidenceShape({ evidenceType, sourceType });

  const fieldAgent = await FieldAgent.findById(fieldAgentId).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");
  const authorized = await canAdminActOnFieldAgent({ admin, fieldAgent });
  if (!authorized) throw Errors.forbidden("Not authorized to file compliance evidence for this Field Agent");

  try {
    const evidence = await FieldAgentComplianceEvidence.create({
      fieldAgentRef: fieldAgent._id,
      evidenceType,
      sourceType,
      sourceRef: sourceRef ?? null,
      sourceSnapshot: sourceSnapshot ?? {},
      description,
      reportedBy: admin._id,
      ...(dedupeKey ? { dedupeKey } : {}),
    });

    await FieldAgentComplianceAuditEvent.create({
      entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_EVIDENCE,
      entityId: evidence._id,
      actorRef: admin._id,
      actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
      action: FA12_AUDIT_ACTION.EVIDENCE_FILED,
      newValue: { evidenceType, sourceType },
    });

    return evidence;
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.dedupeKey) {
      // Deterministic duplicate — idempotent recovery, never a second
      // row for the identical cited fact. No new audit event either,
      // since nothing new actually happened.
      return FieldAgentComplianceEvidence.findOne({ dedupeKey });
    }
    throw err;
  }
};

// ─── B. ADDITIONAL EVIDENCE FOR AN EXISTING, ACTIVE CASE ─────────────
// caseRef is supplied HERE, at creation — never mutated onto an
// existing evidence row afterward (see file header).
export const fileEvidenceForCase = async ({ admin, caseId, evidenceType, sourceType, sourceRef, sourceSnapshot, description, dedupeKey }) => {
  validateEvidenceShape({ evidenceType, sourceType });

  const kase = await FieldAgentComplianceCase.findById(caseId).lean();
  if (!kase) throw Errors.notFound("Compliance case not found");

  const fieldAgent = await FieldAgent.findById(kase.fieldAgentRef).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");
  const authorized = await canAdminActOnFieldAgent({ admin, fieldAgent });
  if (!authorized) throw Errors.forbidden("Not authorized to file compliance evidence for this Field Agent");

  if (!FA12_CASE_ACTIVE_STATUSES.includes(kase.status)) {
    throw Errors.conflict(`Case status is ${kase.status} — evidence can only be added to an active case (reopen it first if terminal)`);
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      let evidence;
      try {
        const created = await FieldAgentComplianceEvidence.create(
          [
            {
              fieldAgentRef: fieldAgent._id,
              evidenceType,
              sourceType,
              sourceRef: sourceRef ?? null,
              sourceSnapshot: sourceSnapshot ?? {},
              description,
              reportedBy: admin._id,
              caseRef: kase._id,
              ...(dedupeKey ? { dedupeKey } : {}),
            },
          ],
          { session }
        );
        evidence = created[0];
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.dedupeKey) {
          // Idempotent recovery — abort this attempt's transaction
          // (nothing else was written yet) and return the existing row.
          await session.abortTransaction();
          session.endSession();
          return FieldAgentComplianceEvidence.findOne({ dedupeKey });
        }
        throw err;
      }

      await FieldAgentComplianceAuditEvent.create(
        [
          {
            entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_EVIDENCE,
            entityId: evidence._id,
            actorRef: admin._id,
            actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
            action: FA12_AUDIT_ACTION.EVIDENCE_ATTACHED_TO_CASE,
            newValue: { evidenceType, caseRef: kase._id },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return evidence;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < 5 - 1) continue;
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── READ: LIST EVIDENCE ─────────────────────────────────────────────
const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

export const adminListComplianceEvidence = async ({ admin, page = 1, limit = DEFAULT_LIST_LIMIT, fieldAgentRef, caseRef }) => {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);

  const query = {};
  if (caseRef) query.caseRef = caseRef;

  if (admin.adminLevel === "INDIA") {
    if (fieldAgentRef) query.fieldAgentRef = fieldAgentRef;
  } else if (admin.adminLevel === "STATE") {
    const authorizedIds = await resolveStateAdminAuthorizedFieldAgentIds(admin.stateRef);
    if (fieldAgentRef) {
      const allowed = authorizedIds.some((id) => String(id) === String(fieldAgentRef));
      query.fieldAgentRef = allowed ? fieldAgentRef : null;
    } else {
      query.fieldAgentRef = { $in: authorizedIds };
    }
  } else {
    throw Errors.forbidden("Not authorized to list compliance evidence");
  }

  const [items, total] = await Promise.all([
    FieldAgentComplianceEvidence.find(query)
      .sort({ reportedAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    FieldAgentComplianceEvidence.countDocuments(query),
  ]);

  return { items: items.map(toEvidenceDTO), page: safePage, limit: safeLimit, total };
};
