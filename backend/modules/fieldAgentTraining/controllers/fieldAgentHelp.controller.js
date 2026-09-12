/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/controllers/fieldAgentHelp.controller.js
 *
 * FA-3.3 — Field Agent Help (curated operational reference).
 */

import { successResponse } from "../../../utils/response.js";
import { getHelpContent } from "../services/fieldAgentHelp.service.js";

export const getHelpContentHandler = async (req, res, next) => {
  try {
    const help = await getHelpContent(req.query.lang);
    return successResponse(res, { message: "Help content fetched successfully", data: { modules: help } });
  } catch (err) {
    return next(err);
  }
};
