/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportQueueConfig.validator.js
 *
 * Phase H Step 8 (Step 3) — Support Configuration Management: Queues.
 * Same Joi conventions as every other Support validator. businessHoursRef
 * is deliberately NOT exposed — it is an unused forward-compatibility
 * placeholder on the model (no BusinessHours collection exists), never
 * read by any current service, so this admin layer does not surface it.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const supportQueueConfigSchemas = {
  create: Joi.object({
    queueCode: Joi.string().trim().min(1).max(40).required().messages({
      "any.required": "queueCode is required",
      "string.empty": "queueCode is required",
    }),
    name: Joi.string().trim().min(1).max(200).required().messages({
      "any.required": "name is required",
      "string.empty": "name is required",
    }),
    description: Joi.string().trim().max(1000).allow(null).default(null),
    categoryRefs: Joi.array().items(objectId).default([]),
    // Required by the model (SupportQueue.js: "one queue -> exactly
    // one team, deterministic ownership") — re-verified as required
    // here rather than left to a raw Mongoose ValidationError.
    ownerTeamRef: objectId.required().messages({
      "any.required": "ownerTeamRef is required",
    }),
    maxConcurrentTickets: Joi.number().integer().positive().allow(null).default(null),
  }).unknown(false),

  update: Joi.object({
    queueCode: Joi.string().trim().min(1).max(40).optional(),
    name: Joi.string().trim().min(1).max(200).optional(),
    description: Joi.string().trim().max(1000).allow(null).optional(),
    categoryRefs: Joi.array().items(objectId).optional(),
    ownerTeamRef: objectId.optional(),
    maxConcurrentTickets: Joi.number().integer().positive().allow(null).optional(),
  }).unknown(false).min(1).messages({
    "object.min": "At least one field must be provided",
  }),

  updateStatus: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
    }),
  }).unknown(false),
};
