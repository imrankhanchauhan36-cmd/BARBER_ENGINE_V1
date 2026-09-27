/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentAcquisitionRecovery.controller.js
 *
 * FA-P3-B Step 2 — thin controllers only. Identity always derived from
 * req.user._id, never a client-supplied fieldAgentRef, same convention
 * as fieldAgentAcquisitionClaim.controller.js.
 */

import { successResponse } from "../../../utils/response.js";
import {
  getMyAcquisitionDashboard,
  listMyAcquisitionRecovery,
  getMyAcquisitionRecoveryDetail,
} from "../services/acquisitionRecovery.service.js";

export const getMyAcquisitionDashboardHandler = async (req, res, next) => {
  try {
    const dashboard = await getMyAcquisitionDashboard({ userId: req.user._id });
    return successResponse(res, { message: "Acquisition recovery dashboard fetched", data: dashboard });
  } catch (err) {
    return next(err);
  }
};

export const listMyAcquisitionRecoveryHandler = async (req, res, next) => {
  try {
    const result = await listMyAcquisitionRecovery({
      userId: req.user._id,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return successResponse(res, {
      message: "Acquisition recovery list fetched",
      data: { salons: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const getMyAcquisitionRecoveryDetailHandler = async (req, res, next) => {
  try {
    const detail = await getMyAcquisitionRecoveryDetail({ userId: req.user._id, claimId: req.params.claimId });
    return successResponse(res, { message: "Acquisition recovery detail fetched", data: detail });
  } catch (err) {
    return next(err);
  }
};
