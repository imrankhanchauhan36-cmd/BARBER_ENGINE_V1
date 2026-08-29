/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportTeamConfig.validator.js
 *
 * Phase H Step 8 (Step 1) — Support Configuration Management: Teams.
 * Same Joi conventions as every other Support validator (shared
 * `objectId` primitive, `.unknown(false)`, per-field `.messages()`) —
 * mirrors supportAgent.validator.js/slaPolicy.validator.js exactly.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const supportTeamConfigSchemas = {
  create: Joi.object({
    teamCode: Joi.string().trim().min(1).max(40).required().messages({
      "any.required": "teamCode is required",
      "string.empty": "teamCode is required",
    }),
    name: Joi.string().trim().min(1).max(200).required().messages({
      "any.required": "name is required",
      "string.empty": "name is required",
    }),
    description: Joi.string().trim().max(1000).allow(null).default(null),
    // teamLeadRef must reference an existing active AGENT — re-verified
    // by the service layer (assertTeamLeadValid), same "narrow input
    // here, real authority in the service" split as every other
    // Support validator.
    teamLeadRef: objectId.allow(null).default(null),
  }).unknown(false),

  // Partial update — standard PATCH semantics, same convention
  // supportAgent.validator.js's own `update` schema already uses.
  update: Joi.object({
    teamCode: Joi.string().trim().min(1).max(40).optional(),
    name: Joi.string().trim().min(1).max(200).optional(),
    description: Joi.string().trim().max(1000).allow(null).optional(),
    teamLeadRef: objectId.allow(null).optional(),
  }).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
