/**
 * BARBER ENGINE V1
 * backend/modules/support/services/whatsappInbound.service.js
 *
 * Phase H — WhatsApp Support (inbound). The sole orchestrator for
 * turning one normalized inbound-WhatsApp payload into either a new
 * ticket or an appended message on an existing one. Never reimplements
 * ticket lifecycle, routing, assignment, or SLA — every one of those
 * stays in supportTicket.service.js / assignmentResolution.service.js
 * / routingResolution.service.js, unmodified, called exactly as the
 * IN_APP/Email paths already call them. Sibling of
 * emailInbound.service.js — same shape, different threading and
 * customer-identification mechanics (see below for why).
 *
 * Input contract (produced by a provider-specific adapter — see
 * providers/whatsappInbound.devAdapter.js for the dev/test one; a
 * future real-provider adapter produces the exact same shape):
 *   { providerEventId, contextMessageId, fromPhoneNumber,
 *     toPhoneNumber, textBody }
 *
 * IDEMPOTENCY: the first statement below is always the
 * SupportInboundWhatsAppEvent insert. Its unique index on
 * providerEventId is the sole authority — an E11000 here means this
 * exact event was already processed (by this call or a concurrent/
 * retried one) and is treated as a safe no-op, never re-processed —
 * same idiom as emailInbound.service.js.
 *
 * THREADING: deliberately NOT a copy of Email's Message-ID/In-Reply-To
 * chain — WhatsApp has no such header convention for most messages,
 * and a customer's phone number is itself the stable, always-present
 * conversation identity. Checked in order:
 *   1. PRIMARY — does the matched User have an existing NON-TERMINAL
 *      (status not RESOLVED/CLOSED) SupportTicket whose conversation
 *      channel is WHATSAPP? Append to it.
 *   2. SECONDARY — WhatsApp's OPTIONAL reply-to id (contextMessageId)
 *      matched against a PRIOR OUTBOUND agent message's
 *      NotificationDeliveryLog.providerMessageId (channel=WHATSAPP) ->
 *      SupportMessage.deliveryLogRef -> ticketRef. Same "walk back
 *      through fields that already exist" technique
 *      emailOutbound.service.js's own threading refinement uses —
 *      zero new fields added anywhere for it.
 *   Neither match -> a new ticket.
 *
 * CUSTOMER IDENTIFICATION: fromPhoneNumber (provider format, digits
 * with country code) is normalized to the bare 10-digit Indian mobile
 * format User.phone requires (stripping a leading "91" country code —
 * this app is India-only already, User.phone's own regex hard-codes
 * that assumption, so this is not a new constraint) and matched
 * against User.phone. No User is ever created here. A match whose
 * role is not USER/OWNER is treated as unmatched for ticket-creation
 * purposes, exactly matching emailInbound.service.js's own rule.
 */

import User from "../../../models/User.js";
import SupportTicket from "../models/SupportTicket.js";
import SupportConversation from "../models/SupportConversation.js";
import SupportMessage from "../models/SupportMessage.js";
import SupportInboundWhatsAppEvent, { SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES } from "../models/SupportInboundWhatsAppEvent.js";
import NotificationDeliveryLog from "../../notifications/models/NotificationDeliveryLog.js";
import { createTicketFromWhatsApp } from "./supportTicket.service.js";
import { processCustomerMessageForBot } from "./supportBot.service.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { ACTOR_TYPE, AUDIT_ACTION, CHANNEL, MESSAGE_VISIBILITY, SENDER_TYPE, TICKET_STATUS } from "../constants/support.constants.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { emitToRoom } from "../../../socket/index.js";

const ELIGIBLE_REQUESTER_ROLES = ["USER", "OWNER"];

// India-only normalization (matches User.phone's own regex assumption
// elsewhere in this codebase) — strips a "91" country-code prefix if
// present, leaving the bare 10-digit format. Never guesses/truncates
// a malformed number; a number that doesn't reduce to 10 digits simply
// won't match any User, which is the correct, safe outcome.
function normalizeToIndianMobile(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

// Primary threading — see file header. Bounded by one user's small
// number of concurrently-open tickets (in practice almost always 0 or
// 1), never a collection-wide scan.
async function findOpenWhatsAppTicketId(userId) {
  const openTickets = await SupportTicket.find({
    requesterRef: userId,
    isDeleted: false,
    status: { $nin: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
  })
    .select("_id conversationRef")
    .sort({ createdAt: -1 })
    .lean();

  if (openTickets.length === 0) return null;

  const conversationIds = openTickets.map((t) => t.conversationRef);
  const whatsappConversations = await SupportConversation.find({
    _id: { $in: conversationIds },
    channel: CHANNEL.WHATSAPP,
  })
    .select("_id")
    .lean();
  const whatsappConversationIdSet = new Set(whatsappConversations.map((c) => String(c._id)));

  const match = openTickets.find((t) => whatsappConversationIdSet.has(String(t.conversationRef)));
  return match ? match._id : null;
}

// Secondary threading (disambiguation-by-reply-context) — see file
// header. Only consulted when the primary check above finds nothing.
async function findTicketIdByContextMessage(contextMessageId) {
  if (!contextMessageId) return null;

  const priorDeliveryLog = await NotificationDeliveryLog.findOne({
    channel: NOTIFICATION_CHANNEL.WHATSAPP,
    providerMessageId: contextMessageId,
  })
    .select("_id")
    .lean();
  if (!priorDeliveryLog) return null;

  const priorMessage = await SupportMessage.findOne({ deliveryLogRef: priorDeliveryLog._id })
    .select("ticketRef")
    .lean();
  return priorMessage?.ticketRef || null;
}

async function findMatchedTicketId({ userId, contextMessageId }) {
  const primaryMatch = await findOpenWhatsAppTicketId(userId);
  if (primaryMatch) return primaryMatch;

  return findTicketIdByContextMessage(contextMessageId);
}

async function appendToExistingTicket({ ticketId, payload, eventDoc, io }) {
  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket || !ticket.conversationRef) {
    // The matched ticket vanished or has no conversation (defensive
    // only — should be unreachable) — fall back to treating this as
    // unresolvable rather than crashing the whole webhook.
    return null;
  }

  const message = await SupportMessage.create({
    conversationRef: ticket.conversationRef,
    ticketRef: ticket._id,
    senderRef: ticket.requesterRef,
    senderType: SENDER_TYPE.CUSTOMER,
    visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
    body: payload.textBody,
    attachments: [],
    channel: CHANNEL.WHATSAPP,
  });

  await SupportConversation.updateOne(
    { _id: ticket.conversationRef },
    { $set: { lastMessageAt: new Date(), lastMessagePreview: payload.textBody.slice(0, 300) } }
  );

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: ticket.requesterRef,
    actorType: ACTOR_TYPE.CUSTOMER,
    action: AUDIT_ACTION.CUSTOMER_REPLY,
    entityId: ticket._id,
  });

  emitToRoom(io, `user:${ticket.requesterRef}`, "support:message:new", {
    ticketId: ticket._id,
    messageId: message._id,
    senderType: SENDER_TYPE.CUSTOMER,
  });

  await SupportInboundWhatsAppEvent.updateOne(
    { _id: eventDoc._id },
    {
      $set: {
        status: SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES.PROCESSED,
        matchedTicketRef: ticket._id,
        matchedConversationRef: ticket.conversationRef,
        matchedUserRef: ticket.requesterRef,
        processedAt: new Date(),
      },
    }
  );

  return { ticket, message };
}

/**
 * @param {object} payload - normalized inbound WhatsApp message (see file header)
 * @param {import("socket.io").Server|null} [io]
 * @returns {Promise<{ duplicate: boolean, status: string, ticketId: string|null }>}
 */
export async function processInboundWhatsApp(payload, io = null) {
  const fromPhoneNumber = String(payload.fromPhoneNumber || "").trim();

  // ── IDEMPOTENCY GATE — the unique index is the real boundary ──────
  let eventDoc;
  try {
    eventDoc = await SupportInboundWhatsAppEvent.create({
      providerEventId: payload.providerEventId,
      contextMessageId: payload.contextMessageId || null,
      fromPhoneNumber,
      toPhoneNumber: payload.toPhoneNumber || null,
      textBody: payload.textBody,
      status: SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES.FAILED, // provisional — updated below
    });
  } catch (err) {
    if (err.code === 11000) {
      return { duplicate: true, status: "DUPLICATE", ticketId: null };
    }
    throw err;
  }

  try {
    // ── RESOLVE SENDER FIRST — threading depends on knowing the user ──
    const normalizedPhone = normalizeToIndianMobile(fromPhoneNumber);
    const user = await User.findOne({ phone: normalizedPhone, isDeleted: { $ne: true } })
      .select("_id name role isActive")
      .lean();

    const isEligible = user && user.isActive && ELIGIBLE_REQUESTER_ROLES.includes(user.role);

    if (!isEligible) {
      await SupportInboundWhatsAppEvent.updateOne(
        { _id: eventDoc._id },
        { $set: { status: SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES.UNMATCHED_SENDER, processedAt: new Date() } }
      );
      return { duplicate: false, status: "UNMATCHED_SENDER", ticketId: null };
    }

    // ── THREAD MATCH ────────────────────────────────────────────────
    const matchedTicketId = await findMatchedTicketId({
      userId: user._id,
      contextMessageId: payload.contextMessageId,
    });

    if (matchedTicketId) {
      const result = await appendToExistingTicket({ ticketId: matchedTicketId, payload, eventDoc, io });
      if (result) {
        // Phase H — Bot Support. Additive, non-blocking, try/catch-protected.
        try {
          await processCustomerMessageForBot({ message: result.message, ticket: result.ticket, io });
        } catch (err) {
          console.warn("[processInboundWhatsApp] bot processing failed (non-critical):", err.message);
        }
        return { duplicate: false, status: "APPENDED", ticketId: String(result.ticket._id) };
      }
      // matched-but-unusable ticket falls through to "create new" below,
      // same as if no match had been found at all.
    }

    // ── NO MATCH — create a new ticket ──────────────────────────────
    const { ticket, message } = await createTicketFromWhatsApp({
      requesterId: user._id,
      requesterRole: user.role,
      subject: payload.textBody.length > 60 ? `${payload.textBody.slice(0, 57)}...` : payload.textBody,
      body: payload.textBody,
      io,
    });

    // Phase H — Bot Support. Additive, non-blocking, try/catch-protected.
    try {
      await processCustomerMessageForBot({ message, ticket, io });
    } catch (err) {
      console.warn("[processInboundWhatsApp] bot processing failed (non-critical):", err.message);
    }

    await SupportInboundWhatsAppEvent.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          status: SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES.PROCESSED,
          matchedUserRef: user._id,
          matchedTicketRef: ticket._id,
          matchedConversationRef: ticket.conversationRef,
          processedAt: new Date(),
        },
      }
    );

    return { duplicate: false, status: "CREATED", ticketId: String(ticket._id) };
  } catch (err) {
    await SupportInboundWhatsAppEvent.updateOne(
      { _id: eventDoc._id },
      { $set: { status: SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES.FAILED, errorMessage: String(err.message || err).slice(0, 500), processedAt: new Date() } }
    );
    throw err;
  }
}
