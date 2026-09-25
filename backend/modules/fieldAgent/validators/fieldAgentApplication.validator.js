/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/fieldAgentApplication.validator.js
 *
 * FA-2 — same Joi conventions already used by
 * modules/support/validators/supportTicket.validator.js (shared
 * `objectId` primitive, `.unknown(false)`, per-field `.messages()`),
 * wired through the existing middlewares/validate.middleware.js.
 */

import Joi from "joi";
import { COMMERCIAL_PATH, GENDER } from "../constants/fieldAgent.constants.js";

const objectId = Joi.string().hex().length(24);

const phoneSchema = Joi.string()
  .trim()
  .pattern(/^[6-9]\d{9}$/)
  .messages({
    "string.pattern.base": "phone must be a valid 10-digit Indian mobile number",
    "any.required": "phone is required",
  });

const requestedZoneSchema = Joi.object({
  stateRef: objectId.required().messages({ "any.required": "stateRef is required" }),
  districtRef: objectId.optional(),
  cityRef: objectId.optional(),
  areaRef: objectId.optional(),
}).unknown(false);

export const fieldAgentSchemas = {
  sendOtp: Joi.object({
    phone: phoneSchema.required(),
  }).unknown(false),

  verifyOtp: Joi.object({
    phone: phoneSchema.required(),
    otp: Joi.string().pattern(/^\d{6}$/).required().messages({
      "string.pattern.base": "otp must be a 6-digit code",
      "any.required": "otp is required",
    }),
  }).unknown(false),

  // PATCH /applications/me — DRAFT-only, enforced in the service, not
  // here. All fields optional so a partial save (e.g. name only) is
  // allowed; whatever is present is still fully validated.
  updateDraft: Joi.object({
    basicProfile: Joi.object({
      name: Joi.string().trim().min(2).max(100).optional(),
      dob: Joi.date().max("now").optional().messages({
        "date.max": "dob cannot be in the future",
      }),
      gender: Joi.string().valid(...Object.values(GENDER)).optional(),
    }).unknown(false).optional(),

    requestedZone: requestedZoneSchema.optional(),

    requestedCommercialPath: Joi.string()
      .valid(...Object.values(COMMERCIAL_PATH))
      .optional(),
  }).unknown(false),

  withdraw: Joi.object({
    reason: Joi.string().trim().max(500).optional(),
  }).unknown(false),
};
