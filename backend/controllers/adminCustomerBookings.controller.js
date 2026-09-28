/**
 * BARBER ENGINE V1
 * backend/controllers/adminCustomerBookings.controller.js
 *
 * STEP 5.2B — thin controller only. All logic lives in
 * adminCustomerBookings.service.js.
 */

import { successResponse } from "../utils/response.js";
import { getAdminCustomerBookings } from "../services/adminCustomerBookings.service.js";

export const getAdminCustomerBookingsHandler = async (req, res, next) => {
  try {
    const result = await getAdminCustomerBookings({ customerId: req.params.id, admin: req.user });
    return successResponse(res, { message: "Customer booking history fetched", data: result });
  } catch (err) {
    return next(err);
  }
};
