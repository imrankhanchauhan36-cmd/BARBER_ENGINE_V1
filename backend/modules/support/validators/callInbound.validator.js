/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/callInbound.validator.js
 *
 * Phase H — Call Support (inbound). Validates the NORMALIZED payload
 * shape (after callInbound.devAdapter.js — or a future real-provider
 * adapter — has already parsed the raw webhook body) — same Joi
 * conventions as every other Support validator (`.unknown(false)`,
 * per-field `.messages()`). Sibling of emailInbound.validator.js /
 * whatsappInbound.validator.js.
 *
 * eventType is intentionally a free-form string, not a strict enum,
 * at the validator layer — callInbound.service.js is what interprets
 * recognized values; an unrecognized eventType from a future real
 * provider should be recorded (for reconciliation) rather than
 * rejected outright by validation.
 */

import Joi from "joi";

export const callInboundSchemas = {
  ingest: Joi.object({
    providerEventId: Joi.string().trim().min(1).max(300).required().messages({
      "any.required": "providerEventId is required",
    }),
    providerCallId: Joi.string().trim().min(1).max(300).required().messages({
      "any.required": "providerCallId is required",
    }),
    eventType: Joi.string().trim().max(50).required().messages({
      "any.required": "eventType is required",
    }),
    fromPhoneNumber: Joi.string().trim().min(1).max(20).required().messages({
      "any.required": "fromPhoneNumber is required",
    }),
    toPhoneNumber: Joi.string().trim().max(20).allow(null, "").default(null),
    durationSeconds: Joi.number().integer().min(0).allow(null).default(null),
  }).unknown(false),
};
