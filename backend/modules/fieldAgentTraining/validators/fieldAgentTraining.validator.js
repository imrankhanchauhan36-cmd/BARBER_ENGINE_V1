/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/validators/fieldAgentTraining.validator.js
 *
 * FA-3.3 — agent-facing + help validation.
 */

import Joi from "joi";
import { SUPPORTED_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE } from "../constants/fieldAgentTraining.constants.js";

const objectId = Joi.string().hex().length(24);

export const fieldAgentTrainingSchemas = {
  languageQuery: Joi.object({
    lang: Joi.string().valid(...SUPPORTED_LANGUAGE_CODES).default(DEFAULT_LANGUAGE_CODE),
  }).unknown(false),

  moduleKeyParam: Joi.object({ moduleKey: Joi.string().required() }).unknown(false),
  contentIdParam: Joi.object({ contentId: objectId.required() }).unknown(false),

  lessonProgress: Joi.object({
    watchedSeconds: Joi.number().min(0).default(0),
  }).unknown(false),

  gradedSubmission: Joi.object({
    answerIndex: Joi.number().integer().min(0).optional(),
    selectedKeys: Joi.array().items(Joi.string()).optional(),
  }).unknown(false),
};
