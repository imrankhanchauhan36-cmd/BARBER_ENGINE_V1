//////////////////////////////////////////////////////////////
// SALON BOOKING WINDOW — VALIDATOR (C4 Phase 3)
//
// A single-field validator for Salon.business.bookingWindowDays — same
// bounds (1..30) already declared on the Mongoose schema itself
// (models/Salon.js), enforced here at the HTTP boundary so a bad
// request never reaches the database layer at all.
//
// .strict() deliberately disables Joi's default numeric-string
// coercion for this field — a JSON payload must send a genuine
// number (7), not a numeric string ("7"). Without it, Joi would
// silently accept "7" as if it were 7, which is not what "reject:
// ... string" is asking for.
//////////////////////////////////////////////////////////////

import Joi from "joi";

export const bookingWindowSchemas = {
  update: Joi.object({
    bookingWindowDays: Joi.number()
      .integer()
      .strict()
      .min(1)
      .max(30)
      .required()
      .messages({
        "any.required":    "bookingWindowDays is required",
        "number.base":     "bookingWindowDays must be a number",
        "number.integer":  "bookingWindowDays must be a whole number",
        "number.min":      "bookingWindowDays must be at least 1",
        "number.max":      "bookingWindowDays cannot exceed 30",
      }),
  }).unknown(false),
};
