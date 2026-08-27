/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/slaPolicy.validator.js
 *
 * Phase G Step 1 — same Joi conventions as every other Support
 * validator (shared `objectId` primitive, `.unknown(false)` at every
 * nesting level, per-field `.messages()`).
 */

import Joi from "joi";
import { PRIORITY } from "../constants/support.constants.js";

const objectId = Joi.string().hex().length(24);

// LOW/NORMAL/HIGH/CRITICAL, derived from the frozen PRIORITY enum
// rather than re-typing the four literals — if PRIORITY ever changes
// shape, this validator and the model's schema (which hardcodes the
// same four keys, matching Mongoose's own static-field-name
// convention) would need to be revisited together; not silently
// papered over by a dynamic schema.
const priorityTargetSchema = Joi.object({
  firstResponseMinutes: Joi.number().integer().positive().required().messages({
    "any.required": "firstResponseMinutes is required",
    "number.positive": "firstResponseMinutes must be a positive number",
  }),
  resolutionMinutes: Joi.number().integer().positive().required().messages({
    "any.required": "resolutionMinutes is required",
    "number.positive": "resolutionMinutes must be a positive number",
  }),
}).unknown(false);

const targetsByPrioritySchema = Joi.object(
  Object.fromEntries(Object.values(PRIORITY).map((p) => [p, priorityTargetSchema.required()]))
).unknown(false);

export const slaPolicySchemas = {
  create: Joi.object({
    categoryRef: objectId.allow(null).default(null),
    targetsByPriority: targetsByPrioritySchema.required().messages({
      "any.required": "targetsByPriority is required",
    }),
    warningThresholdPercent: Joi.number().integer().min(1).max(99).required().messages({
      "any.required": "warningThresholdPercent is required",
      "number.min": "warningThresholdPercent must be between 1 and 99",
      "number.max": "warningThresholdPercent must be between 1 and 99",
    }),
    isActive: Joi.boolean().default(true),
  }).unknown(false),

  // Partial update — standard PATCH semantics (the locked spec names
  // "update policy" without specifying partial-vs-full, so the
  // ordinary REST meaning of PATCH is used rather than inventing a
  // stricter one). Any field that IS provided must still be
  // completely valid on its own terms — e.g. a provided
  // targetsByPriority must still list all four priorities; there is
  // no per-priority partial merge.
  update: Joi.object({
    categoryRef: objectId.allow(null).optional(),
    targetsByPriority: targetsByPrioritySchema.optional(),
    warningThresholdPercent: Joi.number().integer().min(1).max(99).optional(),
    isActive: Joi.boolean().optional(),
  }).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
