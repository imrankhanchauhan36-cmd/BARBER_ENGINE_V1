/**
 * BARBER ENGINE V1
 * backend/validators/areaDiscoveryResolution.validator.js
 *
 * AREA-2.5.3 — same Joi conventions as every prior validator this
 * lineage (areaServiceability.validator.js, areaDiscoveryCandidate.
 * validator.js): shared `objectId` primitive, `.unknown(false)`,
 * explicit `.forbidden()` for every server-controlled field. A new
 * file — the existing candidate validator is frozen and must not be
 * touched.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const areaDiscoveryResolutionSchemas = {
  candidateIdParam: Joi.object({ candidateId: objectId.required() }).unknown(false),

  resolveSalonBody: Joi.object({
    salonId: objectId.required(),
    // Server-derived exclusively from candidate.matchedAreaRef and the
    // candidate's own stored geography — never accepted from the client.
    areaId:         Joi.any().forbidden(),
    cityRef:        Joi.any().forbidden(),
    districtRef:    Joi.any().forbidden(),
    stateRef:       Joi.any().forbidden(),
    status:         Joi.any().forbidden(),
    matchedAreaRef: Joi.any().forbidden(),
  }).unknown(false),
};
