/**
 * BARBER ENGINE V1
 * backend/modules/finance/validators/adminFinanceExport.validator.js
 *
 * STEP 7.4 — Finance Export Engine. Read-only endpoints — every schema
 * here validates query params only, `.unknown(false)` per this
 * project's standing convention.
 */

import Joi from "joi";

export const adminFinanceExportSchemas = {
  exportQuery: Joi.object({
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().optional(),
    format: Joi.string().valid("xlsx", "csv", "pdf", "json", "XLSX", "CSV", "PDF", "JSON").default("json"),
  }).unknown(false),
};
