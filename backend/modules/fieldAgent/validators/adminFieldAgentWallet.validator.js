/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentWallet.validator.js
 *
 * STEP 2.4 — Admin Field Agent Wallet & Payout APIs. Validation only —
 * no business logic. `.unknown(false)` per this project's standing
 * convention (see e.g. adminFieldAgentSummary.validator.js). One
 * shared schema — both GET /:id/wallet and GET /:id/payouts take the
 * identical single :id param.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const adminFieldAgentWalletSchemas = {
  fieldAgentIdParam: Joi.object({
    id: objectId.required(),
  }).unknown(false),
};
