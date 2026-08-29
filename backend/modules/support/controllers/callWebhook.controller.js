/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/callWebhook.controller.js
 *
 * Phase H — Call Support (inbound). Thin controller — DTO shaping
 * only, exactly matching emailWebhook.controller.js /
 * whatsappWebhook.controller.js's layering. All real logic lives in
 * callInbound.service.js; normalization (dev adapter today, a real
 * provider adapter later) is a separate, explicit step so swapping the
 * provider never touches this file.
 */

import { successResponse } from "../../../utils/response.js";
import { normalizeDevPayload } from "../providers/callInbound.devAdapter.js";
import { processInboundCallEvent } from "../services/callInbound.service.js";

export const ingestInboundCallHandler = async (req, res, next) => {
  try {
    const payload = normalizeDevPayload(req.body);
    const result = await processInboundCallEvent(payload, req.app.get("io"));

    return successResponse(res, {
      message: result.duplicate ? "Duplicate event ignored" : "Inbound call event processed",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};
