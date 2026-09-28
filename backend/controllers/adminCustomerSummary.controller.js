/**
 * BARBER ENGINE V1
 * backend/controllers/adminCustomerSummary.controller.js
 *
 * STEP 5.2A — thin controller only. All logic lives in
 * adminCustomerSummary.service.js.
 */

import { successResponse } from "../utils/response.js";
import { getAdminCustomerSummary } from "../services/adminCustomerSummary.service.js";

export const getAdminCustomerSummaryHandler = async (req, res, next) => {
  try {
    const summary = await getAdminCustomerSummary({ customerId: req.params.id, admin: req.user });
    return successResponse(res, { message: "Customer summary fetched", data: summary });
  } catch (err) {
    return next(err);
  }
};
