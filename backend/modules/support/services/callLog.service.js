/**
 * BARBER ENGINE V1
 * backend/modules/support/services/callLog.service.js
 *
 * Phase H — Call Support. Agent-facing call actions — manually logging
 * a call against a ticket (inbound the agent took outside the webhook
 * path, or an outbound callback) and recording/updating its outcome.
 * Deliberately separate from callInbound.service.js (webhook-driven,
 * unauthenticated) and from supportTicket.service.js's addAgentReply()
 * (a text-reply action, not a telephony one — see the approved
 * design's §D/§F for why a callback is not routed through
 * addAgentReply()).
 *
 * No SupportMessage is created by either function here — same
 * reasoning as the inbound "attach" path: a call has no natural text
 * body, and the case's existing conversation may be a different
 * channel entirely. The call is fully represented by its own
 * SupportCall row plus an audit event.
 *
 * Ownership is enforced identically to addAgentReply()/
 * addAgentInternalNote() — only the ticket's currently-assigned agent
 * may act here. No SUPPORT_ADMIN/India-ADMIN mutating endpoint is
 * added in this phase (per the approved design's "minimal, no
 * unnecessary call-center workflow" instruction) — those roles already
 * retain full READ access via the existing admin ticket-detail/
 * channel-history surface.
 */

import mongoose from "mongoose";
import crypto from "crypto";
import User from "../../../models/User.js";
import SupportTicket from "../models/SupportTicket.js";
import SupportCall from "../models/SupportCall.js";
import SupportInboundCallEvent from "../models/SupportInboundCallEvent.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { ACTOR_TYPE, AUDIT_ACTION, CALL_DIRECTION, CALL_STATUS, CALL_OUTCOME } from "../constants/support.constants.js";
import { Errors } from "../../../utils/response.js";
import { initiateOutboundCall } from "../providers/CallProvider.js";

function assertOwnsTicket(ticket, agentUserId) {
  if (!ticket.currentAssignment?.agentRef || ticket.currentAssignment.agentRef.toString() !== agentUserId.toString()) {
    throw Errors.forbidden("This ticket is not currently assigned to you");
  }
}

/**
 * Manually log a call against a ticket — no real provider involved
 * (an agent recording a call that already happened, or an intent to
 * call back). providerCallId is synthesized (there is no real
 * provider event backing this) so it can still satisfy SupportCall's
 * unique identity index without colliding with any genuine webhook-
 * originated call.
 *
 * @param {object} params
 * @param {string} params.agentUserId
 * @param {string} params.ticketId
 * @param {"INBOUND"|"OUTBOUND"} params.direction
 * @param {number|null} [params.durationSeconds]
 * @param {string|null} [params.outcome] - one of CALL_OUTCOME, optional at log time
 * @param {string|null} [params.outcomeNotes]
 * @returns {Promise<object>} the created SupportCall
 */
export async function logAgentCall({ agentUserId, ticketId, direction, durationSeconds = null, outcome = null, outcomeNotes = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");
  if (!Object.values(CALL_DIRECTION).includes(direction)) throw Errors.badRequest("Invalid call direction");
  if (outcome && !Object.values(CALL_OUTCOME).includes(outcome)) throw Errors.badRequest("Invalid call outcome");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  assertOwnsTicket(ticket, agentUserId);

  const requester = await User.findOne({ _id: ticket.requesterRef, isDeleted: { $ne: true } }).select("phone").lean();

  // OUTBOUND — the agent is initiating a callback right now; attempt a
  // genuine provider dispatch. INBOUND — the call already happened
  // through whatever means; there is nothing to dispatch, this is pure
  // record-keeping. Never throws either way — a provider failure must
  // never lose the agent's own call-logging action (same non-blocking
  // convention as sendAgentReplyEmail()/sendAgentReplyWhatsApp()).
  let provider = "manual";
  let providerCallId = `manual:${crypto.randomUUID()}`;
  let status = CALL_STATUS.COMPLETED;
  let providerMeta = null;

  if (direction === CALL_DIRECTION.OUTBOUND && requester?.phone) {
    const dispatch = await initiateOutboundCall({ to: `91${requester.phone}` });
    provider = "call-provider";
    if (dispatch.success && dispatch.providerCallId) {
      providerCallId = dispatch.providerCallId;
      status = CALL_STATUS.RINGING;
    } else {
      providerMeta = { error: dispatch.error };
      status = CALL_STATUS.FAILED;
    }
  }

  const call = await SupportCall.create({
    providerCallId,
    provider,
    direction,
    fromPhoneNumber: requester?.phone ? `91${requester.phone}` : "unknown",
    status,
    startedAt: new Date(),
    endedAt: direction === CALL_DIRECTION.INBOUND ? new Date() : null,
    durationSeconds,
    ticketRef: ticket._id,
    conversationRef: ticket.conversationRef,
    matchedUserRef: ticket.requesterRef,
    agentRef: agentUserId,
    outcome,
    outcomeNotes,
    providerMeta,
  });

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: agentUserId,
    actorType: ACTOR_TYPE.AGENT,
    action: AUDIT_ACTION.CALL_LOGGED,
    entityId: ticket._id,
    reason: `${direction} call logged by agent`,
  });

  return call;
}

/**
 * Record or update a call's outcome — the one, deliberately minimal
 * post-call action (no workflow, no state machine beyond this single
 * field + free-text notes).
 */
export async function updateCallOutcome({ agentUserId, ticketId, callId, outcome, outcomeNotes = null }) {
  if (!mongoose.isValidObjectId(ticketId) || !mongoose.isValidObjectId(callId)) throw Errors.notFound("Call not found");
  if (!Object.values(CALL_OUTCOME).includes(outcome)) throw Errors.badRequest("Invalid call outcome");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  assertOwnsTicket(ticket, agentUserId);

  const call = await SupportCall.findOneAndUpdate(
    { _id: callId, ticketRef: ticket._id },
    { $set: { outcome, outcomeNotes } },
    { new: true }
  );
  if (!call) throw Errors.notFound("Call not found");

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: agentUserId,
    actorType: ACTOR_TYPE.AGENT,
    action: AUDIT_ACTION.CALL_LOGGED,
    entityId: ticket._id,
    reason: `Call outcome recorded: ${outcome}`,
  });

  return call;
}

/**
 * Read-only call history for a ticket — every SupportCall row plus its
 * raw lifecycle events (from SupportInboundCallEvent, when the call
 * originated from the webhook path; empty for a manually-logged call).
 * Kept as its own small, additive endpoint rather than folding into or
 * renaming the existing emailHistory.service.js — that would touch
 * Email's own already-tested code path, which this phase must not do.
 */
export async function getTicketCallHistory({ ticketId }) {
  const calls = await SupportCall.find({ ticketRef: ticketId })
    .sort({ createdAt: -1 })
    .lean();

  const providerCallIds = calls.map((c) => c.providerCallId);
  const events = providerCallIds.length
    ? await SupportInboundCallEvent.find({ providerCallId: { $in: providerCallIds } })
        .sort({ createdAt: 1 })
        .select("providerCallId eventType status createdAt")
        .lean()
    : [];

  return { calls, events };
}
