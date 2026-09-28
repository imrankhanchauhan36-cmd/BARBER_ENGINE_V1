/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentRoster.controller.js
 *
 * STEP 3.1 (backend addendum, user-approved exception) — thin
 * controller only. All logic lives in adminFieldAgentRoster.
 * service.js.
 */

import { successResponse } from "../../../utils/response.js";
import { listAdminFieldAgentRoster } from "../services/adminFieldAgentRoster.service.js";

export const listAdminFieldAgentRosterHandler = async (req, res, next) => {
  try {
    const { items, pagination } = await listAdminFieldAgentRoster({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      commercialType: req.query.commercialType,
    });
    return successResponse(res, {
      message: "Field Agent roster fetched",
      data: { agents: items },
      pagination,
    });
  } catch (err) {
    return next(err);
  }
};
