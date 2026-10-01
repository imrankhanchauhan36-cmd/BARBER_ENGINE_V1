/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentApplications.controller.js
 *
 * PHASE 2A — thin controller only. Identity is derived EXCLUSIVELY
 * from req.user._id (set by the `protect` middleware from the
 * caller's own verified JWT) — never from any request body/query
 * field. Same identity-derivation convention as
 * fieldAgentAcquisitionClaim.controller.js's existing handlers.
 */

import { successResponse } from "../../../utils/response.js";
import { listMyApplications } from "../services/fieldAgentApplications.service.js";

export const listMyApplicationsHandler = async (req, res, next) => {
  try {
    const result = await listMyApplications({
      userId: req.user._id,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });
    return successResponse(res, {
      message: "Applications fetched",
      data: { applications: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};
