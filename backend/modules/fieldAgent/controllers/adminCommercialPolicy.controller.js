/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminCommercialPolicy.controller.js
 *
 * FA-5.1 — thin controllers only. adminId is always req.user._id —
 * never client-supplied, matching the identity-derivation convention
 * used everywhere else in this codebase (adminTest.controller.js,
 * adminFieldAgentApproval.controller.js).
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftPolicyVersion,
  listPolicyVersions,
  getPolicyVersionDetail,
  updateDraftPolicyVersion,
  publishPolicyVersion,
  retirePolicyVersion,
} from "../services/commercialPolicy.service.js";

export const createDraftPolicyVersionHandler = async (req, res, next) => {
  try {
    const version = await createDraftPolicyVersion({ adminId: req.user._id, ...req.body });
    return successResponse(res, { statusCode: 201, message: "Draft commercial policy version created", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const listPolicyVersionsHandler = async (req, res, next) => {
  try {
    const versions = await listPolicyVersions({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "Commercial policy versions fetched", data: { versions } });
  } catch (err) {
    return next(err);
  }
};

export const getPolicyVersionDetailHandler = async (req, res, next) => {
  try {
    const version = await getPolicyVersionDetail(req.params.versionId);
    return successResponse(res, { message: "Commercial policy version detail fetched", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftPolicyVersionHandler = async (req, res, next) => {
  try {
    const version = await updateDraftPolicyVersion({ versionId: req.params.versionId, adminId: req.user._id, ...req.body });
    return successResponse(res, { message: "Draft commercial policy version updated", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const publishPolicyVersionHandler = async (req, res, next) => {
  try {
    const version = await publishPolicyVersion({ versionId: req.params.versionId, adminId: req.user._id });
    return successResponse(res, { message: "Commercial policy version published", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const retirePolicyVersionHandler = async (req, res, next) => {
  try {
    const version = await retirePolicyVersion({
      versionId: req.params.versionId,
      adminId: req.user._id,
      reason: req.body.reason,
    });
    return successResponse(res, { message: "Commercial policy version retired", data: { version } });
  } catch (err) {
    return next(err);
  }
};
