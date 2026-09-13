/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/adminCommercialModel.validator.js
 *
 * FA-5.1 — commercial-path selection validation. Same
 * `.forbidden()`-on-server-controlled-fields discipline as
 * adminFieldAgentApproval.validator.js's own approveBody.
 */

import Joi from "joi";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";

const objectId = Joi.string().hex().length(24);

const forbiddenServerControlledFields = {
  operationalStatus: Joi.any().forbidden(),
  approvedBy: Joi.any().forbidden(),
  approvedAt: Joi.any().forbidden(),
  agentCode: Joi.any().forbidden(),
  userRef: Joi.any().forbidden(),
  applicationRef: Joi.any().forbidden(),
};

export const adminCommercialModelSchemas = {
  fieldAgentIdParam: Joi.object({ fieldAgentId: objectId.required() }).unknown(false),

  selectCommercialPath: Joi.object({
    commercialPath: Joi.string()
      .valid(...Object.values(COMMERCIAL_PATH))
      .required(),
    ...forbiddenServerControlledFields,
  }).unknown(false),
};
