/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentCompliance.validator.js
 *
 * FA-12.2 — admin compliance API validation. Same Joi conventions as
 * every other admin validator in this module: shared `objectId`
 * primitive, `.unknown(false)`, explicit `.forbidden()` on every
 * server-controlled field so this project's `stripUnknown:true` Joi
 * config can't silently swallow a client's attempt to inject one.
 */

import Joi from "joi";
import {
  FA12_VIOLATION_CATEGORY,
  FA12_EVIDENCE_SOURCE_TYPE,
  FA12_CASE_STATUS,
  FA12_CASE_DECISION_OUTCOME,
  EVIDENCE_DESCRIPTION_MAX_LENGTH,
} from "../constants/compliance.constants.js";

const objectId = Joi.string().hex().length(24);

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const DECISION_REASONING_MAX_LENGTH = 2000;
const REOPEN_REASON_MAX_LENGTH = 1000;
const TRANSITION_REASON_MAX_LENGTH = 500;

const forbiddenServerControlledFields = {
  status: Joi.any().forbidden(),
  version: Joi.any().forbidden(),
  activeCaseMarker: Joi.any().forbidden(),
  openedBy: Joi.any().forbidden(),
  openedAt: Joi.any().forbidden(),
  reportedBy: Joi.any().forbidden(),
  reportedAt: Joi.any().forbidden(),
  fieldAgentRef: Joi.any().forbidden(), // always taken from the URL param, never the body
  commercialPath: Joi.any().forbidden(), // always denormalized server-side from FieldAgent
  reopenedHistory: Joi.any().forbidden(),
  decidedBy: Joi.any().forbidden(),
  decidedAt: Joi.any().forbidden(),
};

// Explicitly bounded, whitelisted — mirrors the frozen
// sourceSnapshotSchema field-for-field so a client cannot inject an
// arbitrary key that the schema would otherwise silently drop.
const sourceSnapshotSchema = Joi.object({
  fraudSignalType: Joi.string().trim().max(100).allow(null),
  fraudSignalSeverity: Joi.string().trim().max(100).allow(null),
  kycStatus: Joi.string().trim().max(100).allow(null),
  territoryAssignmentStatus: Joi.string().trim().max(100).allow(null),
  territoryAssignmentEndReason: Joi.string().trim().max(100).allow(null),
  acquisitionClaimStatus: Joi.string().trim().max(100).allow(null),
  acquisitionClaimEndedReason: Joi.string().trim().max(100).allow(null),
  asOf: Joi.date().allow(null),
}).unknown(false);

const evidenceCoreFields = {
  evidenceType: Joi.string()
    .valid(...Object.values(FA12_VIOLATION_CATEGORY))
    .required(),
  sourceType: Joi.string()
    .valid(...Object.values(FA12_EVIDENCE_SOURCE_TYPE))
    .required(),
  sourceRef: objectId.allow(null).optional(),
  sourceSnapshot: sourceSnapshotSchema.optional(),
  description: Joi.string().trim().min(1).max(EVIDENCE_DESCRIPTION_MAX_LENGTH).required(),
  dedupeKey: Joi.string().trim().min(1).max(200).optional(),
};

// For the nested `evidence` object on openCaseBody ONLY: no
// `evidenceType` field — the founding evidence's evidenceType is
// always derived server-side from the case's own top-level
// `category` (openCaseWithFoundingEvidence sets it explicitly), never
// independently client-suppliable, so a client-sent value here would
// be silently ignored at best or confusingly mismatched at worst.
const foundingEvidenceFields = {
  sourceType: evidenceCoreFields.sourceType,
  sourceRef: evidenceCoreFields.sourceRef,
  sourceSnapshot: evidenceCoreFields.sourceSnapshot,
  description: evidenceCoreFields.description,
  dedupeKey: evidenceCoreFields.dedupeKey,
  evidenceType: Joi.any().forbidden(),
};

const decisionSchema = Joi.object({
  outcome: Joi.string()
    .valid(...Object.values(FA12_CASE_DECISION_OUTCOME))
    .required(),
  reasoning: Joi.string().trim().min(1).max(DECISION_REASONING_MAX_LENGTH).required(),
}).unknown(false);

export const adminFieldAgentComplianceSchemas = {
  fieldAgentIdParam: Joi.object({ fieldAgentId: objectId.required() }).unknown(false),
  caseIdParam: Joi.object({ caseId: objectId.required() }).unknown(false),

  casesListQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    fieldAgentRef: objectId.optional(),
    category: Joi.string()
      .valid(...Object.values(FA12_VIOLATION_CATEGORY))
      .optional(),
    status: Joi.string()
      .valid(...Object.values(FA12_CASE_STATUS))
      .optional(),
  }).unknown(false),

  evidenceListQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    fieldAgentRef: objectId.optional(),
    caseRef: objectId.optional(),
  }).unknown(false),

  fileStandaloneEvidenceBody: Joi.object({
    fieldAgentId: objectId.required(),
    ...evidenceCoreFields,
    ...forbiddenServerControlledFields,
  }).unknown(false),

  openCaseBody: Joi.object({
    fieldAgentId: objectId.required(),
    category: Joi.string()
      .valid(...Object.values(FA12_VIOLATION_CATEGORY))
      .required(),
    evidence: Joi.object({ ...foundingEvidenceFields }).unknown(false).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  fileEvidenceForCaseBody: Joi.object({
    ...evidenceCoreFields,
    ...forbiddenServerControlledFields,
  }).unknown(false),

  transitionCaseBody: Joi.object({
    expectedVersion: Joi.number().integer().min(0).required(),
    toStatus: Joi.string()
      .valid(...Object.values(FA12_CASE_STATUS))
      .required(),
    reason: Joi.string().trim().min(1).max(TRANSITION_REASON_MAX_LENGTH).required(),
    decision: decisionSchema.optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  reopenCaseBody: Joi.object({
    reason: Joi.string().trim().min(1).max(REOPEN_REASON_MAX_LENGTH).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),
};
