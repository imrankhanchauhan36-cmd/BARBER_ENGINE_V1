/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/emailInbound.validator.js
 *
 * Phase H Step 9 — Email Support (inbound). Validates the NORMALIZED
 * payload shape (after a provider-specific adapter has already parsed
 * the raw webhook body) — same Joi conventions as every other Support
 * validator (`.unknown(false)`, per-field `.messages()`). The
 * `attachments` shape is byte-for-byte the same as
 * supportTicket.validator.js's own attachmentSchema — no new
 * attachment convention introduced.
 */

import Joi from "joi";

const attachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  type: Joi.string().optional(),
  publicId: Joi.string().optional(),
  mimeType: Joi.string().optional(),
  sizeBytes: Joi.number().positive().optional(),
});

export const emailInboundSchemas = {
  ingest: Joi.object({
    providerEventId: Joi.string().trim().min(1).max(300).required().messages({
      "any.required": "providerEventId is required",
    }),
    messageId: Joi.string().trim().max(500).allow(null, "").default(null),
    inReplyTo: Joi.string().trim().max(500).allow(null, "").default(null),
    references: Joi.array().items(Joi.string().trim().max(500)).default([]),
    fromEmail: Joi.string().trim().lowercase().email().required().messages({
      "any.required": "fromEmail is required",
      "string.email": "fromEmail must be a valid email address",
    }),
    toEmail: Joi.string().trim().lowercase().email().allow(null, "").default(null),
    subject: Joi.string().trim().max(500).allow(null, "").default(null),
    textBody: Joi.string().min(1).max(50000).required().messages({
      "any.required": "textBody is required",
    }),
    // Deliberately generous upper bound here (50000) — the actual
    // SupportMessage.body maxlength:5000 is enforced by graceful
    // truncation inside emailInbound.service.js, not by rejecting the
    // whole webhook for a long, real-world email.
    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
  }).unknown(false),
};
