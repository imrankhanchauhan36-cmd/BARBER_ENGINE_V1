/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentWallet.controller.js
 *
 * STEP 2.4 — thin controllers only, same convention as
 * adminFieldAgentSummary.controller.js. One file covers both routes
 * (GET /:id/wallet, GET /:id/payouts) per the ticket's own file list
 * (a single controllers/adminFieldAgentWallet.controller.js, no
 * separate payout controller file). All logic lives in
 * adminFieldAgentWallet.service.js / adminFieldAgentPayoutHistory.
 * service.js — this file only translates HTTP <-> service call.
 */

import { successResponse } from "../../../utils/response.js";
import { getAdminFieldAgentWallet } from "../services/adminFieldAgentWallet.service.js";
import { getAdminFieldAgentPayoutHistory } from "../services/adminFieldAgentPayoutHistory.service.js";

export const getAdminFieldAgentWalletHandler = async (req, res, next) => {
  try {
    const result = await getAdminFieldAgentWallet({ fieldAgentId: req.params.id });
    return successResponse(res, { message: "Field Agent wallet fetched", data: result });
  } catch (err) {
    return next(err);
  }
};

export const getAdminFieldAgentPayoutHistoryHandler = async (req, res, next) => {
  try {
    const payouts = await getAdminFieldAgentPayoutHistory({ fieldAgentId: req.params.id });
    return successResponse(res, { message: "Field Agent payout history fetched", data: { payouts } });
  } catch (err) {
    return next(err);
  }
};
