/**
 * BARBER ENGINE V1
 * backend/modules/support/services/whatsappOutbound.service.js
 *
 * Phase H — WhatsApp Support (outbound). The ONLY place that
 * dispatches a Support reply as a real WhatsApp message. Called
 * exclusively from addAgentReply() (supportTicket.service.js) when the
 * ticket's conversation channel is WHATSAPP — never duplicates ticket/
 * message business logic; it receives an ALREADY-CREATED SupportMessage
 * and ticket, and is responsible only for: building the WhatsApp
 * message, dispatching it through the existing NotificationDispatcher/
 * WhatsappProvider pipeline, and recording the result in
 * NotificationDeliveryLog (an existing model, unmodified). Isolated
 * from supportTicket.service.js exactly as emailOutbound.service.js
 * already is.
 *
 * Never throws — a send failure is recorded as a FAILED
 * NotificationDeliveryLog row and returned as {success:false,...},
 * matching emailOutbound.service.js's own never-throw convention. The
 * caller (addAgentReply) must never roll back the already-created
 * SupportMessage because of a delivery failure.
 */

import NotificationDispatcher from "../../notifications/services/NotificationDispatcher.js";
import NotificationDeliveryLog from "../../notifications/models/NotificationDeliveryLog.js";
import { NOTIFICATION_CHANNEL, DELIVERY_STATUS } from "../../../constants/notification.constants.js";
import { REQUESTER_TYPE } from "../constants/support.constants.js";
import logger from "../../../utils/logger.js";

// User.phone is stored bare (10-digit Indian mobile, no country code —
// same regex assumption already used throughout this codebase). The
// provider needs the full digits-with-country-code format, the exact
// inverse of whatsappInbound.service.js's normalizeToIndianMobile().
function toProviderPhoneFormat(bareIndianPhone) {
  return `91${bareIndianPhone}`;
}

/**
 * @param {object} params
 * @param {object} params.ticket - needs _id, requesterType, requesterRef
 * @param {object} params.message - the just-created SupportMessage (needs body)
 * @param {object} params.requester - { phone } — the customer to send to
 * @returns {Promise<{ success: boolean, deliveryLogId: import("mongoose").Types.ObjectId }>}
 */
export async function sendAgentReplyWhatsApp({ ticket, message, requester }) {
  const recipientType = ticket.requesterType === REQUESTER_TYPE.SALON_OWNER ? "SALON" : "USER";

  if (!requester?.phone) {
    const log = await NotificationDeliveryLog.create({
      recipientType,
      recipientId: ticket.requesterRef,
      channel: NOTIFICATION_CHANNEL.WHATSAPP,
      status: DELIVERY_STATUS.FAILED,
      provider: "whatsapp",
      lastError: "REQUESTER_HAS_NO_PHONE",
    });
    return { success: false, deliveryLogId: log._id };
  }

  const startedAt = Date.now();
  let dispatchResult;
  try {
    dispatchResult = await NotificationDispatcher.dispatch(NOTIFICATION_CHANNEL.WHATSAPP, {
      to: toProviderPhoneFormat(requester.phone),
      text: message.body,
    });
  } catch (err) {
    dispatchResult = { success: false, provider: "whatsapp", messageId: null, error: err.message, latencyMs: Date.now() - startedAt };
  }

  const log = await NotificationDeliveryLog.create({
    recipientType,
    recipientId: ticket.requesterRef,
    channel: NOTIFICATION_CHANNEL.WHATSAPP,
    status: dispatchResult.success ? DELIVERY_STATUS.SENT : DELIVERY_STATUS.FAILED,
    provider: dispatchResult.provider || "whatsapp",
    providerMessageId: dispatchResult.messageId || null,
    sentAt: dispatchResult.success ? new Date() : null,
    lastError: dispatchResult.success ? null : (dispatchResult.error || "WHATSAPP_SEND_FAILED"),
  });

  return { success: dispatchResult.success, deliveryLogId: log._id };
}
