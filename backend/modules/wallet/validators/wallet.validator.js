/**
 * BARBER ENGINE V1
 * backend/modules/wallet/validators/wallet.validator.js
 *
 * STEP 6.5A — HTTP API Exposure. Validation only — no business logic.
 * `.unknown(false)` per this project's standing convention.
 */

import Joi from "joi";

export const walletSchemas = {
  paginationQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),

  requestPayoutBody: Joi.object({
    amountInPaise: Joi.number().integer().min(1).required(),
    idempotencyKey: Joi.string().max(200).optional(),
  }).unknown(false),
};
