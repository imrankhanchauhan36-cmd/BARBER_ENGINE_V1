/**
 * BARBER ENGINE V1
 * backend/modules/support/services/callInbound.service.js
 *
 * Phase H — Call Support (inbound). The sole orchestrator for turning
 * normalized inbound-call LIFECYCLE EVENTS into either an attached or
 * newly-created ticket, plus the aggregate SupportCall row every such
 * event maintains. Never reimplements ticket lifecycle, routing,
 * assignment, or SLA — every one of those stays in
 * supportTicket.service.js / assignmentResolution.service.js /
 * routingResolution.service.js, unmodified. Sibling of
 * emailInbound.service.js / whatsappInbound.service.js — same overall
 * shape, adapted for a call's multi-event lifecycle (see below).
 *
 * Input contract (produced by a provider-specific adapter — see
 * providers/callInbound.devAdapter.js for the dev/test one):
 *   { providerEventId, providerCallId, eventType, fromPhoneNumber,
 *     toPhoneNumber, durationSeconds }
 *
 * TWO-MODEL SHAPE: SupportInboundCallEvent is the raw, append-only
 * per-DELIVERY idempotency ledger (unique providerEventId). SupportCall
 * is the aggregate, one-row-PER-CALL current state (unique
 * providerCallId), updated incrementally as events for the same call
 * arrive. Caller resolution and ticket matching/creation happen ONLY
 * on the FIRST event for a given providerCallId — every SUBSEQUENT
 * event for that same call is purely a lifecycle update to the
 * existing SupportCall row, via an ATOMIC CONDITIONAL update (never
 * re-running ticket matching, never creating a second ticket for the
 * same call). This is the critical guard against duplicate tickets
 * from a call's own repeated lifecycle events.
 *
 * THREADING: deliberately CHANNEL-AGNOSTIC, unlike emailInbound/
 * whatsappInbound.service.js (which each match only within their own
 * channel). A phone call is almost always "about my existing issue,"
 * regardless of which channel that issue started on — so the match
 * here is "does this caller have ANY open (non-terminal) ticket?", not
 * "does this caller have an open CALL ticket?". See the approved
 * design's §D/§G for the full reasoning.
 *
 * NO SupportMessage IS CREATED when a call attaches to an EXISTING
 * ticket — regardless of that ticket's channel. Forcing a channel=CALL
 * message into a possibly-differently-channeled conversation would
 * break the existing invariant that every message in a conversation
 * shares that conversation's channel, and a call has no natural text
 * body to put there anyway. The call's presence is fully represented
 * by its own SupportCall row (linked via ticketRef) plus an audit
 * event and a conversation preview update. A SupportMessage IS created
 * only when a call creates a BRAND NEW ticket (createTicketFromCall()
 * mirrors createTicketFromEmail()/createTicketFromWhatsApp()'s own
 * "every new ticket needs one opening message" convention — no
 * invariant is broken there, since the conversation is freshly created
 * AS channel=CALL).
 *
 * CUSTOMER IDENTIFICATION: fromPhoneNumber (provider format, digits
 * with country code) is normalized to the bare 10-digit Indian mobile
 * format User.phone requires — identical helper to
 * whatsappInbound.service.js's own normalizeToIndianMobile(). No User
 * is ever created here.
 */

import User from "../../../models/User.js";
import SupportTicket from "../models/SupportTicket.js";
import SupportConversation from "../models/SupportConversation.js";
import SupportInboundCallEvent, { SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES } from "../models/SupportInboundCallEvent.js";
import SupportCall from "../models/SupportCall.js";
import { createTicketFromCall } from "./supportTicket.service.js";
import { processCustomerMessageForBot } from "./supportBot.service.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { ACTOR_TYPE, AUDIT_ACTION, CHANNEL, CALL_DIRECTION, CALL_STATUS, TICKET_STATUS } from "../constants/support.constants.js";
import { emitToRoom } from "../../../socket/index.js";

const ELIGIBLE_REQUESTER_ROLES = ["USER", "OWNER"];

// India-only normalization — identical rule to whatsappInbound.service.js's
// own helper (not imported cross-file to keep each inbound service
// fully self-contained, matching the existing per-channel-file
// convention; the rule itself is a one-line constant, not business
// logic worth centralizing).
function normalizeToIndianMobile(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

const EVENT_TYPE_TO_STATUS = Object.freeze({
  INITIATED: CALL_STATUS.RINGING,
  RINGING: CALL_STATUS.RINGING,
  ANSWERED: CALL_STATUS.IN_PROGRESS,
  COMPLETED: CALL_STATUS.COMPLETED,
  FAILED: CALL_STATUS.FAILED,
  NO_ANSWER: CALL_STATUS.NO_ANSWER,
  BUSY: CALL_STATUS.BUSY,
});

const TERMINAL_EVENT_TYPES = new Set(["COMPLETED", "FAILED", "NO_ANSWER", "BUSY"]);

// Threading — see file header for why this is channel-agnostic,
// unlike email/whatsapp's own same-channel-only matching.
async function findOpenTicketForUser(userId) {
  return SupportTicket.findOne({
    requesterRef: userId,
    isDeleted: false,
    status: { $nin: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
  })
    .sort({ createdAt: -1 })
    .select("_id conversationRef currentAssignment")
    .lean();
}

// Applies a lifecycle event to an ALREADY-KNOWN call — atomic,
// conditional, never re-runs caller resolution or ticket matching.
async function applyLifecycleUpdate(existingCall, payload) {
  const update = {};

  if (payload.eventType === "ANSWERED" && !existingCall.answeredAt) {
    update.answeredAt = new Date();
  }
  if (TERMINAL_EVENT_TYPES.has(payload.eventType) && existingCall.status !== CALL_STATUS.COMPLETED) {
    update.endedAt = new Date();
    if (payload.durationSeconds != null) update.durationSeconds = payload.durationSeconds;
  }
  const newStatus = EVENT_TYPE_TO_STATUS[payload.eventType];
  if (newStatus && existingCall.status !== CALL_STATUS.COMPLETED) {
    update.status = newStatus;
  }

  if (Object.keys(update).length === 0) return existingCall;

  // Atomic conditional update — the { status: { $ne: COMPLETED } } guard
  // is what makes a duplicate/out-of-order event safe even if the
  // per-event ledger's own idempotency check were somehow bypassed
  // (see SupportCall.js's own header comment).
  const result = await SupportCall.findOneAndUpdate(
    { _id: existingCall._id, status: { $ne: CALL_STATUS.COMPLETED } },
    { $set: update },
    { new: true }
  );
  return result || existingCall;
}

/**
 * @param {object} payload - normalized inbound call event (see file header)
 * @param {import("socket.io").Server|null} [io]
 * @returns {Promise<{ duplicate: boolean, status: string, ticketId: string|null, callId: string|null }>}
 */
export async function processInboundCallEvent(payload, io = null) {
  const fromPhoneNumber = String(payload.fromPhoneNumber || "").trim();

  // ── IDEMPOTENCY GATE (per-delivery) — the unique index is the real
  // boundary ─────────────────────────────────────────────────────────
  let eventDoc;
  try {
    eventDoc = await SupportInboundCallEvent.create({
      providerEventId: payload.providerEventId,
      providerCallId: payload.providerCallId,
      eventType: payload.eventType,
      fromPhoneNumber,
      toPhoneNumber: payload.toPhoneNumber || null,
      status: SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES.FAILED, // provisional — updated below
    });
  } catch (err) {
    if (err.code === 11000) {
      return { duplicate: true, status: "DUPLICATE", ticketId: null, callId: null };
    }
    throw err;
  }

  try {
    // ── ALREADY-KNOWN CALL? Pure lifecycle update, no re-matching ────
    const existingCall = await SupportCall.findOne({ providerCallId: payload.providerCallId }).lean();
    if (existingCall) {
      const updatedCall = await applyLifecycleUpdate(existingCall, payload);

      await SupportInboundCallEvent.updateOne(
        { _id: eventDoc._id },
        {
          $set: {
            status: SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES.PROCESSED,
            matchedTicketRef: existingCall.ticketRef,
            matchedConversationRef: existingCall.conversationRef,
            matchedUserRef: existingCall.matchedUserRef,
            processedAt: new Date(),
          },
        }
      );

      return { duplicate: false, status: "LIFECYCLE_UPDATED", ticketId: String(existingCall.ticketRef), callId: String(updatedCall._id) };
    }

    // ── FIRST EVENT for this call — resolve caller, match/create ticket ─
    const normalizedPhone = normalizeToIndianMobile(fromPhoneNumber);
    const user = await User.findOne({ phone: normalizedPhone, isDeleted: { $ne: true } })
      .select("_id name role isActive")
      .lean();

    const isEligible = user && user.isActive && ELIGIBLE_REQUESTER_ROLES.includes(user.role);

    if (!isEligible) {
      await SupportInboundCallEvent.updateOne(
        { _id: eventDoc._id },
        { $set: { status: SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES.UNMATCHED_SENDER, processedAt: new Date() } }
      );
      return { duplicate: false, status: "UNMATCHED_SENDER", ticketId: null, callId: null };
    }

    const openTicket = await findOpenTicketForUser(user._id);
    let ticketId, conversationRef, agentRef;

    if (openTicket) {
      // ATTACH — no SupportMessage created, see file header.
      ticketId = openTicket._id;
      conversationRef = openTicket.conversationRef;
      agentRef = openTicket.currentAssignment?.agentRef || null;

      await SupportConversation.updateOne(
        { _id: conversationRef },
        { $set: { lastMessageAt: new Date(), lastMessagePreview: "\u{1F4DE} Call — see call history" } }
      );

      await recordSupportAuditEvent({
        ticketRef: ticketId,
        actorRef: user._id,
        actorType: ACTOR_TYPE.CUSTOMER,
        action: AUDIT_ACTION.CALL_LOGGED,
        entityId: ticketId,
        reason: "Inbound call attached to existing case",
      });

      emitToRoom(io, `user:${user._id}`, "support:message:new", {
        ticketId,
        senderType: "CUSTOMER",
        channel: CHANNEL.PHONE,
      });
    } else {
      // CREATE — mirrors createTicketFromEmail()/createTicketFromWhatsApp().
      const { ticket, message: createdMessage } = await createTicketFromCall({
        requesterId: user._id,
        requesterRole: user.role,
        subject: "Inbound phone call",
        body: "Customer called Support.",
        io,
      });
      ticketId = ticket._id;
      conversationRef = ticket.conversationRef;

      // Phase H — Bot Support. Additive, non-blocking, try/catch-
      // protected. Only the new-ticket path creates a customer
      // SupportMessage at all (per Call's own design — see this file's
      // header on why the "attach" path never does), so this is the
      // only place in this file the bot hook applies.
      try {
        await processCustomerMessageForBot({ message: createdMessage, ticket, io });
      } catch (err) {
        console.warn("[processInboundCallEvent] bot processing failed (non-critical):", err.message);
      }

      // routeAndAssignTicket() runs (awaited) INSIDE createTicketFromCall()
      // before it returns, but the in-memory `ticket` object returned
      // there still reflects pre-routing state — re-reading the
      // now-current assignment here is what makes SupportCall.agentRef
      // accurate rather than always-null for a brand-new ticket.
      const freshTicket = await SupportTicket.findById(ticketId).select("currentAssignment").lean();
      agentRef = freshTicket?.currentAssignment?.agentRef || null;
    }

    // Race guard: two genuinely different first-events for the same
    // providerCallId (e.g. RINGING and ANSWERED delivered concurrently
    // before either request's read of SupportCall completed) can both
    // reach this point believing they're first. providerCallId's
    // unique index is the real boundary — if this loses the race, the
    // winner's row already exists; fold this event into it as an
    // ordinary lifecycle update instead of surfacing a spurious
    // failure for a perfectly legitimate concurrent delivery.
    let call;
    try {
      call = await SupportCall.create({
        providerCallId: payload.providerCallId,
        provider: null,
        direction: CALL_DIRECTION.INBOUND,
        fromPhoneNumber,
        toPhoneNumber: payload.toPhoneNumber || null,
        status: EVENT_TYPE_TO_STATUS[payload.eventType] || CALL_STATUS.RINGING,
        startedAt: new Date(),
        ticketRef: ticketId,
        conversationRef,
        matchedUserRef: user._id,
        agentRef,
      });
    } catch (err) {
      if (err.code === 11000) {
        const winnerCall = await SupportCall.findOne({ providerCallId: payload.providerCallId }).lean();
        call = await applyLifecycleUpdate(winnerCall, payload);
        ticketId = winnerCall.ticketRef;
        conversationRef = winnerCall.conversationRef;
      } else {
        throw err;
      }
    }

    await SupportInboundCallEvent.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          status: SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES.PROCESSED,
          matchedUserRef: user._id,
          matchedTicketRef: ticketId,
          matchedConversationRef: conversationRef,
          processedAt: new Date(),
        },
      }
    );

    return { duplicate: false, status: openTicket ? "ATTACHED" : "CREATED", ticketId: String(ticketId), callId: String(call._id) };
  } catch (err) {
    await SupportInboundCallEvent.updateOne(
      { _id: eventDoc._id },
      { $set: { status: SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES.FAILED, errorMessage: String(err.message || err).slice(0, 500), processedAt: new Date() } }
    );
    throw err;
  }
}
