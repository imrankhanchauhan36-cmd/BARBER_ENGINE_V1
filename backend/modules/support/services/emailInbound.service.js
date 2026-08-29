/**
 * BARBER ENGINE V1
 * backend/modules/support/services/emailInbound.service.js
 *
 * Phase H Step 9 — Email Support (inbound). The sole orchestrator for
 * turning one normalized inbound-email payload into either a new
 * ticket or an appended message on an existing one. Never reimplements
 * ticket lifecycle, routing, assignment, or SLA — every one of those
 * stays in supportTicket.service.js / assignmentResolution.service.js
 * / routingResolution.service.js, unmodified, called exactly as the
 * in-app path already calls them.
 *
 * Input contract (produced by a provider-specific adapter — see
 * providers/emailInbound.devAdapter.js for the dev/test one; a future
 * real-provider adapter produces the exact same shape):
 *   { providerEventId, messageId, inReplyTo, references, fromEmail,
 *     toEmail, subject, textBody, attachments }
 *
 * IDEMPOTENCY: the first statement below is always the
 * SupportInboundEmailEvent insert. Its unique index on providerEventId
 * is the sole authority — an E11000 here means this exact event was
 * already processed (by this call or a concurrent/retried one) and is
 * treated as a safe no-op, never re-processed, matching the existing
 * payment-webhook idempotency idiom already used elsewhere in this
 * codebase (Transaction.js / WalletTransaction.js).
 *
 * THREADING: checked in two places, in order —
 *   1. A PRIOR INBOUND email: SupportInboundEmailEvent.messageId.
 *   2. A PRIOR OUTBOUND agent reply: NotificationDeliveryLog.
 *      providerMessageId (channel=EMAIL) → SupportMessage.deliveryLogRef
 *      → ticketRef. This is the refinement found during
 *      implementation — a customer's reply almost always threads
 *      against the agent's last outbound email, not the original
 *      inbound one — and it uses two fields that already existed
 *      before this phase, no new field added anywhere for it.
 *   Neither match → a ticketNumber token parsed from the subject is
 *   tried as a last resort (never the primary mechanism). Neither →
 *   a new ticket.
 *
 * CUSTOMER IDENTIFICATION: fromEmail is matched against User.email
 * (case-insensitive, already lowercased by the model/normalization).
 * No User is ever created here. A match whose role is not USER/OWNER
 * (e.g. an ADMIN/AGENT's own address) is treated as unmatched for
 * ticket-creation purposes — this module never creates a "customer"
 * ticket on behalf of a staff account.
 */

import User from "../../../models/User.js";
import SupportTicket from "../models/SupportTicket.js";
import SupportConversation from "../models/SupportConversation.js";
import SupportMessage from "../models/SupportMessage.js";
import SupportInboundEmailEvent, { SUPPORT_INBOUND_EMAIL_STATUS_VALUES } from "../models/SupportInboundEmailEvent.js";
import NotificationDeliveryLog from "../../notifications/models/NotificationDeliveryLog.js";
import { createTicketFromEmail } from "./supportTicket.service.js";
import { processCustomerMessageForBot } from "./supportBot.service.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { ACTOR_TYPE, AUDIT_ACTION, CHANNEL, MESSAGE_VISIBILITY, SENDER_TYPE } from "../constants/support.constants.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { emitToRoom } from "../../../socket/index.js";

const ELIGIBLE_REQUESTER_ROLES = ["USER", "OWNER"];

// SupportMessage.body has an EXISTING maxlength:5000 constraint (an
// already-enforced limit this module does not weaken) — a real inbound
// email (signatures, quoted thread history) routinely exceeds it. This
// truncates gracefully, once, up front, so both the append-to-existing
// and create-new-ticket paths downstream always see a body that will
// pass validation, instead of letting Mongoose throw a 422 mid-webhook
// (which would otherwise force an unwanted provider retry loop).
const SUPPORT_MESSAGE_BODY_MAX_LENGTH = 5000;
const TRUNCATION_SUFFIX = "\n\n[message truncated]";

function truncateBody(text) {
  const body = String(text || "");
  if (body.length <= SUPPORT_MESSAGE_BODY_MAX_LENGTH) return body;
  return body.slice(0, SUPPORT_MESSAGE_BODY_MAX_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

// SupportTicket.subject has an EXISTING maxlength:200 constraint — a
// long reply-chain subject ("Re: Re: Re: ...") can exceed it; same
// graceful-truncation reasoning as truncateBody() above.
const SUPPORT_TICKET_SUBJECT_MAX_LENGTH = 200;

function truncateSubject(text) {
  const subject = String(text || "(no subject)");
  return subject.length <= SUPPORT_TICKET_SUBJECT_MAX_LENGTH
    ? subject
    : subject.slice(0, SUPPORT_TICKET_SUBJECT_MAX_LENGTH);
}

// "[TKT-XXXXXXXX]"-shaped token — matches whatever generateTicketNumber()
// in supportTicket.service.js actually produces, read from the subject
// as a last-resort fallback only, never the primary threading mechanism.
function extractTicketNumberFromSubject(subject) {
  if (!subject) return null;
  const match = subject.match(/\[([A-Z0-9-]{6,40})\]/);
  return match ? match[1] : null;
}

async function findMatchedTicketId({ inReplyTo, references, subject }) {
  const candidateIds = [inReplyTo, ...(references || [])].filter(Boolean);

  if (candidateIds.length > 0) {
    // 1. A prior INBOUND email.
    const priorInbound = await SupportInboundEmailEvent.findOne({ messageId: { $in: candidateIds } })
      .select("matchedTicketRef")
      .lean();
    if (priorInbound?.matchedTicketRef) return priorInbound.matchedTicketRef;

    // 2. A prior OUTBOUND agent reply — see file header for why this
    // is necessary and why it needed no new field.
    const priorDeliveryLog = await NotificationDeliveryLog.findOne({
      channel: NOTIFICATION_CHANNEL.EMAIL,
      providerMessageId: { $in: candidateIds },
    }).select("_id").lean();
    if (priorDeliveryLog) {
      const priorMessage = await SupportMessage.findOne({ deliveryLogRef: priorDeliveryLog._id })
        .select("ticketRef")
        .lean();
      if (priorMessage?.ticketRef) return priorMessage.ticketRef;
    }
  }

  // 3. Subject-token fallback — last resort only.
  const ticketNumber = extractTicketNumberFromSubject(subject);
  if (ticketNumber) {
    const ticket = await SupportTicket.findOne({ ticketNumber, isDeleted: false }).select("_id").lean();
    if (ticket) return ticket._id;
  }

  return null;
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
    attachments: payload.attachments || [],
    channel: CHANNEL.EMAIL,
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

  await SupportInboundEmailEvent.updateOne(
    { _id: eventDoc._id },
    { $set: { status: SUPPORT_INBOUND_EMAIL_STATUS_VALUES.PROCESSED, matchedTicketRef: ticket._id, matchedConversationRef: ticket.conversationRef, matchedUserRef: ticket.requesterRef } }
  );

  return { ticket, message };
}

/**
 * @param {object} payload - normalized inbound email (see file header)
 * @param {import("socket.io").Server|null} [io]
 * @returns {Promise<{ duplicate: boolean, status: string, ticketId: string|null }>}
 */
export async function processInboundEmail(payload, io = null) {
  const fromEmail = String(payload.fromEmail || "").trim().toLowerCase();
  const textBody = truncateBody(payload.textBody);

  // ── IDEMPOTENCY GATE — the unique index is the real boundary ──────
  let eventDoc;
  try {
    eventDoc = await SupportInboundEmailEvent.create({
      providerEventId: payload.providerEventId,
      messageId: payload.messageId || null,
      inReplyTo: payload.inReplyTo || null,
      references: payload.references || [],
      fromEmail,
      toEmail: payload.toEmail || null,
      subject: payload.subject || null,
      status: SUPPORT_INBOUND_EMAIL_STATUS_VALUES.FAILED, // provisional — updated below
    });
  } catch (err) {
    if (err.code === 11000) {
      return { duplicate: true, status: "DUPLICATE", ticketId: null };
    }
    throw err;
  }

  try {
    // ── THREAD MATCH ────────────────────────────────────────────────
    const matchedTicketId = await findMatchedTicketId({
      inReplyTo: payload.inReplyTo,
      references: payload.references,
      subject: payload.subject,
    });

    if (matchedTicketId) {
      const result = await appendToExistingTicket({ ticketId: matchedTicketId, payload: { ...payload, textBody }, eventDoc, io });
      if (result) {
        // Phase H — Bot Support. Additive, non-blocking, try/catch-
        // protected — same convention as addCustomerMessage()'s own hook.
        try {
          await processCustomerMessageForBot({ message: result.message, ticket: result.ticket, io });
        } catch (err) {
          console.warn("[processInboundEmail] bot processing failed (non-critical):", err.message);
        }
        return { duplicate: false, status: "APPENDED", ticketId: String(result.ticket._id) };
      }
      // matched-but-unusable ticket falls through to "no match" below,
      // same as if no match had been found at all.
    }

    // ── NO MATCH — resolve sender, create or hold for triage ────────
    const user = await User.findOne({ email: fromEmail, isDeleted: { $ne: true } })
      .select("_id name role isActive")
      .lean();

    const isEligible = user && user.isActive && ELIGIBLE_REQUESTER_ROLES.includes(user.role);

    if (!isEligible) {
      await SupportInboundEmailEvent.updateOne(
        { _id: eventDoc._id },
        { $set: { status: SUPPORT_INBOUND_EMAIL_STATUS_VALUES.UNMATCHED_SENDER } }
      );
      return { duplicate: false, status: "UNMATCHED_SENDER", ticketId: null };
    }

    const { ticket, message } = await createTicketFromEmail({
      requesterId: user._id,
      requesterRole: user.role,
      subject: truncateSubject(payload.subject),
      body: textBody,
      attachments: payload.attachments || [],
      io,
    });

    // Phase H — Bot Support. Additive, non-blocking, try/catch-protected.
    try {
      await processCustomerMessageForBot({ message, ticket, io });
    } catch (err) {
      console.warn("[processInboundEmail] bot processing failed (non-critical):", err.message);
    }

    await SupportInboundEmailEvent.updateOne(
      { _id: eventDoc._id },
      { $set: { status: SUPPORT_INBOUND_EMAIL_STATUS_VALUES.PROCESSED, matchedUserRef: user._id, matchedTicketRef: ticket._id, matchedConversationRef: ticket.conversationRef } }
    );

    return { duplicate: false, status: "CREATED", ticketId: String(ticket._id) };
  } catch (err) {
    await SupportInboundEmailEvent.updateOne(
      { _id: eventDoc._id },
      { $set: { status: SUPPORT_INBOUND_EMAIL_STATUS_VALUES.FAILED, errorMessage: String(err.message || err).slice(0, 500) } }
    );
    throw err;
  }
}
