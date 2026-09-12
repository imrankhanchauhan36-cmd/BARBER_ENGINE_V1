/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/validators/testContent.validator.js
 *
 * FA-3.4.1 — admin authoring validation. Same Joi conventions as
 * fieldAgentTraining's trainingContent.validator.js (shared `objectId`
 * primitive, `.unknown(false)`).
 */

import Joi from "joi";
import {
  SUPPORTED_LANGUAGE_CODES,
  GRADING_TYPE,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  PASSING_SCORE_MIN,
  PASSING_SCORE_MAX,
  MAX_ATTEMPTS_MIN,
  RETRY_COOLDOWN_MINUTES_MIN,
} from "../constants/fieldAgentTest.constants.js";

const objectId = Joi.string().hex().length(24);

const listQuerySchema = (defaultLimit) =>
  Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(defaultLimit),
  }).unknown(false);

const questionTranslationSchema = Joi.object({
  languageCode: Joi.string().valid(...SUPPORTED_LANGUAGE_CODES).required(),
  questionText: Joi.string().trim().min(1).max(500).required(),
  options: Joi.array().items(Joi.string().trim().max(300)).min(2).required(),
  approved: Joi.boolean().optional(),
}).unknown(false);

// V1 supports SINGLE_CHOICE only — the Joi `.valid()` restriction is
// the route-level enforcement of that scope decision.
const gradingSchema = Joi.object({
  type: Joi.string().valid(GRADING_TYPE.SINGLE_CHOICE).required(),
  correctOptionIndex: Joi.number().integer().min(0).required(),
}).unknown(false);

const versionBusinessFields = {
  passingScore: Joi.number().integer().min(PASSING_SCORE_MIN).max(PASSING_SCORE_MAX).optional(),
  maxAttempts: Joi.number().integer().min(MAX_ATTEMPTS_MIN).optional(),
  retryCooldownMinutes: Joi.number().integer().min(RETRY_COOLDOWN_MINUTES_MIN).optional(),
};

export const testContentSchemas = {
  createVersion: Joi.object({
    notes: Joi.string().trim().max(1000).allow(null, ""),
    ...versionBusinessFields,
  }).unknown(false),

  updateVersion: Joi.object({
    notes: Joi.string().trim().max(1000).allow(null, ""),
    ...versionBusinessFields,
  }).unknown(false),

  addQuestion: Joi.object({
    translations: Joi.array().items(questionTranslationSchema).min(1).required(),
    grading: gradingSchema.required(),
  }).unknown(false),

  updateQuestion: Joi.object({
    translations: Joi.array().items(questionTranslationSchema).min(1).optional(),
    grading: gradingSchema.optional(),
    active: Joi.boolean().optional(),
  }).unknown(false),

  reorderQuestions: Joi.object({
    orderedQuestionIds: Joi.array().items(objectId).min(1).required(),
  }).unknown(false),

  retireVersion: Joi.object({
    reason: Joi.string().trim().max(500).allow(null, ""),
  }).unknown(false),

  versionIdParam: Joi.object({ versionId: objectId.required() }).unknown(false),
  questionIdParam: Joi.object({ questionId: objectId.required() }).unknown(false),

  versionsListQuery: listQuerySchema(DEFAULT_LIST_LIMIT.VERSIONS),
};
