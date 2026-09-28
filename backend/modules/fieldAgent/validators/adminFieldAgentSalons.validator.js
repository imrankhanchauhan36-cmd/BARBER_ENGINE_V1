/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentSalons.validator.js
 *
 * STEP 2.2 — Admin Field Agent Acquired Salons API. Validation only —
 * no business logic. `.unknown(false)` per this project's standing
 * convention (see e.g. adminFieldAgentSummary.validator.js).
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminFieldAgentSalonsSchemas = {
  fieldAgentIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
