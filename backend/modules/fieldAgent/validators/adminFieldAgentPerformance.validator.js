/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentPerformance.validator.js
 *
 * FA-11.3 — same Joi conventions as acquisitionClaim.validator.js:
 * shared `objectId` primitive, `.unknown(false)` so this project's
 * `stripUnknown:true` Joi config can't silently swallow an attempt to
 * inject an unapproved field (e.g. a client-supplied `stateRef`,
 * which must never be accepted here — state scope always comes from
 * the authenticated admin's own req.user.stateRef, never from a
 * request field).
 */

import Joi from "joi";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/performance.constants.js";

const objectId = Joi.string().hex().length(24);

export const adminFieldAgentPerformanceSchemas = {
  fieldAgentIdParam: Joi.object({ fieldAgentId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    fieldAgentRef: objectId.optional(),
    commercialPath: Joi.string()
      .valid(...Object.values(COMMERCIAL_PATH))
      .optional(),
    cycleKey: Joi.string().trim().max(200).optional(),
    policyVersionRef: objectId.optional(),
  }).unknown(false),
};
