/**
 * BARBER ENGINE V1
 * backend/controllers/adminSalonAnalytics.controller.js
 * GET /api/admin/salons/:id/analytics
 *
 * ADMIN PANEL MUST-DO-NOW #2 — thin controller only, all logic in
 * services/adminSalonAnalytics.service.js (same convention as
 * controllers/adminCustomerSummary.controller.js).
 */

import { successResponse } from "../utils/response.js";
import { getAdminSalonAnalytics } from "../services/adminSalonAnalytics.service.js";

export const getAdminSalonAnalyticsHandler = async (req, res, next) => {
  try {
    const data = await getAdminSalonAnalytics({
      salonId: req.params.id,
      periodKey: req.query.period,
      admin: req.user,
    });
    return successResponse(res, { message: "Salon analytics fetched", data });
  } catch (err) {
    return next(err);
  }
};
