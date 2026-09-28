/**
 * BARBER ENGINE V1
 * backend/validators/adminCustomerWallet.validator.js
 *
 * STEP 5.5B — Admin Customer Wallet API. Validation only — no
 * business logic. `.unknown(false)` per this project's standing
 * convention. Mirrors adminCustomerBookings.validator.js (STEP 5.2B)
 * / adminCustomerReviews.validator.js (STEP 5.5A) exactly.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminCustomerWalletSchemas = {
  customerIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
