/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/fieldAgentPayout.validator.js
 *
 * FA-14 — Field-Agent-facing withdrawal request validators.
 * `.unknown(false)` structurally rejects any client-supplied
 * fieldAgentRef/userId/agentId/bankSnapshot/status field outright —
 * every one of those is server-derived only (see the service file).
 */

import Joi from "joi";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";
import { FIELD_AGENT_PAYOUT_STATUS } from "../models/FieldAgentPayoutRequest.js";

export const fieldAgentPayoutSchemas = {
  createWithdrawal: Joi.object({
    amountInPaise:  Joi.number().integer().min(1).required(),
    idempotencyKey: Joi.string().trim().min(1).max(200).required(),
  }).unknown(false),

  listMyPayoutsQuery: Joi.object({
    page:   Joi.number().integer().min(1).default(1),
    limit:  Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    status: Joi.string().valid(...Object.values(FIELD_AGENT_PAYOUT_STATUS)).optional(),
  }).unknown(false),

  payoutIdParam: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }).unknown(false),
};
