/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/whatsappInbound.validator.js
 *
 * Phase H — WhatsApp Support (inbound). Validates the NORMALIZED
 * payload shape (after whatsappInbound.devAdapter.js — or a future
 * real-provider adapter — has already parsed the raw webhook body) —
 * same Joi conventions as every other Support validator
 * (`.unknown(false)`, per-field `.messages()`). Sibling of
 * emailInbound.validator.js.
 *
 * Does not weaken SupportMessage/SupportTicket's own existing
 * constraints (body maxlength 5000, subject maxlength 200) — this
 * validator's textBody upper bound is deliberately generous, matching
 * emailInbound.validator.js's own reasoning: graceful truncation, not
 * whole-webhook rejection, is whatsappInbound.service.js's job. In
 * practice a WhatsApp text message is capped well under 5000
 * characters by the provider itself, so truncation is a defensive
 * measure here, not an expected path.
 */

import Joi from "joi";

export const whatsappInboundSchemas = {
  ingest: Joi.object({
    providerEventId: Joi.string().trim().min(1).max(300).required().messages({
      "any.required": "providerEventId is required",
    }),
    contextMessageId: Joi.string().trim().max(300).allow(null, "").default(null),
    fromPhoneNumber: Joi.string().trim().min(1).max(20).required().messages({
      "any.required": "fromPhoneNumber is required",
    }),
    toPhoneNumber: Joi.string().trim().max(20).allow(null, "").default(null),
    textBody: Joi.string().min(1).max(5000).required().messages({
      "any.required": "textBody is required",
    }),
  }).unknown(false),
};
