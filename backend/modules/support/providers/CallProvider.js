/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/CallProvider.js
 *
 * Phase H — Call Support (outbound). Lives under modules/support/
 * providers/, NOT modules/notifications/providers/ alongside Email/
 * WhatsApp — a call's outbound action is "initiate a telephony
 * session," not "dispatch a message," so it doesn't implement the
 * generic NotificationProvider.contract.js shape and is never
 * registered in NotificationProviderResolver (NOTIFICATION_CHANNEL has
 * no CALL/VOICE value — see the approved design's finding on why
 * NotificationDeliveryLog's one-shot-send shape doesn't fit a call's
 * multi-event lifecycle). Called directly by callLog.service.js only
 * when an agent logs an OUTBOUND call — an INBOUND call being logged
 * after the fact needs no provider interaction at all, it already
 * happened.
 *
 * Provider-neutral by construction: all identifying values (base URL,
 * access token) come from config/callProvider.config.js, itself
 * sourced entirely from environment variables — no vendor SDK, no
 * hardcoded number, no hardcoded account.
 *
 * If the provider is not configured (local/dev with no real telephony
 * account set up yet — the expected state for this phase),
 * initiateOutboundCall() returns a clean {success:false,
 * error:"NOT_CONFIGURED"} result — never throws — matching
 * EmailProvider.js/WhatsappProvider.js's own NOT_CONFIGURED convention.
 */

import { getCallProviderConfig } from "../../../config/callProvider.config.js";
import logger from "../../../utils/logger.js";

/**
 * @param {object} payload
 * @param {string} payload.to - destination phone number, provider format
 * @returns {Promise<{ success: boolean, providerCallId: string|null, error: string|null }>}
 */
export async function initiateOutboundCall(payload) {
  const config = getCallProviderConfig();

  if (!config.apiBaseUrl || !config.accessToken) {
    return { success: false, providerCallId: null, error: "NOT_CONFIGURED" };
  }

  try {
    const res = await fetch(`${config.apiBaseUrl}/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: payload.to }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return { success: false, providerCallId: null, error: data?.error?.message || `HTTP_${res.status}` };
    }

    return { success: true, providerCallId: data?.callId || null, error: null };
  } catch (err) {
    logger.warn("[CallProvider] initiateOutboundCall failed", { error: err.message });
    return { success: false, providerCallId: null, error: err.message || "SEND_FAILED" };
  }
}
