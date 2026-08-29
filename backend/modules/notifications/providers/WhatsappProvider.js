/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/WhatsappProvider.js
 *
 * Notification Engine — Phase H (WhatsApp Support). Real
 * implementation, replacing the prior NOT_IMPLEMENTED stub. Still
 * satisfies the exact same NotificationProvider.contract.js shape —
 * NotificationDispatcher and NotificationProviderResolver are
 * untouched by this change (this file's registration there already
 * existed).
 *
 * Provider-neutral by construction: all provider-identifying values
 * (phone number ID, access token, API base URL) come from
 * config/whatsappProvider.config.js, itself sourced entirely from
 * environment variables — no vendor SDK, no hardcoded number, no
 * hardcoded account. Swapping the WhatsApp Business number/account/
 * provider in production is a .env change only, never a code change.
 *
 * If the provider is not configured (local/dev with no real WhatsApp
 * Business account set up yet — the expected state for this phase),
 * send() returns a clean {success:false, error:"NOT_CONFIGURED"}
 * result — never throws — so the rest of the pipeline (SupportMessage
 * creation, delivery logging, audit) stays fully testable without any
 * real WhatsApp account, exactly matching EmailProvider.js's own
 * NOT_CONFIGURED convention.
 *
 * Payload shape (caller-supplied — see whatsappOutbound.service.js,
 * the only intended caller): { to, text }.
 */

import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { getWhatsappProviderConfig } from "../../../config/whatsappProvider.config.js";
import logger from "../../../utils/logger.js";

const WhatsappProvider = Object.freeze({
  name: "WHATSAPP",

  /**
   * @param {object} payload
   * @param {string} payload.to - recipient phone number, provider format
   * @param {string} payload.text - message body
   * @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult>}
   */
  send: async (payload) => {
    const startedAt = Date.now();
    const config = getWhatsappProviderConfig();

    if (!config.phoneNumberId || !config.accessToken || !config.apiBaseUrl) {
      return {
        success: false,
        provider: "whatsapp",
        channel: NOTIFICATION_CHANNEL.WHATSAPP,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error: "NOT_CONFIGURED",
      };
    }

    try {
      const res = await fetch(`${config.apiBaseUrl}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: payload.to,
          type: "text",
          text: { body: payload.text },
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        return {
          success: false,
          provider: "whatsapp",
          channel: NOTIFICATION_CHANNEL.WHATSAPP,
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error: data?.error?.message || `HTTP_${res.status}`,
        };
      }

      return {
        success: true,
        provider: "whatsapp",
        channel: NOTIFICATION_CHANNEL.WHATSAPP,
        messageId: data?.messages?.[0]?.id || null,
        latencyMs: Date.now() - startedAt,
        error: null,
      };
    } catch (err) {
      logger.warn("[WhatsappProvider] send failed", { error: err.message });
      return {
        success: false,
        provider: "whatsapp",
        channel: NOTIFICATION_CHANNEL.WHATSAPP,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error: err.message || "SEND_FAILED",
      };
    }
  },
});

export default WhatsappProvider;
