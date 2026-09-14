/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminCommercialTerritory.validator.js
 *
 * FA-5.2 — same Joi conventions as adminCommercialPolicy.validator.js:
 * shared `objectId` primitive, `.unknown(false)`, explicit
 * `.forbidden()` on every server-controlled field so this project's
 * `stripUnknown:true` Joi config can't silently swallow a client's
 * attempt to inject one.
 *
 * endReason on the vacate-partner endpoint deliberately accepts only
 * PARTNER_EXIT/ADMIN_REASSIGNED — TERRITORY_RETIRED is server-only,
 * set exclusively by commercialTerritory.service.js#retireTerritory's
 * auto-vacate step and never a client-selectable value here.
 */

import Joi from "joi";
import {
  TERRITORY_SCOPE_TYPE,
  TERRITORY_STATUS,
  ASSIGNMENT_END_REASON,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
} from "../constants/commercialTerritory.constants.js";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  code: Joi.any().forbidden(),
  scopeKey: Joi.any().forbidden(),
  status: Joi.any().forbidden(),
  stateRef: Joi.any().forbidden(),
  currentAssignmentRef: Joi.any().forbidden(),
  createdBy: Joi.any().forbidden(),
  updatedBy: Joi.any().forbidden(),
};

const uniqueAreaRefs = Joi.array()
  .items(objectId)
  .min(1)
  .max(200)
  .custom((value, helpers) => {
    const seen = new Set();
    for (const id of value) {
      if (seen.has(id)) return helpers.error("array.unique");
      seen.add(id);
    }
    return value;
  }, "unique areaRefs")
  .messages({ "array.unique": "areaRefs must not contain duplicates" });

export const adminCommercialTerritorySchemas = {
  createTerritory: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    scopeType: Joi.string().valid(...Object.values(TERRITORY_SCOPE_TYPE)).required(),
    districtRef: objectId.required(),
    cityRef: Joi.when("scopeType", {
      is: TERRITORY_SCOPE_TYPE.DISTRICT,
      then: Joi.any().forbidden(),
      otherwise: objectId.required(),
    }),
    areaRefs: Joi.when("scopeType", {
      is: TERRITORY_SCOPE_TYPE.AREA_SET,
      then: uniqueAreaRefs.required(),
      otherwise: Joi.any().forbidden(),
    }),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateTerritory: Joi.object({
    name: Joi.string().trim().min(2).max(100).optional(),
    scopeType: Joi.string().valid(...Object.values(TERRITORY_SCOPE_TYPE)).optional(),
    districtRef: objectId.optional(),
    cityRef: objectId.optional(),
    areaRefs: uniqueAreaRefs.optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  territoryIdParam: Joi.object({ territoryId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    status: Joi.string().valid(...Object.values(TERRITORY_STATUS)).optional(),
  }).unknown(false),

  assignPartnerBody: Joi.object({
    fieldAgentId: objectId.required(),
    assignedBy: Joi.any().forbidden(),
    effectiveFrom: Joi.any().forbidden(),
  }).unknown(false),

  vacatePartnerBody: Joi.object({
    endReason: Joi.string().valid(ASSIGNMENT_END_REASON.PARTNER_EXIT, ASSIGNMENT_END_REASON.ADMIN_REASSIGNED).required(),
    endedBy: Joi.any().forbidden(),
    effectiveUntil: Joi.any().forbidden(),
  }).unknown(false),
};
