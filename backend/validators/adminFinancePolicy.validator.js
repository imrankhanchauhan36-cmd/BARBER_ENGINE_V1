/**
 * BARBER ENGINE V1
 * backend/validators/adminFinancePolicy.validator.js
 *
 * PAN-India GST + Area Platform Fee admin authoring validation. Same
 * conventions as
 * modules/fieldAgent/validators/adminCommercialPolicy.validator.js:
 * shared `objectId` primitive, `.unknown(false)`, explicit
 * `.forbidden()` on every server-controlled field so this project's
 * `stripUnknown:true` Joi config can't silently swallow a client's
 * attempt to inject one.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  status: Joi.any().forbidden(),
  createdBy: Joi.any().forbidden(),
  publishedBy: Joi.any().forbidden(),
  retiredBy: Joi.any().forbidden(),
  publishedAt: Joi.any().forbidden(),
  retiredAt: Joi.any().forbidden(),
};

export const gstPolicySchemas = {
  createDraft: Joi.object({
    ratePercent: Joi.number().min(0).max(100).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateDraft: Joi.object({
    ratePercent: Joi.number().min(0).max(100).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  versionIdParam: Joi.object({ versionId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};

export const areaPlatformFeeSchemas = {
  createDraft: Joi.object({
    areaRef: objectId.required(),
    feeInPaise: Joi.number().integer().min(0).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateDraft: Joi.object({
    feeInPaise: Joi.number().integer().min(0).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  policyIdParam: Joi.object({ policyId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    areaRef: objectId.optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};
