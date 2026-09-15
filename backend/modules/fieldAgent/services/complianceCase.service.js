/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/complianceCase.service.js
 *
 * FA-12.2 — the compliance CASE lifecycle: atomic founding-evidence +
 * case creation, explicit version-checked transitions, and the
 * INDIA_ADMIN-only reopen operation. Built entirely on top of the
 * frozen FA-12.1 domain foundation (FieldAgentComplianceCase,
 * FieldAgentComplianceEvidence, FieldAgentComplianceAuditEvent) —
 * no schema/index/immutability change.
 *
 * CASE MUST NEVER EXIST WITHOUT FOUNDING EVIDENCE — enforced by
 * creating both inside ONE transaction (openCaseWithFoundingEvidence):
 * the case commits only if its founding evidence also commits, and
 * vice versa. There is no other case-creation path in this file.
 *
 * ACTIVE/TERMINAL CLASSIFICATION (locked, corrected pre-FA-12.2):
 * ACTIVE = OPEN/UNDER_REVIEW/WARNING_ISSUED/ESCALATED (activeCaseMarker
 * present); TERMINAL = DISMISSED/RESOLVED (activeCaseMarker absent).
 * Every transition below sets/unsets the marker according to this
 * exact classification, imported from the frozen constants — never a
 * locally hard-coded status list.
 *
 * TRANSITION MATRIX (locked V1, explicit — never arbitrary):
 *   OPEN          -> UNDER_REVIEW, DISMISSED, RESOLVED
 *   UNDER_REVIEW  -> WARNING_ISSUED, ESCALATED, DISMISSED, RESOLVED
 *   WARNING_ISSUED-> UNDER_REVIEW, ESCALATED, RESOLVED
 *   ESCALATED     -> UNDER_REVIEW, WARNING_ISSUED, RESOLVED
 *   DISMISSED/RESOLVED -> (none — only reachable via reopenCase)
 *
 * DECISION RECORDING (this phase's own design choice, not explicitly
 * pinned by the instruction — flagged in the FA-12.2 deliverable
 * report for audit): a `decision` payload is REQUIRED for every
 * transition target except UNDER_REVIEW (which merely means "still
 * being looked at, no verdict yet") and OPTIONAL for UNDER_REVIEW.
 * `reason` (<=500 chars, becomes the audit event's own reason) is
 * REQUIRED on every transition and on reopen, unconditionally.
 *
 * CONCURRENCY: every transition and the reopen operation use ONE
 * atomic `findOneAndUpdate({_id, status: expectedStatus, version:
 * expectedVersion}, ...)` as the sole concurrency guard — never a
 * read-modify-save round trip — mirroring the exact
 * AcquisitionClaim#endClaim / #cancelReferral idiom this module
 * already established. A stale expected version/status matches zero
 * documents, returns null, and is treated as a clean 409 conflict; no
 * partial write, no audit event, no case mutation ever happens on the
 * losing side of a race.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentComplianceCase from "../models/FieldAgentComplianceCase.js";
import FieldAgentComplianceEvidence from "../models/FieldAgentComplianceEvidence.js";
import FieldAgentComplianceAuditEvent from "../models/FieldAgentComplianceAuditEvent.js";
import {
  FA12_VIOLATION_CATEGORY,
  FA12_CASE_STATUS,
  FA12_CASE_ACTIVE_STATUSES,
  FA12_CASE_TERMINAL_STATUSES,
  FA12_AUDIT_ENTITY_TYPE,
  FA12_AUDIT_ACTOR_TYPE,
  FA12_AUDIT_ACTION,
  EVIDENCE_DESCRIPTION_MAX_LENGTH,
} from "../constants/compliance.constants.js";
import { canAdminActOnFieldAgent, resolveStateAdminAuthorizedFieldAgentIds, assertAdminHasDecisionAuthority } from "./complianceAuthorization.service.js";

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const MAX_ATTEMPTS = 5;

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const isDuplicateActiveCase = (err) =>
  err.code === 11000 && err.keyPattern?.fieldAgentRef && err.keyPattern?.category;

// ─── TRANSITION MATRIX (explicit, locked V1) ────────────────────────
const VALID_CASE_TRANSITIONS = Object.freeze({
  [FA12_CASE_STATUS.OPEN]: [FA12_CASE_STATUS.UNDER_REVIEW, FA12_CASE_STATUS.DISMISSED, FA12_CASE_STATUS.RESOLVED],
  [FA12_CASE_STATUS.UNDER_REVIEW]: [
    FA12_CASE_STATUS.WARNING_ISSUED,
    FA12_CASE_STATUS.ESCALATED,
    FA12_CASE_STATUS.DISMISSED,
    FA12_CASE_STATUS.RESOLVED,
  ],
  [FA12_CASE_STATUS.WARNING_ISSUED]: [FA12_CASE_STATUS.UNDER_REVIEW, FA12_CASE_STATUS.ESCALATED, FA12_CASE_STATUS.RESOLVED],
  [FA12_CASE_STATUS.ESCALATED]: [FA12_CASE_STATUS.UNDER_REVIEW, FA12_CASE_STATUS.WARNING_ISSUED, FA12_CASE_STATUS.RESOLVED],
  [FA12_CASE_STATUS.DISMISSED]: [],
  [FA12_CASE_STATUS.RESOLVED]: [],
});

const TRANSITION_AUDIT_ACTION = Object.freeze({
  [FA12_CASE_STATUS.UNDER_REVIEW]: FA12_AUDIT_ACTION.CASE_UNDER_REVIEW,
  [FA12_CASE_STATUS.WARNING_ISSUED]: FA12_AUDIT_ACTION.CASE_WARNING_ISSUED,
  [FA12_CASE_STATUS.ESCALATED]: FA12_AUDIT_ACTION.CASE_ESCALATED,
  [FA12_CASE_STATUS.DISMISSED]: FA12_AUDIT_ACTION.CASE_DISMISSED,
  [FA12_CASE_STATUS.RESOLVED]: FA12_AUDIT_ACTION.CASE_RESOLVED,
});

export const VALID_CASE_TRANSITIONS_MAP = VALID_CASE_TRANSITIONS; // exported read-only for tests/introspection

// ─── A. ATOMIC FOUNDING EVIDENCE + CASE CREATION ────────────────────
export const openCaseWithFoundingEvidence = async ({ admin, fieldAgentId, category, evidence }) => {
  if (!Object.values(FA12_VIOLATION_CATEGORY).includes(category)) {
    throw Errors.badRequest(`category must be one of: ${Object.values(FA12_VIOLATION_CATEGORY).join(", ")}`);
  }

  const fieldAgent = await FieldAgent.findById(fieldAgentId).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");
  const authorized = await canAdminActOnFieldAgent({ admin, fieldAgent });
  if (!authorized) throw Errors.forbidden("Not authorized to open a compliance case for this Field Agent");

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const createdCases = await FieldAgentComplianceCase.create(
        [
          {
            fieldAgentRef: fieldAgent._id,
            commercialPath: fieldAgent.commercialPath,
            category,
            status: FA12_CASE_STATUS.OPEN,
            openedBy: admin._id,
          },
        ],
        { session }
      );
      const kase = createdCases[0];

      const createdEvidence = await FieldAgentComplianceEvidence.create(
        [
          {
            fieldAgentRef: fieldAgent._id,
            evidenceType: category,
            sourceType: evidence.sourceType,
            sourceRef: evidence.sourceRef ?? null,
            sourceSnapshot: evidence.sourceSnapshot ?? {},
            description: evidence.description,
            reportedBy: admin._id,
            caseRef: kase._id,
            ...(evidence.dedupeKey ? { dedupeKey: evidence.dedupeKey } : {}),
          },
        ],
        { session }
      );
      const foundingEvidence = createdEvidence[0];

      await FieldAgentComplianceAuditEvent.create(
        [
          {
            entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_EVIDENCE,
            entityId: foundingEvidence._id,
            actorRef: admin._id,
            actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
            action: FA12_AUDIT_ACTION.EVIDENCE_FILED,
            newValue: { evidenceType: category, caseRef: kase._id },
          },
          {
            entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_CASE,
            entityId: kase._id,
            actorRef: admin._id,
            actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
            action: FA12_AUDIT_ACTION.CASE_OPENED,
            newValue: { category, foundingEvidenceRef: foundingEvidence._id },
          },
        ],
        { session, ordered: true }
      );

      await session.commitTransaction();
      return { case: kase, foundingEvidence };
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isDuplicateActiveCase(err)) {
        throw Errors.conflict("An active compliance case already exists for this Field Agent and category");
      }
      if (isTransientConflict(err) && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── C. CASE TRANSITIONS ─────────────────────────────────────────────
export const transitionCase = async ({ admin, caseId, expectedVersion, toStatus, reason, decision }) => {
  assertAdminHasDecisionAuthority(admin, Errors);

  if (!Object.values(FA12_CASE_STATUS).includes(toStatus)) {
    throw Errors.badRequest(`toStatus must be one of: ${Object.values(FA12_CASE_STATUS).join(", ")}`);
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw Errors.badRequest("A transition reason is required");
  }
  if (toStatus !== FA12_CASE_STATUS.UNDER_REVIEW && !decision) {
    throw Errors.badRequest(`A decision is required when transitioning to ${toStatus}`);
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Re-read live state inside this transaction's own snapshot —
      // never trust a value read before the loop started.
      const current = await FieldAgentComplianceCase.findById(caseId).session(session);
      if (!current) throw Errors.notFound("Compliance case not found");

      if (current.version !== expectedVersion) {
        throw Errors.conflict(`Stale version: expected ${expectedVersion}, case is now at version ${current.version}`);
      }
      const allowedTargets = VALID_CASE_TRANSITIONS[current.status] || [];
      if (!allowedTargets.includes(toStatus)) {
        throw Errors.conflict(`Cannot transition from ${current.status} to ${toStatus}`);
      }

      const isTerminalTarget = FA12_CASE_TERMINAL_STATUSES.includes(toStatus);
      const setFields = { status: toStatus, version: expectedVersion + 1 };
      if (!isTerminalTarget) setFields.activeCaseMarker = true;
      if (decision) {
        setFields.decision = {
          outcome: decision.outcome,
          reasoning: decision.reasoning,
          decidedBy: admin._id,
          decidedAt: new Date(),
        };
      }
      const updateDoc = isTerminalTarget ? { $set: setFields, $unset: { activeCaseMarker: "" } } : { $set: setFields };

      const updated = await FieldAgentComplianceCase.findOneAndUpdate(
        { _id: caseId, status: current.status, version: expectedVersion },
        updateDoc,
        { new: true, session }
      );
      if (!updated) {
        // Lost a concurrent race between the read above and this
        // conditional update — clean conflict, no partial write.
        throw Errors.conflict("Case was modified concurrently — retry with the latest version");
      }

      await FieldAgentComplianceAuditEvent.create(
        [
          {
            entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_CASE,
            entityId: updated._id,
            actorRef: admin._id,
            actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
            action: TRANSITION_AUDIT_ACTION[toStatus],
            oldValue: { status: current.status, version: current.version },
            newValue: { status: updated.status, version: updated.version },
            reason: reason.trim(),
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return updated;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── D. REOPEN (INDIA_ADMIN-only, terminal cases only) ──────────────
export const reopenCase = async ({ admin, caseId, reason }) => {
  assertAdminHasDecisionAuthority(admin, Errors);

  if (typeof reason !== "string" || !reason.trim()) {
    throw Errors.badRequest("A reopen reason is required");
  }
  const trimmedReason = reason.trim();

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const current = await FieldAgentComplianceCase.findById(caseId).session(session);
      if (!current) throw Errors.notFound("Compliance case not found");
      if (!FA12_CASE_TERMINAL_STATUSES.includes(current.status)) {
        throw Errors.conflict(`Only a terminal case (DISMISSED/RESOLVED) can be reopened — current status is ${current.status}`);
      }

      // The guard on activeCaseMarker being absent closes the same
      // TOCTOU window every other transition closes via {status,version}
      // — here we additionally guard on activeCaseMarker explicitly
      // absent, since a reopen's whole purpose is to (re-)establish it.
      const updated = await FieldAgentComplianceCase.findOneAndUpdate(
        { _id: caseId, status: current.status, version: current.version, activeCaseMarker: { $exists: false } },
        {
          $set: { status: FA12_CASE_STATUS.UNDER_REVIEW, version: current.version + 1, activeCaseMarker: true },
          $push: { reopenedHistory: { reopenedBy: admin._id, reopenedAt: new Date(), reason: trimmedReason } },
        },
        { new: true, session }
      );
      if (!updated) {
        throw Errors.conflict("Case was modified concurrently — it may have already been reopened");
      }

      await FieldAgentComplianceAuditEvent.create(
        [
          {
            entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_CASE,
            entityId: updated._id,
            actorRef: admin._id,
            actorType: FA12_AUDIT_ACTOR_TYPE.ADMIN,
            action: FA12_AUDIT_ACTION.CASE_REOPENED,
            oldValue: { status: current.status, version: current.version },
            newValue: { status: updated.status, version: updated.version },
            reason: trimmedReason,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return updated;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isDuplicateActiveCase(err)) {
        // Another active case for the same (fieldAgentRef,category)
        // now exists — reopening would violate the frozen partial
        // unique index. Fail safely; the terminal case stays terminal,
        // the newer active case is completely untouched.
        throw Errors.conflict("Cannot reopen — another active compliance case already exists for this Field Agent and category");
      }
      if (isTransientConflict(err) && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── READ: LIST / DETAIL ─────────────────────────────────────────────
const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

export const toCaseDTO = (kase) => ({
  id: kase._id,
  fieldAgentRef: kase.fieldAgentRef,
  commercialPath: kase.commercialPath,
  category: kase.category,
  status: kase.status,
  openedBy: kase.openedBy,
  openedAt: kase.openedAt,
  assignedAdminRef: kase.assignedAdminRef,
  decision: kase.decision
    ? { outcome: kase.decision.outcome, reasoning: kase.decision.reasoning, decidedBy: kase.decision.decidedBy, decidedAt: kase.decision.decidedAt }
    : null,
  version: kase.version,
  reopenedHistory: (kase.reopenedHistory || []).map((h) => ({ reopenedBy: h.reopenedBy, reopenedAt: h.reopenedAt, reason: h.reason })),
  createdAt: kase.createdAt,
  updatedAt: kase.updatedAt,
});

// Admin case LIST — allowlisted filters only (fieldAgentRef, category,
// status), deterministic sort, bounded pagination. STATE_ADMIN is
// transparently restricted to their own authorized fieldAgent set —
// never a client-supplied state/district filter.
export const adminListComplianceCases = async ({ admin, page = 1, limit = DEFAULT_LIST_LIMIT, fieldAgentRef, category, status }) => {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);

  const query = {};
  if (category) query.category = category;
  if (status) query.status = status;

  if (admin.adminLevel === "INDIA") {
    if (fieldAgentRef) query.fieldAgentRef = fieldAgentRef;
  } else if (admin.adminLevel === "STATE") {
    const authorizedIds = await resolveStateAdminAuthorizedFieldAgentIds(admin.stateRef);
    if (fieldAgentRef) {
      const allowed = authorizedIds.some((id) => String(id) === String(fieldAgentRef));
      query.fieldAgentRef = allowed ? fieldAgentRef : null; // null id matches nothing — IDOR-safe, not a silent bypass
    } else {
      query.fieldAgentRef = { $in: authorizedIds };
    }
  } else {
    throw Errors.forbidden("Not authorized to list compliance cases");
  }

  const [items, total] = await Promise.all([
    FieldAgentComplianceCase.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    FieldAgentComplianceCase.countDocuments(query),
  ]);

  return { items: items.map(toCaseDTO), page: safePage, limit: safeLimit, total };
};

export const adminGetComplianceCaseDetail = async ({ admin, caseId }) => {
  const kase = await FieldAgentComplianceCase.findById(caseId).lean();
  if (!kase) throw Errors.notFound("Compliance case not found");

  const fieldAgent = await FieldAgent.findById(kase.fieldAgentRef).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");
  const authorized = await canAdminActOnFieldAgent({ admin, fieldAgent });
  if (!authorized) throw Errors.forbidden("Not authorized for this compliance case");

  const [evidence, auditHistory] = await Promise.all([
    FieldAgentComplianceEvidence.find({ caseRef: kase._id }).sort({ reportedAt: 1 }).lean(),
    FieldAgentComplianceAuditEvent.find({ entityType: FA12_AUDIT_ENTITY_TYPE.FIELD_AGENT_COMPLIANCE_CASE, entityId: kase._id })
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  return {
    case: toCaseDTO(kase),
    fieldAgent: { id: fieldAgent._id, agentCode: fieldAgent.agentCode, commercialPath: fieldAgent.commercialPath },
    evidence: evidence.map((e) => ({
      id: e._id,
      evidenceType: e.evidenceType,
      sourceType: e.sourceType,
      sourceRef: e.sourceRef,
      sourceSnapshot: e.sourceSnapshot,
      description: e.description,
      reportedBy: e.reportedBy,
      reportedAt: e.reportedAt,
    })),
    auditHistory: auditHistory.map((a) => ({
      id: a._id,
      action: a.action,
      actorRef: a.actorRef,
      oldValue: a.oldValue,
      newValue: a.newValue,
      reason: a.reason,
      createdAt: a.createdAt,
    })),
  };
};
