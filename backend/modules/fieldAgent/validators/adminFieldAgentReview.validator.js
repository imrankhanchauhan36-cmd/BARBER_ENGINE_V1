/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentReview.validator.js
 *
 * FA-4.3 — admin review queue/detail validation. Same Joi conventions
 * as adminFieldAgentApproval.validator.js. Every query field is
 * explicitly whitelisted — no arbitrary Mongo operator, no arbitrary
 * sort field/direction, ever reaches the service layer.
 */

import Joi from "joi";
import { APPLICATION_STATUS } from "../constants/fieldAgent.constants.js";

const objectId = Joi.string().hex().length(24);
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
const MAX_SEARCH_LENGTH = 100;

export const adminFieldAgentReviewSchemas = {
  applicationIdParam: Joi.object({ applicationId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    status: Joi.string().valid(...Object.values(APPLICATION_STATUS)).optional(),
    search: Joi.string().trim().max(MAX_SEARCH_LENGTH).allow("").optional(),
    sortBy: Joi.string().valid("createdAt", "updatedAt").optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
    createdFrom: Joi.date().iso().optional(),
    createdTo: Joi.date().iso().optional(),
    updatedFrom: Joi.date().iso().optional(),
    updatedTo: Joi.date().iso().optional(),
    applicationId: objectId.optional(),
  }).unknown(false),
};
