/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminCommercialPolicyOverride.controller.js
 *
 * FA-9 — thin controllers only. adminId is always req.user._id — never
 * client-supplied, matching adminCommercialPolicy.controller.js's own
 * convention exactly.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftPolicyOverride,
  listPolicyOverrides,
  getPolicyOverrideDetail,
  updateDraftPolicyOverride,
  publishPolicyOverride,
  retirePolicyOverride,
} from "../services/commercialPolicyOverride.service.js";

export const createDraftPolicyOverrideHandler = async (req, res, next) => {
  try {
    const override = await createDraftPolicyOverride({ adminId: req.user._id, ...req.body });
    return successResponse(res, { statusCode: 201, message: "Draft commercial policy override created", data: { override } });
  } catch (err) {
    return next(err);
  }
};

export const listPolicyOverridesHandler = async (req, res, next) => {
  try {
    const overrides = await listPolicyOverrides({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      districtRef: req.query.districtRef,
    });
    return successResponse(res, { message: "Commercial policy overrides fetched", data: { overrides } });
  } catch (err) {
    return next(err);
  }
};

export const getPolicyOverrideDetailHandler = async (req, res, next) => {
  try {
    const override = await getPolicyOverrideDetail(req.params.overrideId);
    return successResponse(res, { message: "Commercial policy override detail fetched", data: { override } });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftPolicyOverrideHandler = async (req, res, next) => {
  try {
    const override = await updateDraftPolicyOverride({ overrideId: req.params.overrideId, adminId: req.user._id, ...req.body });
    return successResponse(res, { message: "Draft commercial policy override updated", data: { override } });
  } catch (err) {
    return next(err);
  }
};

export const publishPolicyOverrideHandler = async (req, res, next) => {
  try {
    const override = await publishPolicyOverride({ overrideId: req.params.overrideId, adminId: req.user._id });
    return successResponse(res, { message: "Commercial policy override published", data: { override } });
  } catch (err) {
    return next(err);
  }
};

export const retirePolicyOverrideHandler = async (req, res, next) => {
  try {
    const override = await retirePolicyOverride({
      overrideId: req.params.overrideId,
      adminId: req.user._id,
      reason: req.body.reason,
    });
    return successResponse(res, { message: "Commercial policy override retired", data: { override } });
  } catch (err) {
    return next(err);
  }
};
