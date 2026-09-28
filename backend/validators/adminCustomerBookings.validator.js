/**
 * BARBER ENGINE V1
 * backend/validators/adminCustomerBookings.validator.js
 *
 * STEP 5.2B — Admin Customer Booking History API. Validation only —
 * no business logic. `.unknown(false)` per this project's standing
 * convention.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminCustomerBookingsSchemas = {
  customerIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
