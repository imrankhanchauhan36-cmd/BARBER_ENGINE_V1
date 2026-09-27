/**
 * BARBER ENGINE V1
 * backend/modules/finance/validators/adminTerritoryRevenue.validator.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine. Same conventions as
 * adminRevenueSettings.validator.js: `.unknown(false)`, an explicit
 * `.forbidden()` on every server-controlled field so this project's
 * stripUnknown:true Joi config can never silently swallow a client's
 * attempt to inject one, request body minimumPayout in RUPEES
 * (converted to paise at the controller boundary — see the controller).
 */

import Joi from "joi";
import {
  TERRITORY_COMMISSION_MIN_PERCENT,
  TERRITORY_COMMISSION_MAX_PERCENT,
  TERRITORY_MINIMUM_PAYOUT_MIN_PAISE,
} from "../constants/territoryRevenue.constants.js";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  status: Joi.any().forbidden(),
  version: Joi.any().forbidden(),
  createdBy: Joi.any().forbidden(),
  publishedBy: Joi.any().forbidden(),
  retiredBy: Joi.any().forbidden(),
  publishedAt: Joi.any().forbidden(),
  retiredAt: Joi.any().forbidden(),
};

const territoryCommissionPercent = Joi.number()
  .min(TERRITORY_COMMISSION_MIN_PERCENT)
  .max(TERRITORY_COMMISSION_MAX_PERCENT);
const minimumPayout = Joi.number().min(TERRITORY_MINIMUM_PAYOUT_MIN_PAISE / 100).precision(2);

export const adminTerritoryRevenueSchemas = {
  createDraft: Joi.object({
    territoryCommissionPercent: territoryCommissionPercent.required(),
    minimumPayout: minimumPayout.required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateDraft: Joi.object({
    territoryCommissionPercent: territoryCommissionPercent.optional(),
    minimumPayout: minimumPayout.optional(),
    ...forbiddenServerControlledFields,
  }).min(1).unknown(false),

  idParam: Joi.object({ id: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};
