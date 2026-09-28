/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentAnalytics.controller.js
 *
 * STEP 3.5A — thin controller only. No query params — all logic
 * (including the fixed 12-month trend window and top-10 limit) lives
 * in adminFieldAgentAnalytics.service.js.
 */

import { successResponse } from "../../../utils/response.js";
import { getAdminFieldAgentAnalytics } from "../services/adminFieldAgentAnalytics.service.js";

export const getAdminFieldAgentAnalyticsHandler = async (req, res, next) => {
  try {
    const analytics = await getAdminFieldAgentAnalytics();
    return successResponse(res, { message: "Field Agent analytics fetched", data: analytics });
  } catch (err) {
    return next(err);
  }
};
