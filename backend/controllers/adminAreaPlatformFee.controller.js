/**
 * BARBER ENGINE V1
 * backend/controllers/adminAreaPlatformFee.controller.js
 *
 * Thin controllers only. adminId is always req.user._id — never
 * client-supplied.
 */

import { successResponse } from "../utils/response.js";
import {
  createDraftAreaPlatformFee,
  listAreaPlatformFees,
  getAreaPlatformFeeDetail,
  updateDraftAreaPlatformFee,
  publishAreaPlatformFee,
  retireAreaPlatformFee,
} from "../services/areaPlatformFee.service.js";

export const createDraftAreaPlatformFeeHandler = async (req, res, next) => {
  try {
    const policy = await createDraftAreaPlatformFee({
      adminId: req.user._id,
      areaRef: req.body.areaRef,
      feeInPaise: req.body.feeInPaise,
      req,
    });
    return successResponse(res, { statusCode: 201, message: "Draft area platform fee created", data: { policy } });
  } catch (err) {
    return next(err);
  }
};

export const listAreaPlatformFeesHandler = async (req, res, next) => {
  try {
    const policies = await listAreaPlatformFees({
      areaRef: req.query.areaRef,
      page: req.query.page,
      limit: req.query.limit,
    });
    return successResponse(res, { message: "Area platform fees fetched", data: { policies } });
  } catch (err) {
    return next(err);
  }
};

export const getAreaPlatformFeeDetailHandler = async (req, res, next) => {
  try {
    const policy = await getAreaPlatformFeeDetail(req.params.policyId);
    return successResponse(res, { message: "Area platform fee detail fetched", data: { policy } });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftAreaPlatformFeeHandler = async (req, res, next) => {
  try {
    const policy = await updateDraftAreaPlatformFee({
      policyId: req.params.policyId,
      adminId: req.user._id,
      feeInPaise: req.body.feeInPaise,
      req,
    });
    return successResponse(res, { message: "Draft area platform fee updated", data: { policy } });
  } catch (err) {
    return next(err);
  }
};

export const publishAreaPlatformFeeHandler = async (req, res, next) => {
  try {
    const policy = await publishAreaPlatformFee({ policyId: req.params.policyId, adminId: req.user._id, req });
    return successResponse(res, { message: "Area platform fee published", data: { policy } });
  } catch (err) {
    return next(err);
  }
};

export const retireAreaPlatformFeeHandler = async (req, res, next) => {
  try {
    const policy = await retireAreaPlatformFee({ policyId: req.params.policyId, adminId: req.user._id, req });
    return successResponse(res, { message: "Area platform fee retired", data: { policy } });
  } catch (err) {
    return next(err);
  }
};
