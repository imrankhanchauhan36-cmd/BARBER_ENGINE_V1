/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminAgent.controller.js
 *
 * Phase H Step 7 — thin controllers, same layering as every other
 * Support controller (see slaPolicy.controller.js). SUPPORT_ADMIN-only
 * (enforced at the route level via requireRole, not re-checked here —
 * matches the existing convention where role gating lives in route
 * middleware, not in the controller body).
 */

import { successResponse } from "../../../utils/response.js";
import {
  createAgent,
  listAgents,
  getAgentById,
  updateAgentProfile,
  updateAgentStatus,
  listTeams,
} from "../services/supportAgent.service.js";

export const createAgentHandler = async (req, res, next) => {
  try {
    const result = await createAgent({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      teamRefs: req.body.teamRefs,
      primaryTeamRef: req.body.primaryTeamRef,
      categoryRefs: req.body.categoryRefs,
      languages: req.body.languages,
      maxActiveTickets: req.body.maxActiveTickets,
      actorId: req.user._id,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Agent created successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const listAgentsHandler = async (req, res, next) => {
  try {
    const agents = await listAgents();

    return successResponse(res, {
      message: "Agents fetched successfully",
      data: { agents },
    });
  } catch (err) {
    return next(err);
  }
};

export const getAgentHandler = async (req, res, next) => {
  try {
    const agent = await getAgentById(req.params.id);

    return successResponse(res, {
      message: "Agent fetched successfully",
      data: { agent },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateAgentHandler = async (req, res, next) => {
  try {
    const agent = await updateAgentProfile(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "Agent updated successfully",
      data: { agent },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateAgentStatusHandler = async (req, res, next) => {
  try {
    const agent = await updateAgentStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "Agent status updated successfully",
      data: { agent },
    });
  } catch (err) {
    return next(err);
  }
};

// Reused by adminTeam.routes.js — same "one existing handler, thin
// new route file" pattern adminCategory.routes.js already established
// for listCategoriesHandler.
export const listTeamsHandler = async (req, res, next) => {
  try {
    const teams = await listTeams();

    return successResponse(res, {
      message: "Teams fetched successfully",
      data: { teams },
    });
  } catch (err) {
    return next(err);
  }
};
