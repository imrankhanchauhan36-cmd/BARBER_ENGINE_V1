/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminCoverageConfig.controller.js
 *
 * Phase H Step 8 (Step 5) — Support Configuration Management:
 * Coverage. Thin controllers, same layering as every other Support
 * config controller.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createCoverage,
  listCoverageForAdmin,
  updateCoverage,
  updateCoverageStatus,
} from "../services/supportCoverageConfig.service.js";

export const createCoverageHandler = async (req, res, next) => {
  try {
    const coverage = await createCoverage({ ...req.body, actorId: req.user._id });

    return successResponse(res, {
      statusCode: 201,
      message: "Coverage created successfully",
      data: { coverage },
    });
  } catch (err) {
    return next(err);
  }
};

export const listCoverageForAdminHandler = async (req, res, next) => {
  try {
    const coverage = await listCoverageForAdmin();

    return successResponse(res, {
      message: "Coverage fetched successfully",
      data: { coverage },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateCoverageHandler = async (req, res, next) => {
  try {
    const coverage = await updateCoverage(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "Coverage updated successfully",
      data: { coverage },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateCoverageStatusHandler = async (req, res, next) => {
  try {
    const coverage = await updateCoverageStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "Coverage status updated successfully",
      data: { coverage },
    });
  } catch (err) {
    return next(err);
  }
};
