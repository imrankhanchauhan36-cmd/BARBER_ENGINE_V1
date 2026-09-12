/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/validators/fieldAgentTest.validator.js
 *
 * FA-3.4.3 — agent-facing test API validation. Same Joi conventions as
 * fieldAgentTraining.validator.js.
 *
 * IMPORTANT: this project's `validate` middleware
 * (middlewares/validate.middleware.js) calls `schema.validate(...,
 * {stripUnknown:true})` — under that option, a plain `.unknown(false)`
 * does NOT produce a 400 for an unrecognized key, it silently strips
 * it (a well-known Joi precedence: the global `stripUnknown` option
 * overrides a schema's own unknown-key error behavior). `.unknown(false)`
 * is kept below anyway as the schema's own intent, but the real
 * defense for the specific, security-sensitive client-trust fields
 * (`applicationRef`/`agentRef`/`testVersionRef`/`attemptNumber`/
 * `score`/`passed`) is the SAME explicit `Joi.any().forbidden()` idiom
 * FA-3.4.1's `updateContent` schema already established for its own
 * dangerous field (`media`) — a per-key rule, which DOES still fire
 * under `stripUnknown`, producing a clear, auditable 400 instead of a
 * silent strip.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

// Every field a malicious client might try to smuggle in to influence
// server-authoritative behavior — explicitly rejected, not merely
// omitted from the schema (see file header).
const forbiddenClientTrustFields = {
  applicationRef: Joi.any().forbidden(),
  agentRef: Joi.any().forbidden(),
  testVersionRef: Joi.any().forbidden(),
  attemptNumber: Joi.any().forbidden(),
  score: Joi.any().forbidden(),
  passed: Joi.any().forbidden(),
};

export const fieldAgentTestSchemas = {
  attemptIdParam: Joi.object({ attemptId: objectId.required() }).unknown(false),

  // POST /attempts takes no legitimate body input — identity is
  // req.user._id, everything else is server-derived.
  startAttemptBody: Joi.object({
    ...forbiddenClientTrustFields,
  }).unknown(false),

  submitAnswers: Joi.object({
    answers: Joi.array()
      .items(
        Joi.object({
          questionId: objectId.required(),
          // Missing/null = unanswered (scored incorrect by the
          // service, never rejected here).
          selectedOptionIndex: Joi.number().integer().min(0).allow(null).optional(),
        }).unknown(false)
      )
      .required(),
    ...forbiddenClientTrustFields,
  }).unknown(false),
};
