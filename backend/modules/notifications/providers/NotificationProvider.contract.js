/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/NotificationProvider.contract.js
 *
 * Notification Engine — Phase 3 (Provider Base Contract — ARCHITECTURE ONLY)
 *
 * Mirrors backend/services/settlement/PayoutProvider.js: every channel
 * provider (InAppProvider today; PushProvider/SmsProvider/EmailProvider/
 * WhatsappProvider later) must implement a single async `send(deliveryLogRow)`
 * method and RETURN a normalized result — never throw for an expected
 * outcome (implemented-but-failed, or not-yet-implemented). This is the
 * same {success, provider, messageId, latencyMs, error} shape already
 * established by services/sms.service.js, extended with `channel` so a
 * caller inspecting a result knows which channel produced it without
 * re-reading the row it came from.
 *
 * No SDK code, no network calls, no credentials — this file only
 * defines and validates the shape.
 *
 * @typedef {Object} NotificationProviderResult
 * @property {boolean} success
 * @property {string} provider - e.g. "in-app", "expo-fcm", "msg91" (lowercase, matches sms.service.js convention)
 * @property {string} channel - NOTIFICATION_CHANNEL value (IN_APP/PUSH/SMS/EMAIL/WHATSAPP)
 * @property {string|null} messageId
 * @property {number} latencyMs
 * @property {string|null} error - null iff success === true
 */

import { Errors } from "../../../utils/response.js";

const REQUIRED_RESULT_KEYS = ["success", "provider", "channel", "messageId", "latencyMs", "error"];

/**
 * Runtime contract check — a future provider returning the wrong shape
 * fails loudly at the point of the mistake, not downstream inside the
 * dispatcher. Same idiom as PayoutProvider.js's assertValidProviderResult.
 * @param {NotificationProviderResult} result
 */
export const assertValidProviderResult = (result) => {
  if (!result || typeof result !== "object") {
    throw Errors.internal("Notification provider must return a result object");
  }
  for (const key of REQUIRED_RESULT_KEYS) {
    if (!(key in result)) {
      throw Errors.internal(`Notification provider result is missing required field "${key}"`);
    }
  }
  if (typeof result.success !== "boolean") {
    throw Errors.internal('Notification provider result "success" must be a boolean');
  }
  if (result.success && result.error !== null) {
    throw Errors.internal('Notification provider result with success:true must have error:null');
  }
  if (!result.success && !result.error) {
    throw Errors.internal('Notification provider result with success:false must include a non-empty "error"');
  }
};
