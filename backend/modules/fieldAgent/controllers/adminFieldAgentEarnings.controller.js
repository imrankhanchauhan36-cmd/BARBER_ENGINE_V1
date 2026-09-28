/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentEarnings.controller.js
 *
 * STEP 2.3 — thin controller only, same convention as
 * adminFieldAgentSummary.controller.js / adminFieldAgentSalons.
 * controller.js. All join logic lives in adminFieldAgentEarnings.
 * service.js — this file only translates HTTP <-> service call.
 */

import { successResponse } from "../../../utils/response.js";
import { getAdminFieldAgentEarnings } from "../services/adminFieldAgentEarnings.service.js";

export const getAdminFieldAgentEarningsHandler = async (req, res, next) => {
  try {
    const earnings = await getAdminFieldAgentEarnings({ fieldAgentId: req.params.id });
    return successResponse(res, { message: "Field Agent earnings ledger fetched", data: earnings });
  } catch (err) {
    return next(err);
  }
};
