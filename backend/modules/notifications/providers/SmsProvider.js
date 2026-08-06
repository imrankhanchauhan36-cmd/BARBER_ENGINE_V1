/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/SmsProvider.js
 *
 * Notification Engine — Phase 3 (ARCHITECTURE ONLY — no real SMS)
 *
 * Placeholder satisfying the provider contract (NotificationProvider.contract.js).
 * No network call, no MSG91/Twilio SDK, no credentials. send() always
 * reports NOT_IMPLEMENTED via the normalized result shape. A future
 * phase can wrap the existing services/sms.service.js behind this file
 * without touching NotificationDispatcher, NotificationProviderResolver,
 * or NotificationService.
 */

import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";

const SmsProvider = Object.freeze({
  name: "SMS",

  /** @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult>} */
  send: async () => ({
    success:   false,
    provider:  "sms",
    channel:   NOTIFICATION_CHANNEL.SMS,
    messageId: null,
    latencyMs: 0,
    error:     "NOT_IMPLEMENTED",
  }),
});

export default SmsProvider;
