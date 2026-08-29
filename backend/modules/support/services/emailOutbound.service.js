/**
 * BARBER ENGINE V1
 * backend/modules/support/services/emailOutbound.service.js
 *
 * Phase H Step 9 — Email Support (outbound). The ONLY place that
 * dispatches a Support reply as a real email. Called exclusively from
 * addAgentReply() (supportTicket.service.js) when the ticket's
 * conversation channel is EMAIL — never duplicates ticket/message
 * business logic; it receives an ALREADY-CREATED SupportMessage and
 * ticket, and is responsible only for: building the email, dispatching
 * it through the existing NotificationDispatcher/EmailProvider
 * pipeline, and recording the result in NotificationDeliveryLog (an
 * existing model, unmodified).
 *
 * THREADING REFINEMENT (found during implementation, not in the
 * original design note — flagged here explicitly): a customer's reply
 * almost always threads against the AGENT'S most recent outbound
 * email, not the original inbound one, since that's what their mail
 * client's "Reply" button actually replies to. Persisting a new field
 * for this was avoidable: the outbound email's own Message-ID
 * (nodemailer's info.messageId) is stored on
 * NotificationDeliveryLog.providerMessageId — a field that ALREADY
 * exists — and SupportMessage.deliveryLogRef ALREADY links a message
 * to that log row. So emailInbound.service.js's thread-matching can
 * look up a reply's In-Reply-To/References against
 * NotificationDeliveryLog.providerMessageId (channel=EMAIL) and walk
 * back through deliveryLogRef to find the ticket — zero new fields on
 * any existing model.
 *
 * Never throws — a send failure is recorded as a FAILED
 * NotificationDeliveryLog row and returned as {success:false,...},
 * matching NotificationService.send()'s own never-throw convention.
 * The caller (addAgentReply) must never roll back the already-created
 * SupportMessage because of an email delivery failure.
 */

import NotificationDispatcher from "../../notifications/services/NotificationDispatcher.js";
import NotificationDeliveryLog from "../../notifications/models/NotificationDeliveryLog.js";
import { NOTIFICATION_CHANNEL, DELIVERY_STATUS } from "../../../constants/notification.constants.js";
import SupportInboundEmailEvent from "../models/SupportInboundEmailEvent.js";
import { REQUESTER_TYPE } from "../constants/support.constants.js";
import logger from "../../../utils/logger.js";

function buildSubject(ticket) {
  return `Re: [${ticket.ticketNumber}] ${ticket.subject}`;
}

function buildTextBody({ agentBody, ticket }) {
  return [
    agentBody,
    "",
    "----",
    `This message is regarding Support ticket ${ticket.ticketNumber}.`,
    "Please reply directly to this email to continue the conversation — do not change the subject line.",
  ].join("\n");
}

/**
 * @param {object} params
 * @param {object} params.ticket - needs _id, ticketNumber, subject, requesterType, requesterRef
 * @param {object} params.message - the just-created SupportMessage (needs body)
 * @param {object} params.requester - { name, email } — the customer to send to
 * @returns {Promise<{ success: boolean, deliveryLogId: import("mongoose").Types.ObjectId }>}
 */
export async function sendAgentReplyEmail({ ticket, message, requester }) {
  const recipientType = ticket.requesterType === REQUESTER_TYPE.SALON_OWNER ? "SALON" : "USER";

  if (!requester?.email) {
    const log = await NotificationDeliveryLog.create({
      recipientType,
      recipientId: ticket.requesterRef,
      channel: NOTIFICATION_CHANNEL.EMAIL,
      status: DELIVERY_STATUS.FAILED,
      provider: "smtp",
      lastError: "REQUESTER_HAS_NO_EMAIL",
    });
    return { success: false, deliveryLogId: log._id };
  }

  // Threading — best-effort, never fatal. A missing/absent prior event
  // just means this is the ticket's first outbound reply; the email is
  // still sent, just without In-Reply-To/References.
  let inReplyTo = null;
  let references = [];
  try {
    const priorInbound = await SupportInboundEmailEvent.findOne({ matchedTicketRef: ticket._id, messageId: { $ne: null } })
      .sort({ createdAt: -1 })
      .select("messageId references")
      .lean();
    if (priorInbound?.messageId) {
      inReplyTo = priorInbound.messageId;
      references = [...(priorInbound.references || []), priorInbound.messageId];
    }
  } catch (err) {
    logger.warn("[emailOutbound] threading lookup failed (non-critical)", { error: err.message });
  }

  const startedAt = Date.now();
  let dispatchResult;
  try {
    dispatchResult = await NotificationDispatcher.dispatch(NOTIFICATION_CHANNEL.EMAIL, {
      to: requester.email,
      toName: requester.name || undefined,
      subject: buildSubject(ticket),
      text: buildTextBody({ agentBody: message.body, ticket }),
      headers: {
        ...(inReplyTo ? { "In-Reply-To": inReplyTo } : {}),
        ...(references.length ? { References: references.join(" ") } : {}),
      },
    });
  } catch (err) {
    dispatchResult = { success: false, provider: "smtp", messageId: null, error: err.message, latencyMs: Date.now() - startedAt };
  }

  const log = await NotificationDeliveryLog.create({
    recipientType,
    recipientId: ticket.requesterRef,
    channel: NOTIFICATION_CHANNEL.EMAIL,
    status: dispatchResult.success ? DELIVERY_STATUS.SENT : DELIVERY_STATUS.FAILED,
    provider: dispatchResult.provider || "smtp",
    providerMessageId: dispatchResult.messageId || null,
    sentAt: dispatchResult.success ? new Date() : null,
    lastError: dispatchResult.success ? null : (dispatchResult.error || "EMAIL_SEND_FAILED"),
  });

  return { success: dispatchResult.success, deliveryLogId: log._id };
}
