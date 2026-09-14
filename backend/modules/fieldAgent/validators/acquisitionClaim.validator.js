/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/acquisitionClaim.validator.js
 *
 * FA-5.3 — same Joi conventions as adminCommercialTerritory.validator.js:
 * shared `objectId` primitive, `.unknown(false)`, explicit `.forbidden()`
 * on every identity/derived field so this project's `stripUnknown:true`
 * Joi config can't silently swallow a client's attempt to inject one.
 *
 * No schema here ever accepts salonRef/fieldAgentRef/ownerId as a
 * client-suppliable field — redeemBody only accepts a referralCode;
 * salonRef and fieldAgentRef are always resolved server-side (locked
 * decision).
 */

import Joi from "joi";
import { CLAIM_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";

const objectId = Joi.string().hex().length(24);

export const acquisitionClaimSchemas = {
  referralIdParam: Joi.object({ referralId: objectId.required() }).unknown(false),

  claimIdParam: Joi.object({ claimId: objectId.required() }).unknown(false),

  listReferralsQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  }).unknown(false),

  listClaimsQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  }).unknown(false),

  redeemBody: Joi.object({
    referralCode: Joi.string().trim().min(4).max(40).required(),
    salonId: Joi.any().forbidden(),
    salonRef: Joi.any().forbidden(),
    fieldAgentRef: Joi.any().forbidden(),
    ownerId: Joi.any().forbidden(),
  }).unknown(false),

  adminListQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    status: Joi.string().valid(...Object.values(CLAIM_STATUS)).optional(),
  }).unknown(false),
};
