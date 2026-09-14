/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminCommercialPolicyOverride.validator.js
 *
 * FA-9 — CommercialPolicyOverride admin authoring validation. Same Joi
 * conventions as adminCommercialPolicy.validator.js/adminCommercialTerritory.validator.js
 * (`.unknown(false)`, explicit `.forbidden()` on every server-controlled
 * field — scopeKey/stateRef are ALWAYS server-derived, never
 * client-suppliable, same discipline CommercialTerritory's own
 * validator already established).
 */

import Joi from "joi";
import { POLICY_OVERRIDE_SCOPE_TYPE } from "../constants/commercialPolicyOverride.constants.js";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/commercialPolicyOverride.constants.js";
import {
  ACQUISITION_INCENTIVE_MIN_PAISE,
  TERRITORY_COMMISSION_PERCENT_MIN,
  TERRITORY_COMMISSION_PERCENT_MAX,
} from "../constants/commercialPolicy.constants.js";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  scopeKey: Joi.any().forbidden(),
  stateRef: Joi.any().forbidden(),
  versionNumber: Joi.any().forbidden(),
  status: Joi.any().forbidden(),
  createdBy: Joi.any().forbidden(),
  publishedBy: Joi.any().forbidden(),
  retiredBy: Joi.any().forbidden(),
  publishedAt: Joi.any().forbidden(),
  retiredAt: Joi.any().forbidden(),
};

const policyBusinessFields = {
  acquisitionAgentCommissionPercent: Joi.number().min(TERRITORY_COMMISSION_PERCENT_MIN).max(TERRITORY_COMMISSION_PERCENT_MAX),
  acquisitionEarningTargetInPaise: Joi.number().integer().min(ACQUISITION_INCENTIVE_MIN_PAISE),
  territoryPartnerCommissionPercent: Joi.number().min(TERRITORY_COMMISSION_PERCENT_MIN).max(TERRITORY_COMMISSION_PERCENT_MAX),
};

export const adminCommercialPolicyOverrideSchemas = {
  createOverride: Joi.object({
    scopeType: Joi.string().valid(...Object.values(POLICY_OVERRIDE_SCOPE_TYPE)).required(),
    districtRef: objectId.required(),
    cityRef: objectId.when("scopeType", { is: POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT, then: Joi.forbidden(), otherwise: Joi.required() }),
    areaRefs: Joi.array()
      .items(objectId)
      .min(1)
      .when("scopeType", { is: POLICY_OVERRIDE_SCOPE_TYPE.AREA_SET, then: Joi.required(), otherwise: Joi.forbidden() }),
    acquisitionAgentCommissionPercent: policyBusinessFields.acquisitionAgentCommissionPercent.required(),
    acquisitionEarningTargetInPaise: policyBusinessFields.acquisitionEarningTargetInPaise.required(),
    territoryPartnerCommissionPercent: policyBusinessFields.territoryPartnerCommissionPercent.required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateOverride: Joi.object({
    acquisitionAgentCommissionPercent: policyBusinessFields.acquisitionAgentCommissionPercent.optional(),
    acquisitionEarningTargetInPaise: policyBusinessFields.acquisitionEarningTargetInPaise.optional(),
    territoryPartnerCommissionPercent: policyBusinessFields.territoryPartnerCommissionPercent.optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  retireOverride: Joi.object({
    reason: Joi.string().trim().max(500).allow(null, ""),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  overrideIdParam: Joi.object({ overrideId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    status: Joi.string().valid("DRAFT", "PUBLISHED", "RETIRED"),
    districtRef: objectId,
  }).unknown(false),
};
