/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminFieldAgentApproval.validator.js
 *
 * FA-4.2 — admin approval/rejection validation. Same Joi conventions
 * as testContent.validator.js (shared `objectId` primitive,
 * `.unknown(false)`).
 *
 * The approve endpoint takes NO legitimate body input at all —
 * userRef/agentRef/agentCode/approvedBy/approvedAt/operationalStatus/
 * application status are all server-controlled. Every one of them is
 * explicitly `.forbidden()` (not merely omitted) so a client attempt
 * to inject them produces a clear 400 rather than being silently
 * stripped by this project's `validate` middleware (which runs Joi
 * with `stripUnknown:true` — the same well-known precedence already
 * documented in fieldAgentTest.validator.js's own header).
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  userRef: Joi.any().forbidden(),
  agentRef: Joi.any().forbidden(),
  agentCode: Joi.any().forbidden(),
  approvedBy: Joi.any().forbidden(),
  approvedAt: Joi.any().forbidden(),
  operationalStatus: Joi.any().forbidden(),
  status: Joi.any().forbidden(),
  applicationStatus: Joi.any().forbidden(),
};

export const adminFieldAgentApprovalSchemas = {
  applicationIdParam: Joi.object({ applicationId: objectId.required() }).unknown(false),

  approveBody: Joi.object({
    ...forbiddenServerControlledFields,
  }).unknown(false),

  rejectBody: Joi.object({
    reason: Joi.string().trim().min(1).max(500).required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),
};
