/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/validators/trainingContent.validator.js
 *
 * FA-3.3 — admin authoring validation. Same Joi conventions as
 * modules/fieldAgent/validators/fieldAgentApplication.validator.js
 * (shared `objectId` primitive, `.unknown(false)`).
 */

import Joi from "joi";
import {
  MODULE_KEY,
  CONTENT_TYPE,
  SUPPORTED_LANGUAGE_CODES,
  ADMIN_OVERRIDE_CLASS,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  TRAINING_AUDIT_ENTITY_TYPE,
} from "../constants/fieldAgentTraining.constants.js";

// FA-3.3.2.4 — shared shape, per-endpoint default `limit` (preserving
// each endpoint's pre-existing default page size), same MAX_LIST_LIMIT
// ceiling for all three. A `limit` above the ceiling is REJECTED
// (400) here, not silently clamped — the service layer's own clamp
// (trainingContent.service.js) is a defensive backstop only, for any
// future internal caller that bypasses this validator.
const listQuerySchema = (defaultLimit) =>
  Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(defaultLimit),
  }).unknown(false);

const objectId = Joi.string().hex().length(24);

const translationSchema = Joi.object({
  languageCode: Joi.string().valid(...SUPPORTED_LANGUAGE_CODES).required(),
  title: Joi.string().trim().min(1).max(200).required(),
  body: Joi.string().trim().max(8000).allow(null, ""),
  options: Joi.array().items(Joi.string().trim().max(300)).optional(),
  summary: Joi.string().trim().max(1000).allow(null, ""),
  approved: Joi.boolean().optional(),
}).unknown(false);

const gradingSchema = Joi.object({
  type: Joi.string().valid("SINGLE_CHOICE", "CHECKLIST").required(),
  correctOptionIndex: Joi.number().integer().min(0).when("type", { is: "SINGLE_CHOICE", then: Joi.required() }),
  correctKeys: Joi.array().items(Joi.string()).when("type", { is: "CHECKLIST", then: Joi.required() }),
}).unknown(false);

const mediaSchema = Joi.object({
  publicId: Joi.string().trim().required(),
  resourceType: Joi.string().valid("image", "video", "raw").required(),
}).unknown(false);

export const trainingContentSchemas = {
  createVersion: Joi.object({
    notes: Joi.string().trim().max(1000).allow(null, ""),
  }).unknown(false),

  addModule: Joi.object({
    moduleKey: Joi.string().valid(...Object.values(MODULE_KEY)).required(),
    translations: Joi.array().items(translationSchema).min(1).required(),
  }).unknown(false),

  updateModule: Joi.object({
    translations: Joi.array().items(translationSchema).min(1).required(),
  }).unknown(false),

  addContent: Joi.object({
    contentType: Joi.string().valid(...Object.values(CONTENT_TYPE)).required(),
    translations: Joi.array().items(translationSchema).min(1).required(),
    media: mediaSchema.optional(),
    watchThresholdSeconds: Joi.number().integer().min(0).optional(),
    grading: gradingSchema.optional(),
    passingScore: Joi.number().min(0).max(100).optional(),
    required: Joi.boolean().optional(),
    helpEligible: Joi.boolean().optional(),
  }).unknown(false),

  updateContent: Joi.object({
    translations: Joi.array().items(translationSchema).min(1).optional(),
    media: mediaSchema.optional(),
    watchThresholdSeconds: Joi.number().integer().min(0).allow(null).optional(),
    grading: gradingSchema.allow(null).optional(),
    passingScore: Joi.number().min(0).max(100).allow(null).optional(),
    required: Joi.boolean().optional(),
    helpEligible: Joi.boolean().optional(),
  }).unknown(false),

  retireVersion: Joi.object({
    reason: Joi.string().trim().max(500).allow(null, ""),
  }).unknown(false),

  overrideCompletion: Joi.object({
    agentUserId: objectId.required(),
    contentId: objectId.required(),
    overrideClass: Joi.string().valid(...Object.values(ADMIN_OVERRIDE_CLASS)).required(),
    reason: Joi.string().trim().min(1).max(500).required(),
  }).unknown(false),

  moduleIdParam: Joi.object({ moduleId: objectId.required() }).unknown(false),
  versionIdParam: Joi.object({ versionId: objectId.required() }).unknown(false),
  contentIdParam: Joi.object({ contentId: objectId.required() }).unknown(false),
  agentUserIdParam: Joi.object({ agentUserId: objectId.required() }).unknown(false),

  // FA-3.3.2.4
  progressListQuery: listQuerySchema(DEFAULT_LIST_LIMIT.PROGRESS),
  // Preserves the pre-existing entityType/entityId filter capability
  // (previously accepted with zero Joi validation at all) alongside
  // the new page/limit bounds — dropping these would silently break
  // the audit-filtering FA-3.3.1's own regression suite already relies on.
  auditListQuery: listQuerySchema(DEFAULT_LIST_LIMIT.AUDIT).keys({
    entityType: Joi.string().valid(...Object.values(TRAINING_AUDIT_ENTITY_TYPE)).optional(),
    entityId: objectId.optional(),
  }),
  versionsListQuery: listQuerySchema(DEFAULT_LIST_LIMIT.VERSIONS),
};
