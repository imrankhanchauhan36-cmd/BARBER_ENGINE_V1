/**
 * BARBER ENGINE V1
 * backend/validators/areaServiceability.validator.js
 *
 * AREA-2.4.1 — same Joi conventions as
 * modules/fieldAgent/validators/adminFieldAgentApproval.validator.js:
 * shared `objectId` primitive, `.unknown(false)` (rejects any
 * unexpected field outright with a 400, rather than this project's
 * `validate` middleware silently stripUnknown-ing it), and explicit
 * `.forbidden()` declarations for every server-controlled field so an
 * injection attempt produces a clear validation error.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  areaRef:        Joi.any().forbidden(),
  status:         Joi.any().forbidden(),
  updatedBy:      Joi.any().forbidden(),
  createdAt:      Joi.any().forbidden(),
  updatedAt:      Joi.any().forbidden(),
  _id:            Joi.any().forbidden(),
};

export const areaServiceabilitySchemas = {
  areaIdParam: Joi.object({ areaId: objectId.required() }).unknown(false),

  // Configure (create) — the only client-controlled inputs are the
  // optional effective window and an optional reason. Status is
  // always server-set to PENDING on creation (the NOT_CONFIGURED →
  // PENDING transition).
  configureBody: Joi.object({
    effectiveFrom:  Joi.date().iso().allow(null),
    effectiveUntil: Joi.date().iso().allow(null),
    reason:         Joi.string().trim().min(1).max(500).allow(null),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  // Transition (update) — targetStatus is the one legitimate business
  // input; everything else server-controlled. Reason is required here
  // (every transition after creation must be explained), matching the
  // stricter bar AREA-2.4 §N sets for serviceability vs plain Area
  // creation.
  transitionBody: Joi.object({
    targetStatus:   Joi.string().valid("ACTIVE", "PAUSED", "RETIRED").required(),
    reason:         Joi.string().trim().min(1).max(500).required(),
    effectiveFrom:  Joi.date().iso().allow(null),
    effectiveUntil: Joi.date().iso().allow(null),
    ...forbiddenServerControlledFields,
  }).unknown(false),
};
