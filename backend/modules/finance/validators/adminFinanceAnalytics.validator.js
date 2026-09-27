/**
 * BARBER ENGINE V1
 * backend/modules/finance/validators/adminFinanceAnalytics.validator.js
 *
 * STEP 7.2 — Finance Analytics Engine. Read-only endpoints — every
 * schema here validates query params only, `.unknown(false)` per this
 * project's standing convention.
 */

import Joi from "joi";

export const adminFinanceAnalyticsSchemas = {
  dailyQuery: Joi.object({
    days: Joi.number().integer().min(1).max(365).default(30),
  }).unknown(false),

  monthlyQuery: Joi.object({
    months: Joi.number().integer().min(1).max(60).default(12),
  }).unknown(false),

  trendQuery: Joi.object({
    granularity: Joi.string().valid("daily", "monthly").default("monthly"),
    days: Joi.number().integer().min(1).max(365).default(30),
    months: Joi.number().integer().min(1).max(60).default(12),
  }).unknown(false),
};
