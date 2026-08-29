/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminTeamConfig.controller.js
 *
 * Phase H Step 8 (Step 1) — Support Configuration Management: Teams.
 * Thin controllers, same layering as every other Support controller
 * (see adminAgent.controller.js). SUPPORT_ADMIN/India-Admin-only,
 * enforced at the route level via requireSupportAccess, not re-checked
 * here — matches the existing convention.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createTeam,
  listTeamsForAdmin,
  updateTeam,
  updateTeamStatus,
} from "../services/supportTeamConfig.service.js";

export const createTeamHandler = async (req, res, next) => {
  try {
    const team = await createTeam({
      teamCode: req.body.teamCode,
      name: req.body.name,
      description: req.body.description,
      teamLeadRef: req.body.teamLeadRef,
      actorId: req.user._id,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Team created successfully",
      data: { team },
    });
  } catch (err) {
    return next(err);
  }
};

export const listTeamsForAdminHandler = async (req, res, next) => {
  try {
    const teams = await listTeamsForAdmin();

    return successResponse(res, {
      message: "Teams fetched successfully",
      data: { teams },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateTeamHandler = async (req, res, next) => {
  try {
    const team = await updateTeam(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "Team updated successfully",
      data: { team },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateTeamStatusHandler = async (req, res, next) => {
  try {
    const team = await updateTeamStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "Team status updated successfully",
      data: { team },
    });
  } catch (err) {
    return next(err);
  }
};
