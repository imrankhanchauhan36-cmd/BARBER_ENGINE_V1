/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/fieldAgentApplications.validator.js
 *
 * PHASE 2A — same Joi conventions as acquisitionClaim.validator.js:
 * `.unknown(false)`, no client-suppliable identity field. `status` is
 * optional and restricted to the REAL, existing CLAIM_STATUS enum —
 * no new status value is invented here.
 */

import Joi from "joi";
import { CLAIM_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";

export const fieldAgentApplicationsSchemas = {
  listApplicationsQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    status: Joi.string().valid(...Object.values(CLAIM_STATUS)).optional(),
    // Identity is never client-suppliable — a Field Agent cannot ask
    // for another agent's applications by adding a query param.
    fieldAgentId: Joi.any().forbidden(),
    fieldAgentRef: Joi.any().forbidden(),
    ownerId: Joi.any().forbidden(),
  }).unknown(false),
};
