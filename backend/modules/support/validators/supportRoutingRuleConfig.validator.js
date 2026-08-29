/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportRoutingRuleConfig.validator.js
 *
 * Phase H Step 8 (Step 4) — Support Configuration Management: Routing
 * Rules. Same Joi conventions as every other Support validator. Every
 * match dimension is optional (empty/absent = wildcard), matching the
 * model's own documented design exactly — this validator does not
 * invent a required-field rule the model doesn't have.
 *
 * effectiveFrom/effectiveTo ordering is NOT re-validated here — the
 * model's own pre("validate") hook already enforces
 * `effectiveTo > effectiveFrom` and a violation already surfaces as a
 * clean 422 VALIDATION_ERROR via the existing global errorHandler
 * (confirmed: errorHandler.js maps mongoose.Error.ValidationError to
 * 422). Duplicating that check here would be redundant, not safer.
 */

import Joi from "joi";
import { PRIORITY, SUPPORTED_LANGUAGES, REQUESTER_TYPE } from "../constants/support.constants.js";

const objectId = Joi.string().hex().length(24);

const baseFields = {
  name: Joi.string().trim().min(1).max(200),
  description: Joi.string().trim().max(1000).allow(null),
  isActive: Joi.boolean(),
  rulePriority: Joi.number().integer(),
  effectiveFrom: Joi.date().allow(null),
  effectiveTo: Joi.date().allow(null),
  countryRef: objectId.allow(null),
  stateRef: objectId.allow(null),
  districtRef: objectId.allow(null),
  cityRef: objectId.allow(null),
  areaRef: objectId.allow(null),
  categoryRefs: Joi.array().items(objectId),
  priorities: Joi.array().items(Joi.string().valid(...Object.values(PRIORITY))),
  languages: Joi.array().items(Joi.string().valid(...SUPPORTED_LANGUAGES)),
  requesterTypes: Joi.array().items(Joi.string().valid(...Object.values(REQUESTER_TYPE))),
  targetQueueRef: objectId.allow(null),
  targetTeamRef: objectId.allow(null),
};

export const supportRoutingRuleConfigSchemas = {
  create: Joi.object({
    ...baseFields,
    name: baseFields.name.required().messages({
      "any.required": "name is required",
      "string.empty": "name is required",
    }),
    description: baseFields.description.default(null),
    isActive: baseFields.isActive.default(true),
    rulePriority: baseFields.rulePriority.default(0),
    effectiveFrom: baseFields.effectiveFrom.default(null),
    effectiveTo: baseFields.effectiveTo.default(null),
    countryRef: baseFields.countryRef.default(null),
    stateRef: baseFields.stateRef.default(null),
    districtRef: baseFields.districtRef.default(null),
    cityRef: baseFields.cityRef.default(null),
    areaRef: baseFields.areaRef.default(null),
    categoryRefs: baseFields.categoryRefs.default([]),
    priorities: baseFields.priorities.default([]),
    languages: baseFields.languages.default([]),
    requesterTypes: baseFields.requesterTypes.default([]),
    targetQueueRef: baseFields.targetQueueRef.default(null),
    targetTeamRef: baseFields.targetTeamRef.default(null),
  }).unknown(false),

  update: Joi.object(baseFields).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
