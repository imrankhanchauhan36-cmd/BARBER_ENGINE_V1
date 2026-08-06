/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/EmailProvider.js
 *
 * Notification Engine — Phase 3 (ARCHITECTURE ONLY — no real email)
 *
 * Placeholder satisfying the provider contract (NotificationProvider.contract.js).
 * No network call, no SendGrid/SES SDK, no credentials. send() always
 * reports NOT_IMPLEMENTED via the normalized result shape. A future
 * phase replaces this file's body without touching NotificationDispatcher,
 * NotificationProviderResolver, or NotificationService.
 */

import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";

const EmailProvider = Object.freeze({
  name: "EMAIL",

  /** @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult>} */
  send: async () => ({
    success:   false,
    provider:  "email",
    channel:   NOTIFICATION_CHANNEL.EMAIL,
    messageId: null,
    latencyMs: 0,
    error:     "NOT_IMPLEMENTED",
  }),
});

export default EmailProvider;
