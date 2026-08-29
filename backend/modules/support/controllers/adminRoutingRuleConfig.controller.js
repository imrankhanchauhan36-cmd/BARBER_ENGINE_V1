/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminRoutingRuleConfig.controller.js
 *
 * Phase H Step 8 (Step 4) — Support Configuration Management: Routing
 * Rules. Thin controllers, same layering as every other Support
 * config controller. Passes the entire validated req.body through to
 * createRoutingRule/updateRoutingRule — safe because `validate`
 * middleware has already reduced it to exactly the Joi-whitelisted
 * shape (`.unknown(false)`), the same pattern already relied on by
 * updateAgentHandler/updateTeamHandler passing req.body straight
 * through.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createRoutingRule,
  listRoutingRulesForAdmin,
  updateRoutingRule,
  updateRoutingRuleStatus,
} from "../services/supportRoutingRuleConfig.service.js";

export const createRoutingRuleHandler = async (req, res, next) => {
  try {
    const rule = await createRoutingRule({ ...req.body, actorId: req.user._id });

    return successResponse(res, {
      statusCode: 201,
      message: "Routing rule created successfully",
      data: { rule },
    });
  } catch (err) {
    return next(err);
  }
};

export const listRoutingRulesForAdminHandler = async (req, res, next) => {
  try {
    const rules = await listRoutingRulesForAdmin();

    return successResponse(res, {
      message: "Routing rules fetched successfully",
      data: { rules },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateRoutingRuleHandler = async (req, res, next) => {
  try {
    const rule = await updateRoutingRule(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "Routing rule updated successfully",
      data: { rule },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateRoutingRuleStatusHandler = async (req, res, next) => {
  try {
    const rule = await updateRoutingRuleStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "Routing rule status updated successfully",
      data: { rule },
    });
  } catch (err) {
    return next(err);
  }
};
