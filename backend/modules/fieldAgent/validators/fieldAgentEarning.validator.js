/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/fieldAgentEarning.validator.js
 *
 * FA-14 — reuses the exact MAX_LIST_LIMIT/DEFAULT_LIST_LIMIT constants
 * already governing the acquisition-claim "mine" endpoints, rather
 * than re-declaring separate bounds, so the two self-service list
 * surfaces can never silently drift apart. `.unknown(false)` is what
 * makes ?fieldAgentRef=/?userId=/?agentId=/any other query key
 * structurally rejected (400) before the handler ever runs — not
 * merely ignored.
 */

import Joi from "joi";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";

export const fieldAgentEarningSchemas = {
  listEarningsQuery: Joi.object({
    page:  Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  }).unknown(false),
};
