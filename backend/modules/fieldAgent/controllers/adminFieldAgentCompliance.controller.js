/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentCompliance.controller.js
 *
 * FA-12.2 — thin admin controllers only. `admin` is always req.user
 * (server-populated by protect middleware — never client input), same
 * convention as every other admin controller in this module.
 */

import { successResponse } from "../../../utils/response.js";
import { adminListComplianceEvidence, fileStandaloneEvidence, fileEvidenceForCase } from "../services/complianceEvidence.service.js";
import {
  openCaseWithFoundingEvidence,
  transitionCase,
  reopenCase,
  adminListComplianceCases,
  adminGetComplianceCaseDetail,
  toCaseDTO,
} from "../services/complianceCase.service.js";
import { toEvidenceDTO } from "../services/complianceEvidence.service.js";

export const listComplianceCasesHandler = async (req, res, next) => {
  try {
    const result = await adminListComplianceCases({
      admin: req.user,
      page: req.query.page,
      limit: req.query.limit,
      fieldAgentRef: req.query.fieldAgentRef,
      category: req.query.category,
      status: req.query.status,
    });
    return successResponse(res, {
      message: "Compliance cases fetched",
      data: { cases: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const getComplianceCaseDetailHandler = async (req, res, next) => {
  try {
    const detail = await adminGetComplianceCaseDetail({ admin: req.user, caseId: req.params.caseId });
    return successResponse(res, { message: "Compliance case detail fetched", data: detail });
  } catch (err) {
    return next(err);
  }
};

export const listComplianceEvidenceHandler = async (req, res, next) => {
  try {
    const result = await adminListComplianceEvidence({
      admin: req.user,
      page: req.query.page,
      limit: req.query.limit,
      fieldAgentRef: req.query.fieldAgentRef,
      caseRef: req.query.caseRef,
    });
    return successResponse(res, {
      message: "Compliance evidence fetched",
      data: { evidence: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const fileStandaloneEvidenceHandler = async (req, res, next) => {
  try {
    const evidence = await fileStandaloneEvidence({
      admin: req.user,
      fieldAgentId: req.body.fieldAgentId,
      evidenceType: req.body.evidenceType,
      sourceType: req.body.sourceType,
      sourceRef: req.body.sourceRef,
      sourceSnapshot: req.body.sourceSnapshot,
      description: req.body.description,
      dedupeKey: req.body.dedupeKey,
    });
    return successResponse(res, { statusCode: 201, message: "Compliance evidence filed", data: { evidence: toEvidenceDTO(evidence) } });
  } catch (err) {
    return next(err);
  }
};

export const openCaseHandler = async (req, res, next) => {
  try {
    const result = await openCaseWithFoundingEvidence({
      admin: req.user,
      fieldAgentId: req.body.fieldAgentId,
      category: req.body.category,
      evidence: req.body.evidence,
    });
    return successResponse(res, {
      statusCode: 201,
      message: "Compliance case opened",
      data: { case: toCaseDTO(result.case), foundingEvidence: toEvidenceDTO(result.foundingEvidence) },
    });
  } catch (err) {
    return next(err);
  }
};

export const fileEvidenceForCaseHandler = async (req, res, next) => {
  try {
    const evidence = await fileEvidenceForCase({
      admin: req.user,
      caseId: req.params.caseId,
      evidenceType: req.body.evidenceType,
      sourceType: req.body.sourceType,
      sourceRef: req.body.sourceRef,
      sourceSnapshot: req.body.sourceSnapshot,
      description: req.body.description,
      dedupeKey: req.body.dedupeKey,
    });
    return successResponse(res, { statusCode: 201, message: "Compliance evidence added to case", data: { evidence: toEvidenceDTO(evidence) } });
  } catch (err) {
    return next(err);
  }
};

export const transitionCaseHandler = async (req, res, next) => {
  try {
    const updated = await transitionCase({
      admin: req.user,
      caseId: req.params.caseId,
      expectedVersion: req.body.expectedVersion,
      toStatus: req.body.toStatus,
      reason: req.body.reason,
      decision: req.body.decision,
    });
    return successResponse(res, { message: "Compliance case transitioned", data: { case: toCaseDTO(updated) } });
  } catch (err) {
    return next(err);
  }
};

export const reopenCaseHandler = async (req, res, next) => {
  try {
    const updated = await reopenCase({ admin: req.user, caseId: req.params.caseId, reason: req.body.reason });
    return successResponse(res, { message: "Compliance case reopened", data: { case: toCaseDTO(updated) } });
  } catch (err) {
    return next(err);
  }
};
