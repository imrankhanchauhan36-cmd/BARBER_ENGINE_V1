/**
 * BARBER ENGINE V1
 * backend/controllers/adminSalonRevenue.controller.js
 *
 * STEP 4.2A — thin controller only. All logic lives in
 * adminSalonRevenue.service.js.
 */

import { successResponse } from "../utils/response.js";
import { getAdminSalonRevenue } from "../services/adminSalonRevenue.service.js";

export const getAdminSalonRevenueHandler = async (req, res, next) => {
  try {
    const revenue = await getAdminSalonRevenue({ salonId: req.params.id, admin: req.user });
    return successResponse(res, { message: "Salon revenue fetched", data: revenue });
  } catch (err) {
    return next(err);
  }
};
