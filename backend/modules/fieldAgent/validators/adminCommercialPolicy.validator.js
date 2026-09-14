/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminCommercialPolicy.validator.js
 *
 * FA-5.1 — CommercialPolicyVersion admin authoring validation. Same
 * Joi conventions as testContent.validator.js (shared `objectId`
 * primitive, `.unknown(false)`, explicit `.forbidden()` on every
 * server-controlled field so this project's `stripUnknown:true` Joi
 * config can't silently swallow a client's attempt to inject one —
 * see that file's own header for the precedent).
 */

import Joi from "joi";
import {
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  ACQUISITION_INCENTIVE_MIN_PAISE,
  TERRITORY_COMMISSION_PERCENT_MIN,
  TERRITORY_COMMISSION_PERCENT_MAX,
  LICENSE_TERM_MONTHS_MIN,
  CLAIM_EXPIRY_DAYS_MIN,
  POLICY_ITEM_KEY_MAX_LENGTH,
  POLICY_ITEM_DESCRIPTION_MAX_LENGTH,
  MAX_POLICY_ITEMS_PER_LIST,
} from "../constants/commercialPolicy.constants.js";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  versionNumber: Joi.any().forbidden(),
  status: Joi.any().forbidden(),
  createdBy: Joi.any().forbidden(),
  publishedBy: Joi.any().forbidden(),
  retiredBy: Joi.any().forbidden(),
  publishedAt: Joi.any().forbidden(),
  retiredAt: Joi.any().forbidden(),
};

const policyItemSchema = Joi.object({
  key: Joi.string().trim().min(1).max(POLICY_ITEM_KEY_MAX_LENGTH).required(),
  description: Joi.string().trim().min(1).max(POLICY_ITEM_DESCRIPTION_MAX_LENGTH).required(),
}).unknown(false);

const policyItemListSchema = Joi.array().items(policyItemSchema).max(MAX_POLICY_ITEMS_PER_LIST);

const policyBusinessFields = {
  acquisitionIncentiveAmountInPaise: Joi.number().integer().min(ACQUISITION_INCENTIVE_MIN_PAISE),
  // FA-8 — mirrors territoryPartnerCommissionPercent's own semantics
  // exactly (decimal allowed, same 0-100 bound, reusing the identical
  // constants rather than duplicating them with the same values).
  acquisitionAgentCommissionPercent: Joi.number()
    .min(TERRITORY_COMMISSION_PERCENT_MIN)
    .max(TERRITORY_COMMISSION_PERCENT_MAX),
  // FA-8 — the nationally configured cumulative acquisition earning
  // target/cap per salon, in paise. No business maximum is invented
  // here — only the structural (non-negative, integer) bound.
  acquisitionEarningTargetInPaise: Joi.number().integer().min(ACQUISITION_INCENTIVE_MIN_PAISE),
  territoryPartnerCommissionPercent: Joi.number()
    .min(TERRITORY_COMMISSION_PERCENT_MIN)
    .max(TERRITORY_COMMISSION_PERCENT_MAX),
  licenseTermMonths: Joi.number().integer().min(LICENSE_TERM_MONTHS_MIN),
  claimExpiryDays: Joi.number().integer().min(CLAIM_EXPIRY_DAYS_MIN),
  obligations: policyItemListSchema,
  performanceFactors: policyItemListSchema,
  coverageRules: policyItemListSchema,
};

export const adminCommercialPolicySchemas = {
  createVersion: Joi.object({
    // FA-8 — now optional at creation (RESERVED, no longer required —
    // see CommercialPolicyVersion.js's own field comment for why).
    acquisitionIncentiveAmountInPaise: policyBusinessFields.acquisitionIncentiveAmountInPaise.optional(),
    acquisitionAgentCommissionPercent: policyBusinessFields.acquisitionAgentCommissionPercent.required(),
    acquisitionEarningTargetInPaise: policyBusinessFields.acquisitionEarningTargetInPaise.required(),
    territoryPartnerCommissionPercent: policyBusinessFields.territoryPartnerCommissionPercent.required(),
    licenseTermMonths: policyBusinessFields.licenseTermMonths.required(),
    claimExpiryDays: policyBusinessFields.claimExpiryDays.required(),
    obligations: policyBusinessFields.obligations.optional(),
    performanceFactors: policyBusinessFields.performanceFactors.optional(),
    coverageRules: policyBusinessFields.coverageRules.optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateVersion: Joi.object({
    acquisitionIncentiveAmountInPaise: policyBusinessFields.acquisitionIncentiveAmountInPaise.optional(),
    acquisitionAgentCommissionPercent: policyBusinessFields.acquisitionAgentCommissionPercent.optional(),
    acquisitionEarningTargetInPaise: policyBusinessFields.acquisitionEarningTargetInPaise.optional(),
    territoryPartnerCommissionPercent: policyBusinessFields.territoryPartnerCommissionPercent.optional(),
    licenseTermMonths: policyBusinessFields.licenseTermMonths.optional(),
    claimExpiryDays: policyBusinessFields.claimExpiryDays.optional(),
    obligations: policyBusinessFields.obligations.optional(),
    performanceFactors: policyBusinessFields.performanceFactors.optional(),
    coverageRules: policyBusinessFields.coverageRules.optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  retireVersion: Joi.object({
    reason: Joi.string().trim().max(500).allow(null, ""),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  versionIdParam: Joi.object({ versionId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  }).unknown(false),
};
