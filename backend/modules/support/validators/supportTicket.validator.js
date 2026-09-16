/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportTicket.validator.js
 *
 * Phase C — same Joi conventions already used by
 * backend/validators/booking.validators.js (shared `objectId`
 * primitive, `.unknown(false)`, per-field `.messages()`), wired
 * through the existing middlewares/validate.middleware.js — no new
 * validation architecture introduced.
 */

import Joi from "joi";
import { PRIORITY, SUPPORTED_LANGUAGES } from "../constants/support.constants.js";

const objectId = Joi.string().hex().length(24);

const attachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  type: Joi.string().optional(),
  publicId: Joi.string().optional(),
  mimeType: Joi.string().optional(),
  sizeBytes: Joi.number().positive().optional(),
});

export const supportSchemas = {
  createTicket: Joi.object({
    categoryRef: objectId.required().messages({ "any.required": "categoryRef is required" }),

    subject: Joi.string().trim().min(3).max(200).required().messages({
      "any.required": "subject is required",
      "string.min": "subject must be at least 3 characters",
    }),

    body: Joi.string().trim().min(1).max(5000).required().messages({
      "any.required": "body is required",
    }),

    priority: Joi.string().valid(...Object.values(PRIORITY)).default(PRIORITY.NORMAL),

    language: Joi.string().valid(...SUPPORTED_LANGUAGES).default("en"),

    relatedSalonRef: objectId.optional(),
    relatedBookingRef: objectId.optional(),

    // Phase F.3.7 — same attachmentSchema/limit already used by
    // addMessage below, no separate upload system, no weakened limits.
    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
  }).unknown(false),

  // FA-10 — Field Agent Support Integration. Same shape as createTicket
  // above, minus relatedSalonRef/relatedBookingRef, which are explicitly
  // .forbidden() (not simply omitted) — createTicket()'s
  // resolveRelatedReferences() only recognizes "USER"/"OWNER" roles and
  // silently skips its ownership check for any other role, so relying on
  // the Field Agent frontend to just not send these fields would leave a
  // real server-side gap. Field Agent V1 has no booking/salon linkage.
  createFieldAgentTicket: Joi.object({
    categoryRef: objectId.required().messages({ "any.required": "categoryRef is required" }),

    subject: Joi.string().trim().min(3).max(200).required().messages({
      "any.required": "subject is required",
      "string.min": "subject must be at least 3 characters",
    }),

    body: Joi.string().trim().min(1).max(5000).required().messages({
      "any.required": "body is required",
    }),

    priority: Joi.string().valid(...Object.values(PRIORITY)).default(PRIORITY.NORMAL),

    language: Joi.string().valid(...SUPPORTED_LANGUAGES).default("en"),

    relatedSalonRef: Joi.any().forbidden().messages({ "any.unknown": "relatedSalonRef is not supported for Field Agent tickets" }),
    relatedBookingRef: Joi.any().forbidden().messages({ "any.unknown": "relatedBookingRef is not supported for Field Agent tickets" }),

    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
  }).unknown(false),

  addMessage: Joi.object({
    body: Joi.string().trim().min(1).max(5000).required().messages({
      "any.required": "body is required",
    }),
    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
  }).unknown(false),

  reopenTicket: Joi.object({
    reason: Joi.string().trim().max(500).optional(),
  }).unknown(false),
};
