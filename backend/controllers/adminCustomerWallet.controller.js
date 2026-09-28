/**
 * BARBER ENGINE V1
 * backend/controllers/adminCustomerWallet.controller.js
 *
 * STEP 5.5B — thin controller only. All logic lives in
 * adminCustomerWallet.service.js.
 */

import { successResponse } from "../utils/response.js";
import { getAdminCustomerWallet } from "../services/adminCustomerWallet.service.js";

export const getAdminCustomerWalletHandler = async (req, res, next) => {
  try {
    const result = await getAdminCustomerWallet({ customerId: req.params.id, admin: req.user });
    return successResponse(res, { message: "Customer wallet fetched", data: result });
  } catch (err) {
    return next(err);
  }
};
