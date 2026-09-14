/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminAcquisitionClaim.controller.js
 *
 * FA-5.3 — thin admin controllers only. adminId is always req.user._id,
 * admin scope (adminLevel/stateRef/districtRef) is always req.user —
 * same convention as adminCommercialTerritory.controller.js.
 */

import { successResponse } from "../../../utils/response.js";
import {
  adminListClaims,
  adminGetClaimDetail,
  adminRejectClaim,
  adminReassignClaim,
} from "../services/acquisitionClaim.service.js";

export const adminListClaimsHandler = async (req, res, next) => {
  try {
    const result = await adminListClaims({
      admin: req.user,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });
    return successResponse(res, {
      message: "Acquisition claims fetched",
      data: { claims: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const adminGetClaimDetailHandler = async (req, res, next) => {
  try {
    const claim = await adminGetClaimDetail({ admin: req.user, claimId: req.params.claimId });
    return successResponse(res, { message: "Acquisition claim detail fetched", data: { claim } });
  } catch (err) {
    return next(err);
  }
};

export const adminRejectClaimHandler = async (req, res, next) => {
  try {
    const claim = await adminRejectClaim({ adminId: req.user._id, claimId: req.params.claimId });
    return successResponse(res, { message: "Acquisition claim rejected", data: { claim } });
  } catch (err) {
    return next(err);
  }
};

export const adminReassignClaimHandler = async (req, res, next) => {
  try {
    const claim = await adminReassignClaim({ adminId: req.user._id, claimId: req.params.claimId });
    return successResponse(res, { message: "Acquisition claim reassigned", data: { claim } });
  } catch (err) {
    return next(err);
  }
};
