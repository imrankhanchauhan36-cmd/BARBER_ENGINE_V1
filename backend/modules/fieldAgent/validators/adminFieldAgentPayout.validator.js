/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentPayout.validator.js
 *
 * FA-14 — Admin-facing Field Agent payout approval/rejection/manual-
 * payout-recording validators. `.unknown(false)` structurally rejects
 * any client-supplied fieldAgentRef/amountInPaise/status/bankSnapshot
 * — the admin can only act on an existing request's lifecycle, never
 * redefine its financial content.
 */

import Joi from "joi";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";
import { FIELD_AGENT_PAYOUT_STATUS } from "../models/FieldAgentPayoutRequest.js";

export const adminFieldAgentPayoutSchemas = {
  listPayoutsQuery: Joi.object({
    page:   Joi.number().integer().min(1).default(1),
    limit:  Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    // FA-P4-C Step 2 — a single status (unchanged) OR a comma-separated
    // list, so the admin queue's "Processing" tab can load REQUESTED and
    // PROCESSING together. Additive: single-value callers are unaffected.
    status: Joi.string()
      .pattern(new RegExp(`^(${Object.values(FIELD_AGENT_PAYOUT_STATUS).join("|")})(,(${Object.values(FIELD_AGENT_PAYOUT_STATUS).join("|")}))*$`))
      .optional(),
  }).unknown(false),

  payoutIdParam: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }).unknown(false),

  rejectPayout: Joi.object({
    reason: Joi.string().trim().min(1).max(500).required(),
  }).unknown(false),

  recordManualPayoutResult: Joi.object({
    success:       Joi.boolean().required(),
    utr:           Joi.string().trim().min(1).max(100).when("success", { is: true, then: Joi.required(), otherwise: Joi.forbidden() }),
    failureReason: Joi.string().trim().min(1).max(500).when("success", { is: false, then: Joi.required(), otherwise: Joi.forbidden() }),
  }).unknown(false),
};
