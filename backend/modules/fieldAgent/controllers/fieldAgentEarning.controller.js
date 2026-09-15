/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentEarning.controller.js
 *
 * FA-14 — thin controller only. Identity derives exclusively from
 * req.user._id — never a client-supplied fieldAgentRef/userId/agentId,
 * matching the identity-derivation convention already used everywhere
 * in this codebase (fieldAgentAcquisitionClaim.controller.js).
 */

import { successResponse } from "../../../utils/response.js";
import { listMyEarnings } from "../services/fieldAgentEarning.selfService.js";

export const listMyEarningsHandler = async (req, res, next) => {
  try {
    const result = await listMyEarnings({
      userId: req.user._id,
      page:   req.query.page,
      limit:  req.query.limit,
    });
    return successResponse(res, {
      message: "Earnings fetched",
      data: { earnings: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};
