/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentEarnings.validator.js
 *
 * STEP 2.3 — Admin Field Agent Earnings Ledger API. Validation only —
 * no business logic. `.unknown(false)` per this project's standing
 * convention (see e.g. adminFieldAgentSummary.validator.js).
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminFieldAgentEarningsSchemas = {
  fieldAgentIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
