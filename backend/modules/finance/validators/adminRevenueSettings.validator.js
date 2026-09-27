/**
 * BARBER ENGINE V1
 * backend/modules/finance/validators/adminRevenueSettings.validator.js
 *
 * P0 Revenue Calculation Engine — Step 2. Same conventions as
 * backend/validators/adminFinancePolicy.validator.js (GST/Platform Fee):
 * `.unknown(false)`, an explicit `.forbidden()` on every server-controlled
 * field so this project's stripUnknown:true Joi config can never silently
 * swallow a client's attempt to inject one, request bodies in RUPEES
 * (converted to paise at the controller boundary — see the controller).
 */

import Joi from "joi";
import {
  PLATFORM_FEE_MIN_PAISE,
  GST_RATE_MIN_PERCENT,
  GST_RATE_MAX_PERCENT,
  MINIMUM_PAYOUT_MIN_PAISE,
} from "../constants/revenue.constants.js";

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

const platformFee = Joi.number().min(PLATFORM_FEE_MIN_PAISE / 100).precision(2);
const gstRate = Joi.number().min(GST_RATE_MIN_PERCENT).max(GST_RATE_MAX_PERCENT);
const minimumPayout = Joi.number().min(MINIMUM_PAYOUT_MIN_PAISE / 100).precision(2);

export const adminRevenueSettingsSchemas = {
  createDraft: Joi.object({
    platformFee: platformFee.required(),
    gstRate: gstRate.required(),
    gstEnabled: Joi.boolean().default(true),
    minimumPayout: minimumPayout.required(),
    autoPayoutEnabled: Joi.boolean().default(false),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateDraft: Joi.object({
    platformFee: platformFee.optional(),
    gstRate: gstRate.optional(),
    gstEnabled: Joi.boolean().optional(),
    minimumPayout: minimumPayout.optional(),
    autoPayoutEnabled: Joi.boolean().optional(),
    ...forbiddenServerControlledFields,
  }).min(1).unknown(false),

  versionIdParam: Joi.object({ versionId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};
