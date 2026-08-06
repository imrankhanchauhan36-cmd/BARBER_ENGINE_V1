/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/validators/deviceToken.validator.js
 *
 * Notification Engine — Device Token Registration (backend foundation)
 *
 * recipientType/recipientId are never accepted from the client — the
 * controller always derives them server-side from the authenticated
 * owner's own salon, so a client can never register a token under a
 * different recipient. Only device/token fields are validated here.
 */

import Joi from "joi";

import {
  DEVICE_PLATFORM_VALUES,
  PUSH_PROVIDER_VALUES,
} from "../../../constants/notification.constants.js";

export const deviceTokenSchemas = {

  //////////////////////////////////////////////////////////
  // REGISTER
  // POST /api/notifications/device-tokens
  //////////////////////////////////////////////////////////
  register: Joi.object({
    token: Joi.string().trim().min(10).max(4096).required()
      .messages({ "any.required": "token is required" }),

    platform: Joi.string().valid(...DEVICE_PLATFORM_VALUES).required()
      .messages({ "any.required": "platform is required" }),

    provider: Joi.string().valid(...PUSH_PROVIDER_VALUES).required()
      .messages({ "any.required": "provider is required" }),

    appVersion: Joi.string().trim().max(50).allow("", null),

    deviceId: Joi.string().trim().max(200).allow("", null),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // DEACTIVATE (logout)
  // PATCH /api/notifications/device-tokens/deactivate
  //////////////////////////////////////////////////////////
  deactivate: Joi.object({
    token: Joi.string().trim().min(10).max(4096).required()
      .messages({ "any.required": "token is required" }),
  }).unknown(false),

};
