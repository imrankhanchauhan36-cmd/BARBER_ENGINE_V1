/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminRevenueConfig.validator.js
 *
 * FA-P3-A — Revenue Configuration Engine, Phase 1. Same Joi
 * conventions as adminCommercialPolicy.validator.js (`.unknown(false)`,
 * shared objectId primitive). Rupee-facing fields here (acquisitionReward,
 * minimumPayout) are converted to paise at the SERVICE boundary, not
 * here — this validator only bounds-checks the rupee values the admin
 * panel actually sends.
 */

import Joi from "joi";
import { TERRITORY_COMMISSION_PERCENT_MIN, TERRITORY_COMMISSION_PERCENT_MAX, MINIMUM_PAYOUT_MIN_PAISE, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/commercialPolicy.constants.js";

const objectId = Joi.string().hex().length(24);

export const adminRevenueConfigSchemas = {
  updateSettings: Joi.object({
    acquisitionReward: Joi.number().min(0),
    recoveryPercentage: Joi.number().min(TERRITORY_COMMISSION_PERCENT_MIN).max(TERRITORY_COMMISSION_PERCENT_MAX),
    minimumPayout: Joi.number().min(MINIMUM_PAYOUT_MIN_PAISE / 100),
    autoPayoutEnabled: Joi.boolean(),
  })
    .min(1)
    .unknown(false),

  listTerritoriesQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  }).unknown(false),

  territoryIdParam: Joi.object({ id: objectId.required() }).unknown(false),

  updateTerritory: Joi.object({
    territoryPercent: Joi.number().min(TERRITORY_COMMISSION_PERCENT_MIN).max(TERRITORY_COMMISSION_PERCENT_MAX).required(),
  }).unknown(false),
};
