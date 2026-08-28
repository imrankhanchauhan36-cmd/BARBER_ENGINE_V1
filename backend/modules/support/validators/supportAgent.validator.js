/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportAgent.validator.js
 *
 * Phase H Step 7 — same Joi conventions as every other Support
 * validator (shared `objectId` primitive, `.unknown(false)` at every
 * nesting level, per-field `.messages()`) — mirrors
 * slaPolicy.validator.js exactly.
 */

import Joi from "joi";
import { SUPPORTED_LANGUAGES } from "../constants/support.constants.js";

const objectId = Joi.string().hex().length(24);

// India phone format — the exact same regex User.js's own schema
// already enforces (/^[6-9]\d{9}$/). Re-validated here so a bad phone
// produces a clean 400 with a field-level message instead of a raw
// Mongoose ValidationError surfacing from inside a transaction.
const phone = Joi.string().pattern(/^[6-9]\d{9}$/).messages({
  "string.pattern.base": "phone must be a valid 10-digit Indian mobile number",
});

export const supportAgentSchemas = {
  create: Joi.object({
    name: Joi.string().trim().min(1).max(200).required().messages({
      "any.required": "name is required",
      "string.empty": "name is required",
    }),
    email: Joi.string().trim().lowercase().email().required().messages({
      "any.required": "email is required",
      "string.email": "email must be a valid email address",
    }),
    phone: phone.required().messages({
      "any.required": "phone is required",
    }),
    teamRefs: Joi.array().items(objectId).default([]),
    primaryTeamRef: objectId.allow(null).default(null),
    categoryRefs: Joi.array().items(objectId).default([]),
    languages: Joi.array().items(Joi.string().valid(...SUPPORTED_LANGUAGES)).default([]),
    maxActiveTickets: Joi.number().integer().positive().allow(null).default(null),
  }).unknown(false),

  // Partial update — standard PATCH semantics, same convention
  // slaPolicy.validator.js's own `update` schema already uses. Only
  // SupportAgentProfile configuration fields are editable here —
  // identity fields (name/email/phone) are deliberately out of scope
  // for this phase (see the approved plan).
  update: Joi.object({
    teamRefs: Joi.array().items(objectId).optional(),
    primaryTeamRef: objectId.allow(null).optional(),
    categoryRefs: Joi.array().items(objectId).optional(),
    languages: Joi.array().items(Joi.string().valid(...SUPPORTED_LANGUAGES)).optional(),
    maxActiveTickets: Joi.number().integer().positive().allow(null).optional(),
  }).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
