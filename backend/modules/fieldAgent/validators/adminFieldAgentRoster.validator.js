/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentRoster.validator.js
 *
 * STEP 3.1 (backend addendum) — Admin Field Agent Roster List API.
 * Approved LIVE by the user as an explicit, disclosed exception to
 * this ticket's own "Do NOT modify backend" line — see the AskUserQuestion
 * exchange: no existing endpoint lists FieldAgent documents by their
 * own _id (GET /api/admin/field-agents is the FA-4.2 Applications
 * queue — a different collection, exposing only agentCode/
 * applicationId, never FieldAgent._id), and every STEP 2.x detail
 * endpoint (summary/salons/earnings/wallet/payouts) requires exactly
 * that _id. This is the one minimal, additive, read-only list needed
 * to link a roster table to those already-built detail endpoints.
 *
 * Validation only — no business logic. `.unknown(false)` per this
 * project's standing convention.
 */

import Joi from "joi";
import { FIELD_AGENT_OPERATIONAL_STATUS } from "../constants/fieldAgent.constants.js";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";

export const adminFieldAgentRosterSchemas = {
  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow("").optional(),
    status: Joi.string().valid(...Object.values(FIELD_AGENT_OPERATIONAL_STATUS)).optional(),
    commercialType: Joi.string().valid(...Object.values(COMMERCIAL_PATH)).optional(),
  }).unknown(false),
};
