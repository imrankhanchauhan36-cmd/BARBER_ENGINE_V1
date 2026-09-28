/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentSalons.controller.js
 *
 * STEP 2.2 — thin controller only, same convention as
 * adminFieldAgentSummary.controller.js. All join logic lives in
 * adminFieldAgentSalons.service.js — this file only translates
 * HTTP <-> service call.
 */

import { successResponse } from "../../../utils/response.js";
import { getAdminFieldAgentSalons } from "../services/adminFieldAgentSalons.service.js";

export const getAdminFieldAgentSalonsHandler = async (req, res, next) => {
  try {
    const salons = await getAdminFieldAgentSalons({ fieldAgentId: req.params.id });
    return successResponse(res, { message: "Field Agent acquired salons fetched", data: { salons } });
  } catch (err) {
    return next(err);
  }
};
