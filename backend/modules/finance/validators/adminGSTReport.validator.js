/**
 * BARBER ENGINE V1
 * backend/modules/finance/validators/adminGSTReport.validator.js
 *
 * P0 Revenue Calculation Engine — Step 4.3. Read-only endpoints — every
 * schema here validates query params only, `.unknown(false)` per this
 * project's standing convention.
 */

import Joi from "joi";

const YEAR_MIN = 2020;
const YEAR_MAX = 2100;

export const adminGSTReportSchemas = {
  monthlyQuery: Joi.object({
    year: Joi.number().integer().min(YEAR_MIN).max(YEAR_MAX).required(),
  }).unknown(false),

  exportQuery: Joi.object({
    month: Joi.number().integer().min(1).max(12).required(),
    year: Joi.number().integer().min(YEAR_MIN).max(YEAR_MAX).required(),
  }).unknown(false),
};
