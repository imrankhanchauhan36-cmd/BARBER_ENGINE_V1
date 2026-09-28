/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentSummary.controller.js
 *
 * STEP 2.1 — thin controller only, same convention as
 * adminFieldAgentPerformance.controller.js: `admin` identity comes
 * from req.user (server-populated by protect + requireAdminLevel),
 * never client input. All aggregation logic lives in
 * adminFieldAgentSummary.service.js — this file only translates
 * HTTP <-> service call.
 */

import { successResponse } from "../../../utils/response.js";
import { getAdminFieldAgentSummary } from "../services/adminFieldAgentSummary.service.js";

export const getAdminFieldAgentSummaryHandler = async (req, res, next) => {
  try {
    const summary = await getAdminFieldAgentSummary({ fieldAgentId: req.params.id });
    return successResponse(res, { message: "Field Agent summary fetched", data: summary });
  } catch (err) {
    return next(err);
  }
};
