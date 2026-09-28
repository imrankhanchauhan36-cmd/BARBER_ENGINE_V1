/**
 * BARBER ENGINE V1
 * backend/validators/adminCustomerSummary.validator.js
 *
 * STEP 5.2A — Admin Customer Summary API. Validation only — no
 * business logic. `.unknown(false)` per this project's standing
 * convention.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminCustomerSummarySchemas = {
  customerIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
