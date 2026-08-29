/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/whatsappWebhook.controller.js
 *
 * Phase H — WhatsApp Support (inbound). Thin controller — DTO shaping
 * only, exactly matching emailWebhook.controller.js's layering. All
 * real logic lives in whatsappInbound.service.js; normalization (dev
 * adapter today, a real provider adapter later) is a separate,
 * explicit step so swapping the provider never touches this file.
 */

import { successResponse } from "../../../utils/response.js";
import { normalizeDevPayload } from "../providers/whatsappInbound.devAdapter.js";
import { processInboundWhatsApp } from "../services/whatsappInbound.service.js";

export const ingestInboundWhatsAppHandler = async (req, res, next) => {
  try {
    const payload = normalizeDevPayload(req.body);
    const result = await processInboundWhatsApp(payload, req.app.get("io"));

    return successResponse(res, {
      message: result.duplicate ? "Duplicate event ignored" : "Inbound WhatsApp message processed",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};
