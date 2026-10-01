/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/assistedOnboarding.validator.js
 *
 * PHASE 1 — PAN-India Field Agent Assisted Onboarding. Same Joi
 * conventions as acquisitionClaim.validator.js: `.unknown(false)`,
 * explicit `.forbidden()` on every identity/derived field so this
 * project's `stripUnknown:true` Joi config can't silently swallow a
 * client's attempt to inject one. No schema here ever accepts
 * fieldAgentRef/ownerId/salonId/salonRef as a client-suppliable field —
 * every identity is resolved server-side from req.user._id or from the
 * server-issued assistedOnboardingToken (locked decision, same as the
 * existing redeemBody schema).
 */

import Joi from "joi";

export const assistedOnboardingSchemas = {
  sendOtpBody: Joi.object({
    phone: Joi.string().trim().min(10).max(15).required(),
  }).unknown(false),

  // Exactly one of {otp} (fresh OTP verification) or
  // {assistedOnboardingToken} (resuming an already-verified session) —
  // never both, never neither. `phone` is required alongside `otp`
  // (fresh path); it is not needed/accepted alongside a token (the
  // phone is already bound inside the token server-side).
  startBody: Joi.object({
    phone: Joi.string().trim().min(10).max(15).optional(),
    otp: Joi.string().trim().length(6).pattern(/^\d+$/).optional(),
    assistedOnboardingToken: Joi.string().trim().hex().optional(),
    createNewBranch: Joi.boolean().optional(),
    fieldAgentRef: Joi.any().forbidden(),
    ownerId: Joi.any().forbidden(),
    salonId: Joi.any().forbidden(),
    salonRef: Joi.any().forbidden(),
  })
    .unknown(false)
    .xor("assistedOnboardingToken", "otp")
    .with("otp", "phone")
    .without("assistedOnboardingToken", ["phone"])
    // NOTE: Joi's .messages() compiles each string as a template, where
    // a literal "{" opens a template reference — so these messages are
    // deliberately written with no curly braces at all (an earlier
    // draft using "{phone, otp}" as plain English crashed Joi's own
    // template parser at schema-compile time, i.e. at server boot).
    .messages({
      "object.xor": "Provide either phone+otp, or an assistedOnboardingToken, but not both",
      "object.missing": "Provide either phone+otp, or an assistedOnboardingToken",
      "object.with": "phone is required when otp is provided",
      "object.without": "phone is not needed when resuming with an assistedOnboardingToken",
    }),
};
