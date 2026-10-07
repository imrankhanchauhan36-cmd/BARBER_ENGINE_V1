/**
 * BARBER ENGINE V1
 * backend/modules/finance/validators/adminRefundPolicy.validator.js
 *
 * Global Refund & Cancellation Policy. Same conventions as every
 * sibling finance policy validator: `.unknown(false)`, an explicit
 * `.forbidden()` on every server-controlled field so this project's
 * stripUnknown:true Joi config can never silently swallow a client's
 * attempt to inject one. Full gap/overlap/boundary validation happens
 * in RefundPolicyService.js — this layer only enforces basic shape.
 */

import Joi from "joi";
import { CANCELLATION_PERCENT_MIN, CANCELLATION_PERCENT_MAX, REFUND_POLICY_MAX_RULES } from "../constants/refundPolicy.constants.js";

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

// cancellationPercent — the CANCELLATION/RETENTION percentage (what is
// forfeited), NOT the customer refund percentage. See
// RefundPolicyVersion.js's own header for the full rationale.
const ruleItemSchema = Joi.object({
  minMinutes: Joi.number().integer().min(0).required(),
  maxMinutes: Joi.number().integer().min(0).allow(null).required(),
  cancellationPercent: Joi.number().integer().min(CANCELLATION_PERCENT_MIN).max(CANCELLATION_PERCENT_MAX).required(),
}).unknown(false);

const rules = Joi.array().items(ruleItemSchema).min(1).max(REFUND_POLICY_MAX_RULES);

export const adminRefundPolicySchemas = {
  createDraft: Joi.object({
    rules: rules.required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateDraft: Joi.object({
    rules: rules.required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  idParam: Joi.object({ id: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};
