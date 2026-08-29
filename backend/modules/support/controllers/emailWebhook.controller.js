/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/emailWebhook.controller.js
 *
 * Phase H Step 9 — Email Support (inbound). Thin controller — DTO
 * shaping only, exactly matching the layering every other Support
 * controller already uses. All real logic lives in
 * emailInbound.service.js; normalization (dev adapter today, a real
 * provider adapter later) is a separate, explicit step so swapping the
 * provider never touches this file.
 */

import { successResponse } from "../../../utils/response.js";
import { normalizeDevPayload } from "../providers/emailInbound.devAdapter.js";
import { processInboundEmail } from "../services/emailInbound.service.js";

export const ingestInboundEmailHandler = async (req, res, next) => {
  try {
    const payload = normalizeDevPayload(req.body);
    const result = await processInboundEmail(payload, req.app.get("io"));

    return successResponse(res, {
      message: result.duplicate ? "Duplicate event ignored" : "Inbound email processed",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};
