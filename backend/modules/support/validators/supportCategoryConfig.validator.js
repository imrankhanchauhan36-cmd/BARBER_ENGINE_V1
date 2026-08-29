/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportCategoryConfig.validator.js
 *
 * Phase H Step 8 (Step 2) — Support Configuration Management:
 * Categories. Same Joi conventions as every other Support validator.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

// Matches the exact SupportCategory.js enum, including the leading
// `null` member (an optional-but-constrained field, same idiom the
// model's own comment cites from Booking.cancellationPolicy).
const BUSINESS_DOMAINS = ["PAYMENT", "BOOKING", "WALLET", "PAYOUT", "USER", "SALON", "SERVICE"];

export const supportCategoryConfigSchemas = {
  create: Joi.object({
    name: Joi.string().trim().min(1).max(100).required().messages({
      "any.required": "name is required",
      "string.empty": "name is required",
    }),
    code: Joi.string().trim().min(1).max(50).required().messages({
      "any.required": "code is required",
      "string.empty": "code is required",
    }),
    description: Joi.string().trim().max(500).allow(null).default(null),
    parentCategoryRef: objectId.allow(null).default(null),
    businessDomain: Joi.string().valid(...BUSINESS_DOMAINS).allow(null).default(null),
  }).unknown(false),

  update: Joi.object({
    name: Joi.string().trim().min(1).max(100).optional(),
    code: Joi.string().trim().min(1).max(50).optional(),
    description: Joi.string().trim().max(500).allow(null).optional(),
    parentCategoryRef: objectId.allow(null).optional(),
    businessDomain: Joi.string().valid(...BUSINESS_DOMAINS).allow(null).optional(),
  }).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
