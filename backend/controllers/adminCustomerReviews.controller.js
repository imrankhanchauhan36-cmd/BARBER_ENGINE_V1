/**
 * BARBER ENGINE V1
 * backend/controllers/adminCustomerReviews.controller.js
 *
 * STEP 5.5A — thin controller only. All logic lives in
 * adminCustomerReviews.service.js.
 */

import { successResponse } from "../utils/response.js";
import { getAdminCustomerReviews } from "../services/adminCustomerReviews.service.js";

export const getAdminCustomerReviewsHandler = async (req, res, next) => {
  try {
    const result = await getAdminCustomerReviews({ customerId: req.params.id, admin: req.user });
    return successResponse(res, { message: "Customer reviews fetched", data: result });
  } catch (err) {
    return next(err);
  }
};
