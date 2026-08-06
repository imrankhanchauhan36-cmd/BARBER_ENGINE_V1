/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/WhatsappProvider.js
 *
 * Notification Engine — Phase 3 (ARCHITECTURE ONLY — no real WhatsApp)
 *
 * Placeholder satisfying the provider contract (NotificationProvider.contract.js).
 * No network call, no WhatsApp Cloud API/BSP SDK, no credentials.
 * send() always reports NOT_IMPLEMENTED via the normalized result
 * shape. Reserved for a future phase, per the roadmap's explicit
 * "WhatsApp — future" note.
 */

import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";

const WhatsappProvider = Object.freeze({
  name: "WHATSAPP",

  /** @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult>} */
  send: async () => ({
    success:   false,
    provider:  "whatsapp",
    channel:   NOTIFICATION_CHANNEL.WHATSAPP,
    messageId: null,
    latencyMs: 0,
    error:     "NOT_IMPLEMENTED",
  }),
});

export default WhatsappProvider;
