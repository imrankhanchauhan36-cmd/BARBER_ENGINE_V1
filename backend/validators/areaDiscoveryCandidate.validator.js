/**
 * BARBER ENGINE V1
 * backend/validators/areaDiscoveryCandidate.validator.js
 *
 * AREA-2.5.1 — same Joi conventions as areaServiceability.validator.js
 * / adminFieldAgentApproval.validator.js: shared `objectId` primitive,
 * `.unknown(false)`, explicit `.forbidden()` for every server-controlled
 * field.
 */

import Joi from "joi";
import { CANDIDATE_SOURCE_TYPES_ACCEPTED_V1 } from "../models/AreaDiscoveryCandidate.js";

const objectId = Joi.string().hex().length(24);

const coordinate = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
}).unknown(false);

const forbiddenServerControlledFields = {
  _id:                     Joi.any().forbidden(),
  normalizedCandidateName: Joi.any().forbidden(),
  districtRef:             Joi.any().forbidden(),
  stateRef:                Joi.any().forbidden(),
  observationCount:        Joi.any().forbidden(),
  firstSeenAt:             Joi.any().forbidden(),
  lastSeenAt:              Joi.any().forbidden(),
  confidence:              Joi.any().forbidden(),
  status:                  Joi.any().forbidden(),
  matchedAreaRef:          Joi.any().forbidden(),
  reviewedBy:              Joi.any().forbidden(),
  reviewedAt:              Joi.any().forbidden(),
  createdAt:               Joi.any().forbidden(),
  updatedAt:               Joi.any().forbidden(),
};

export const areaDiscoveryCandidateSchemas = {
  candidateIdParam: Joi.object({ candidateId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    cityId: objectId,
    status: Joi.string().valid("OBSERVED", "APPROVED", "REJECTED", "MERGED"),
    page:   Joi.number().integer().min(1),
    limit:  Joi.number().integer().min(1).max(100),
  }).unknown(false),

  // Record/aggregate an observation. Only ADMIN/BATCH are accepted in
  // this phase — SALON_ONBOARDING/SALON_UPDATE exist in the model
  // enum for a future integration phase, not reachable here.
  observeBody: Joi.object({
    name:   Joi.string().trim().min(1).max(200).required(),
    cityId: objectId.required(),
    sourceType: Joi.string().valid(...CANDIDATE_SOURCE_TYPES_ACCEPTED_V1).required(),
    sourceReference: objectId, // optional, single opaque reference for this observation
    coordinate, // optional single {lat,lng} for this observation
    ...forbiddenServerControlledFields,
  }).unknown(false),

  reviewBody: Joi.object({
    targetStatus: Joi.string().valid("APPROVED", "REJECTED", "MERGED").required(),
    reviewNotes:  Joi.string().trim().min(1).max(500).required(),
    matchedAreaId: Joi.when("targetStatus", { is: "MERGED", then: objectId.required(), otherwise: Joi.forbidden() }),
    ...forbiddenServerControlledFields,
  }).unknown(false),
};

