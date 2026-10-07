/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentGeography.validator.js
 *
 * Field Agent Geography Phase B — same Joi conventions as
 * adminFieldAgentSummary.validator.js / acquisitionClaim.validator.js:
 * shared `objectId` primitive, `.unknown(false)` on every schema.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminFieldAgentGeographySchemas = {
  fieldAgentIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),

  assignBody: Joi.object({
    stateRef: objectId.required(),
    districtRef: objectId.allow(null).optional(),
  }).unknown(false),

  endBody: Joi.object({
    endReason: Joi.string().trim().max(300).allow(null, "").optional(),
  }).unknown(false),
};
