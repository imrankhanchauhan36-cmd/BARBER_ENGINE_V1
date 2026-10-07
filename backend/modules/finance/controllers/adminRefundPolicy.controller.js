/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminRefundPolicy.controller.js
 *
 * Global Refund & Cancellation Policy. Thin controllers only — all
 * business logic lives in RefundPolicyService.js. adminId is always
 * req.user._id, never client-supplied (matches every sibling finance
 * policy controller's own convention exactly).
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftRefundPolicy,
  listRefundPolicyVersions,
  getRefundPolicyDetail,
  getPublishedRefundPolicy,
  updateDraftRefundPolicy,
  publishRefundPolicy,
  retireRefundPolicy,
} from "../services/RefundPolicyService.js";
import { toRefundPolicyAdminDTO, toRefundPolicyAdminListDTO } from "../dto/refundPolicy.dto.js";

export const createDraftRefundPolicyHandler = async (req, res, next) => {
  try {
    const version = await createDraftRefundPolicy({ adminId: req.user._id, rules: req.body.rules, req });
    return successResponse(res, { statusCode: 201, message: "Draft refund policy created", data: toRefundPolicyAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const listRefundPolicyHandler = async (req, res, next) => {
  try {
    const versions = await listRefundPolicyVersions({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "Refund policy history fetched", data: toRefundPolicyAdminListDTO(versions) });
  } catch (err) {
    return next(err);
  }
};

export const getRefundPolicyDetailHandler = async (req, res, next) => {
  try {
    const version = await getRefundPolicyDetail(req.params.id);
    return successResponse(res, { message: "Refund policy detail fetched", data: toRefundPolicyAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

// The one currently PUBLISHED version. null when none has ever been published.
export const getPublishedRefundPolicyHandler = async (req, res, next) => {
  try {
    const version = await getPublishedRefundPolicy();
    return successResponse(res, { message: "Published refund policy fetched", data: toRefundPolicyAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftRefundPolicyHandler = async (req, res, next) => {
  try {
    const version = await updateDraftRefundPolicy({ versionId: req.params.id, adminId: req.user._id, rules: req.body.rules, req });
    return successResponse(res, { message: "Draft refund policy updated", data: toRefundPolicyAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const publishRefundPolicyHandler = async (req, res, next) => {
  try {
    const version = await publishRefundPolicy({ versionId: req.params.id, adminId: req.user._id, req });
    return successResponse(res, { message: "Refund policy published", data: toRefundPolicyAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const retireRefundPolicyHandler = async (req, res, next) => {
  try {
    const version = await retireRefundPolicy({ versionId: req.params.id, adminId: req.user._id, req });
    return successResponse(res, { message: "Refund policy retired", data: toRefundPolicyAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};
