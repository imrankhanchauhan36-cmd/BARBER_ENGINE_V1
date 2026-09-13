/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminCommercialModel.controller.js
 *
 * FA-5.1 — commercial-path selection. adminId is always req.user._id,
 * never client-supplied.
 */

import { successResponse } from "../../../utils/response.js";
import { selectCommercialPath } from "../services/commercialModel.service.js";

export const selectCommercialPathHandler = async (req, res, next) => {
  try {
    const fieldAgent = await selectCommercialPath({
      fieldAgentId: req.params.fieldAgentId,
      adminId: req.user._id,
      commercialPath: req.body.commercialPath,
    });
    return successResponse(res, { message: "Commercial path selected", data: { fieldAgent } });
  } catch (err) {
    return next(err);
  }
};
