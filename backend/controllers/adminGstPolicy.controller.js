/**
 * BARBER ENGINE V1
 * backend/controllers/adminGstPolicy.controller.js
 *
 * Thin controllers only. adminId is always req.user._id — never
 * client-supplied, matching the identity-derivation convention used
 * throughout this codebase (adminCommercialPolicy.controller.js et al.).
 */

import { successResponse } from "../utils/response.js";
import {
  createDraftGstPolicy,
  listGstPolicies,
  getGstPolicyDetail,
  updateDraftGstPolicy,
  publishGstPolicy,
  retireGstPolicy,
} from "../services/gstPolicy.service.js";

export const createDraftGstPolicyHandler = async (req, res, next) => {
  try {
    const version = await createDraftGstPolicy({ adminId: req.user._id, ratePercent: req.body.ratePercent, req });
    return successResponse(res, { statusCode: 201, message: "Draft GST policy created", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const listGstPoliciesHandler = async (req, res, next) => {
  try {
    const versions = await listGstPolicies({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "GST policies fetched", data: { versions } });
  } catch (err) {
    return next(err);
  }
};

export const getGstPolicyDetailHandler = async (req, res, next) => {
  try {
    const version = await getGstPolicyDetail(req.params.versionId);
    return successResponse(res, { message: "GST policy detail fetched", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftGstPolicyHandler = async (req, res, next) => {
  try {
    const version = await updateDraftGstPolicy({
      versionId: req.params.versionId,
      adminId: req.user._id,
      ratePercent: req.body.ratePercent,
      req,
    });
    return successResponse(res, { message: "Draft GST policy updated", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const publishGstPolicyHandler = async (req, res, next) => {
  try {
    const version = await publishGstPolicy({ versionId: req.params.versionId, adminId: req.user._id, req });
    return successResponse(res, { message: "GST policy published", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const retireGstPolicyHandler = async (req, res, next) => {
  try {
    const version = await retireGstPolicy({ versionId: req.params.versionId, adminId: req.user._id, req });
    return successResponse(res, { message: "GST policy retired", data: { version } });
  } catch (err) {
    return next(err);
  }
};
