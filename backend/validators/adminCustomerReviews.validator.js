/**
 * BARBER ENGINE V1
 * backend/validators/adminCustomerReviews.validator.js
 *
 * STEP 5.5A — Admin Customer Reviews API. Validation only — no
 * business logic. `.unknown(false)` per this project's standing
 * convention. Mirrors adminCustomerBookings.validator.js (STEP 5.2B)
 * exactly.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminCustomerReviewsSchemas = {
  customerIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
