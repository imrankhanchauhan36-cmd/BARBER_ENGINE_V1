/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentSummary.validator.js
 *
 * STEP 2.1 — Admin Field Agent Summary API. Validation only — no
 * business logic. `.unknown(false)` per this project's standing
 * convention (see e.g. adminFieldAgentPerformance.validator.js).
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminFieldAgentSummarySchemas = {
  fieldAgentIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
