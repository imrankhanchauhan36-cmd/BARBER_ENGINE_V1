/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/slaPolicy.controller.js
 *
 * Phase G Step 1 — thin controllers, same layering as every other
 * Support controller. SUPPORT_ADMIN-only (enforced at the route
 * level via requireRole, not re-checked here — matches the existing
 * convention where role gating lives in route middleware).
 */

import { successResponse } from "../../../utils/response.js";
import {
  createSlaPolicy,
  listSlaPolicies,
  getSlaPolicyById,
  updateSlaPolicy,
  updateSlaPolicyStatus,
  deleteSlaPolicy,
} from "../services/slaPolicy.service.js";

export const createSlaPolicyHandler = async (req, res, next) => {
  try {
    const policy = await createSlaPolicy({
      categoryRef: req.body.categoryRef,
      targetsByPriority: req.body.targetsByPriority,
      warningThresholdPercent: req.body.warningThresholdPercent,
      isActive: req.body.isActive,
      actorId: req.user._id,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "SLA policy created successfully",
      data: { policy },
    });
  } catch (err) {
    return next(err);
  }
};

export const listSlaPoliciesHandler = async (req, res, next) => {
  try {
    const policies = await listSlaPolicies({ query: req.query });

    return successResponse(res, {
      message: "SLA policies fetched successfully",
      data: { policies },
    });
  } catch (err) {
    return next(err);
  }
};

export const getSlaPolicyHandler = async (req, res, next) => {
  try {
    const policy = await getSlaPolicyById(req.params.id);

    return successResponse(res, {
      message: "SLA policy fetched successfully",
      data: { policy },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateSlaPolicyHandler = async (req, res, next) => {
  try {
    const policy = await updateSlaPolicy(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "SLA policy updated successfully",
      data: { policy },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateSlaPolicyStatusHandler = async (req, res, next) => {
  try {
    const policy = await updateSlaPolicyStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "SLA policy status updated successfully",
      data: { policy },
    });
  } catch (err) {
    return next(err);
  }
};

export const deleteSlaPolicyHandler = async (req, res, next) => {
  try {
    const policy = await deleteSlaPolicy(req.params.id, req.user._id);

    return successResponse(res, {
      message: "SLA policy deleted successfully",
      data: { policy },
    });
  } catch (err) {
    return next(err);
  }
};
