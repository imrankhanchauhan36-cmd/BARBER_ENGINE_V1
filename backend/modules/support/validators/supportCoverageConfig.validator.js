/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportCoverageConfig.validator.js
 *
 * Phase H Step 8 (Step 5) — Support Configuration Management:
 * Coverage. Same Joi conventions as every other Support validator.
 *
 * Deliberately does NOT re-validate the scope-level geo consistency
 * rule ("exactly the refs at-and-above scopeLevel must be set, every
 * ref below must stay null") or the effectiveFrom/effectiveTo
 * ordering — SupportCoverage.js's own two pre("validate") hooks
 * already enforce both, and a violation already surfaces as a clean
 * 422 VALIDATION_ERROR via the existing global errorHandler. This
 * validator only narrows types/shape; the model remains the sole
 * authority on those two business rules, per "do not redesign the
 * coverage model."
 */

import Joi from "joi";
import { SCOPE_LEVEL, FALLBACK_BEHAVIOR, PRIORITY } from "../constants/support.constants.js";

const objectId = Joi.string().hex().length(24);

const baseFields = {
  scopeLevel: Joi.string().valid(...Object.values(SCOPE_LEVEL)),
  countryRef: objectId.allow(null),
  stateRef: objectId.allow(null),
  districtRef: objectId.allow(null),
  cityRef: objectId.allow(null),
  areaRef: objectId.allow(null),
  categoryRefs: Joi.array().items(objectId),
  priorities: Joi.array().items(Joi.string().valid(...Object.values(PRIORITY))),
  isActive: Joi.boolean(),
  effectiveFrom: Joi.date().allow(null),
  effectiveTo: Joi.date().allow(null),
  targetQueueRef: objectId.allow(null),
  targetTeamRef: objectId.allow(null),
  selectionPriority: Joi.number().integer(),
  fallbackBehavior: Joi.string().valid(...Object.values(FALLBACK_BEHAVIOR)),
};

export const supportCoverageConfigSchemas = {
  create: Joi.object({
    ...baseFields,
    scopeLevel: baseFields.scopeLevel.required().messages({
      "any.required": "scopeLevel is required",
    }),
    countryRef: baseFields.countryRef.default(null),
    stateRef: baseFields.stateRef.default(null),
    districtRef: baseFields.districtRef.default(null),
    cityRef: baseFields.cityRef.default(null),
    areaRef: baseFields.areaRef.default(null),
    categoryRefs: baseFields.categoryRefs.default([]),
    priorities: baseFields.priorities.default([]),
    isActive: baseFields.isActive.default(true),
    effectiveFrom: baseFields.effectiveFrom.default(null),
    effectiveTo: baseFields.effectiveTo.default(null),
    targetQueueRef: baseFields.targetQueueRef.default(null),
    targetTeamRef: baseFields.targetTeamRef.default(null),
    selectionPriority: baseFields.selectionPriority.default(0),
    fallbackBehavior: baseFields.fallbackBehavior.default(FALLBACK_BEHAVIOR.CONTINUE_TO_PARENT),
  }).unknown(false),

  // scopeLevel is intentionally NOT editable — changing it would
  // require simultaneously changing which geo refs are legal (the
  // model's own consistency hook), which is really "replace this row,"
  // not "update" it. Matches the same "identity field frozen after
  // creation" precedent as Agent email/phone.
  update: Joi.object({
    ...baseFields,
    scopeLevel: Joi.forbidden(),
  }).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
