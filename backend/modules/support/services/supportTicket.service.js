/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportTicket.service.js
 *
 * Phase C — Support Core business logic. Controllers stay thin (DTO
 * shaping + calling into this file), matching the KYC module's own
 * controller→service→model layering (Phase B's explicit recommendation).
 *
 * Reuses, without modification: Salon/Booking models (read-only
 * reference), utils/pagination.js (its first real consumer), the
 * Errors/AppError factory, and the mongoose.startSession() transaction
 * pattern already proven in salon.onboarding.controller.js's
 * savePhotos() / district.controller.js's assignDistrictAdmin().
 */

import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../../../models/Booking.js";
import Salon from "../../../models/Salon.js";
import User from "../../../models/User.js";
import { emitToRoom } from "../../../socket/index.js";
import NotificationService from "../../../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../../../modules/notifications/constants/notificationEvents.constants.js";
import { Errors } from "../../../utils/response.js";
import { buildPagination, buildStatusFilter, paginatedQuery } from "../../../utils/pagination.js";
import SupportCategory from "../models/SupportCategory.js";
import SupportConversation from "../models/SupportConversation.js";
import SupportMessage from "../models/SupportMessage.js";
import SupportTicket from "../models/SupportTicket.js";
import { sendAgentReplyEmail } from "./emailOutbound.service.js";
import { sendAgentReplyWhatsApp } from "./whatsappOutbound.service.js";
import { processCustomerMessageForBot } from "./supportBot.service.js";
import {
  ACTOR_TYPE,
  AUDIT_ACTION,
  CHANNEL,
  CONVERSATION_STATUS,
  MESSAGE_VISIBILITY,
  PRIORITY,
  REQUESTER_TYPE,
  ROUTING_SNAPSHOT_SOURCE,
  SENDER_TYPE,
  TICKET_STATUS,
} from "../constants/support.constants.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { transitionTicketStatus } from "./ticketLifecycle.service.js";
import {
  routeAndAssignTicket,
  resolveTicketAssignment,
  unassignTicket,
  reassignTicket,
} from "./assignmentResolution.service.js";
import { resolveEffectiveSlaPolicy } from "./slaPolicy.service.js";

const MAX_TICKET_NUMBER_ATTEMPTS = 3;

function generateTicketNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = crypto.randomInt(100000, 999999);
  return `ZM-${y}${m}${d}-${rand}`;
}

// ── Ownership resolution for relatedSalonRef/relatedBookingRef ─────
// Never trusts either field as authority by itself — every path
// verifies the requester actually has a legitimate relationship to
// the referenced salon/booking before accepting it (Phase C §H step 4).
async function resolveRelatedReferences({ relatedBookingRef, relatedSalonRef, requesterId, role }) {
  if (relatedBookingRef) {
    const booking = await Booking.findById(relatedBookingRef).select("userRef salonRef").lean();
    if (!booking) throw Errors.badRequest("relatedBookingRef does not exist");

    if (role === "USER") {
      if (booking.userRef?.toString() !== requesterId.toString()) {
        throw Errors.forbidden("This booking does not belong to you");
      }
    } else if (role === "OWNER") {
      const salon = await Salon.findOne({ _id: booking.salonRef, ownerId: requesterId }).select("_id").lean();
      if (!salon) throw Errors.forbidden("This booking is not linked to your salon");
    }

    return { resolvedSalonId: booking.salonRef, resolvedBookingId: booking._id };
  }

  if (relatedSalonRef) {
    if (role !== "OWNER") {
      // A USER referencing a salon with no booking proof would let
      // them attach a ticket to an arbitrary salon they have no
      // established relationship with — rejected.
      throw Errors.badRequest("relatedSalonRef requires a valid relatedBookingRef for this account type");
    }
    const salon = await Salon.findOne({ _id: relatedSalonRef, ownerId: requesterId }).select("_id").lean();
    if (!salon) throw Errors.forbidden("This salon does not belong to you");
    return { resolvedSalonId: salon._id, resolvedBookingId: null };
  }

  return { resolvedSalonId: null, resolvedBookingId: null };
}

// Routing/Coverage resolution (Phase E) does not exist yet — this
// only captures the snapshot, never resolves a team/queue from it.
async function captureRoutingSnapshot(salonId) {
  if (!salonId) {
    return { source: ROUTING_SNAPSHOT_SOURCE.NONE, capturedAt: new Date() };
  }
  const salon = await Salon.findById(salonId).select("location.territory").lean();
  const territory = salon?.location?.territory || {};
  return {
    countryRef: territory.countryRef || null,
    stateRef: territory.stateRef || null,
    districtRef: territory.districtRef || null,
    cityRef: territory.cityRef || null,
    areaRef: territory.areaRef || null,
    capturedAt: new Date(),
    source: ROUTING_SNAPSHOT_SOURCE.SALON_TERRITORY,
  };
}

// Notification.type/actionType/entityType enums (models/Notification.js)
// don't have a SUPPORT-specific value and are out of scope to change
// here — SYSTEM is the closest existing fit, same as any other
// caller that doesn't set entityType/entityId (e.g. PAYMENT_FAILED
// in booking.controller.js). recipientType mirrors booking's own
// USER-vs-SALON split by requester role.
export async function notifyTicketStatusChanged({ ticket, fromStatus, toStatus }) {
  const recipientType = ticket.requesterType === REQUESTER_TYPE.SALON_OWNER ? "SALON" : "USER";
  await NotificationService.send({
    recipientId: ticket.requesterRef,
    recipientType,
    templateKey: NOTIFICATION_EVENTS.SUPPORT_TICKET_STATUS_CHANGED,
    variables: { ticketNumber: ticket.ticketNumber, status: toStatus },
    title: "Support ticket updated",
    message: `Your support ticket ${ticket.ticketNumber} is now ${toStatus}.`,
    type: "SYSTEM",
    priority: "MEDIUM",
    actionType: null,
    actionUrl: null,
    meta: { ticketId: ticket._id, fromStatus, toStatus },
  });
}

// Phase F.3.8 — first real caller of the already-reserved
// SUPPORT_MESSAGE_RECEIVED key (notificationEvents.constants.js has
// carried it, unused, since Phase 2). Customer-facing only: an agent
// reply is never a self-echo of the customer's own action, unlike
// ticket-created/customer-reply, so this is a genuine notification
// gap being closed, not a new event being invented. Same recipient-
// resolution convention as notifyTicketStatusChanged above.
async function notifyAgentReplyReceived({ ticket }) {
  const recipientType = ticket.requesterType === REQUESTER_TYPE.SALON_OWNER ? "SALON" : "USER";
  await NotificationService.send({
    recipientId: ticket.requesterRef,
    recipientType,
    templateKey: NOTIFICATION_EVENTS.SUPPORT_MESSAGE_RECEIVED,
    variables: { ticketNumber: ticket.ticketNumber },
    title: "New reply on your support ticket",
    message: `You have a new reply on ticket ${ticket.ticketNumber}.`,
    type: "SYSTEM",
    priority: "MEDIUM",
    actionType: null,
    actionUrl: null,
    meta: { ticketId: ticket._id },
  });
}

// ── Phase F.3.8 — Socket.IO room-fanout helpers ─────────────────────
// Reuses the exact same emitToRoom() every existing Support event
// already calls (socket/index.js) — no second socket system. "Staff"
// rooms (an agent's own user:{id} room, supportTeam:{teamId},
// supportAdmin) are the only three room types ever used for
// internal-audience Support events; the customer's own user:{id} room
// is built separately by each caller and is NEVER included by this
// helper, so an internal-only event (assignment identity, internal
// notes) can never accidentally reach a customer socket by sharing a
// room-list builder with a customer-facing one.
//
// Exported as of Phase G Step 8's Socket.IO addition — the SLA
// notification/escalation services need this exact same room-fanout
// logic and must not duplicate it. Adding `export` here is the only
// change to either function: no parameter, return shape, or calling
// behavior changed for any existing caller in this file.
export function staffRooms({ agentRefs = [], teamRef = null } = {}) {
  const rooms = new Set();
  for (const ref of agentRefs) {
    if (ref) rooms.add(`user:${ref}`);
  }
  if (teamRef) rooms.add(`supportTeam:${teamRef}`);
  rooms.add("supportAdmin");
  return [...rooms];
}

export function emitToRooms(io, rooms, event, payload) {
  for (const room of rooms) emitToRoom(io, room, event, payload);
}

// Deterministic reason -> resulting-status mapping for
// routeAndAssignTicket()'s return value. ALREADY_PROGRESSED/
// TICKET_NOT_FOUND intentionally have no entry — both mean "nothing
// new happened this call," so no event/notification should fire.
// routeAndAssignTicket()'s own returned `ticket`/`assignmentResult.
// agentRef`/`routingDecision.targetTeamRef` are read here rather than
// `ticket.currentAssignment` — resolveAssignment() mutates a
// separately-fetched, session-scoped ticket document internally, so
// the top-level `ticket` object routeAndAssignTicket() returns does
// NOT reliably reflect a just-completed assignment's currentAssignment
// fields, even though its static fields (requesterRef, requesterType,
// ticketNumber, _id) are always correct. Deriving status/agent/team
// from the engine's own explicit return values, not from a
// potentially-stale document, avoids that trap entirely.
const ROUTING_REASON_TO_STATUS = {
  ASSIGNED: TICKET_STATUS.ASSIGNED,
  ALREADY_ASSIGNED: TICKET_STATUS.ASSIGNED,
  NO_AGENT_AVAILABLE: TICKET_STATUS.QUEUED,
  NO_TEAM_RESOLVED: TICKET_STATUS.QUEUED,
};

/**
 * Phase F.3.8 — shared emission for any routeAndAssignTicket() call
 * (createTicket's own post-commit trigger, reopenTicket's fresh cycle,
 * and adminSupport.controller.js's explicit /assign action). Never
 * mutates anything — read-only over the already-returned result.
 *
 * `ticket` must be a document/object carrying at least requesterRef/
 * requesterType/ticketNumber/_id — every caller already has one
 * (their own held ticket, or routeAndAssignTicket's own returned
 * ticket, whose static fields are always trustworthy per the note
 * above). `fromStatus` is the caller's own record of the ticket's
 * status immediately before this routing attempt.
 */
export async function emitRoutingOutcome({ io, ticket, fromStatus, result }) {
  const toStatus = ROUTING_REASON_TO_STATUS[result.reason];
  if (!toStatus) return;

  const agentRef = result.assignmentResult?.agentRef || null;
  const teamRef = result.routingDecision?.targetTeamRef || null;

  if (agentRef) {
    // Assignment identity is internal data (F.3.8 §3) — agent/team/
    // admin rooms only, the customer room is deliberately excluded.
    emitToRooms(io, staffRooms({ agentRefs: [agentRef], teamRef }), "support:ticket:assigned", {
      ticketId: ticket._id,
      teamRef,
      queueRef: result.routingDecision?.targetQueueRef || null,
    });
  }

  if (toStatus !== fromStatus) {
    const rooms = [`user:${ticket.requesterRef}`, ...staffRooms({ teamRef })];
    emitToRooms(io, rooms, "support:ticket:statusChanged", {
      ticketId: ticket._id,
      fromStatus,
      toStatus,
    });
    await notifyTicketStatusChanged({ ticket, fromStatus, toStatus });
  }
}

/**
 * Ticket + its one IN_APP Conversation + its first customer Message +
 * its CREATED audit event, all inside one transaction (Phase C §L).
 * Wrapped in a bounded retry loop that only fires on a genuine
 * ticketNumber collision (astronomically rare at 900,000 values/day,
 * but handled correctly rather than assumed away) — any other error
 * aborts and rethrows immediately, no silent retry.
 *
 * Phase F.3.7 — `attachments` on the initial message reuses the exact
 * same shape/limits already validated for reply attachments (no
 * separate upload system, no weakened limits) and is created
 * atomically as part of this same transaction, alongside the message
 * itself — never a second, separate write.
 */
export async function createTicket({ requesterId, role, categoryRef, subject, body, priority, language, relatedSalonRef, relatedBookingRef, attachments, io = null }) {
  const category = await SupportCategory.findOne({ _id: categoryRef, isActive: true, isDeleted: false }).select("_id").lean();
  if (!category) throw Errors.badRequest("Invalid or inactive categoryRef");

  const { resolvedSalonId, resolvedBookingId } = await resolveRelatedReferences({
    relatedBookingRef, relatedSalonRef, requesterId, role,
  });

  const routingSnapshot = await captureRoutingSnapshot(resolvedSalonId);
  const requesterType = role === "OWNER" ? REQUESTER_TYPE.SALON_OWNER : REQUESTER_TYPE.USER;

  // Phase G Step 2 — resolve + snapshot SLA targets once, here,
  // before the retry loop (same treatment as routingSnapshot just
  // above — a pure read that doesn't depend on the eventual
  // ticketId/ticketNumber, so it's computed once and reused across
  // any ticketNumber-collision retry, never recomputed per attempt).
  // Calendar-time only (locked decision — no BusinessHours model, no
  // business-hours math). No pause/resume, no reopen recalculation,
  // no warning/breach detection — later phases.
  const effectivePriority = priority || PRIORITY.NORMAL;
  const effectiveSlaPolicy = await resolveEffectiveSlaPolicy({ categoryRef });
  if (!effectiveSlaPolicy) {
    // Locked behavior: never fabricate SLA values. A missing policy
    // (no category-specific AND no active global default configured
    // yet) is an operational/admin gap, not a caller error — a
    // SUPPORT_ADMIN must create at least a global default policy via
    // the Phase G.1 API before ticket creation can succeed.
    throw Errors.internal("No SLA policy is configured for this category or as a global default. Please contact support administration.");
  }
  const priorityTargets = effectiveSlaPolicy.targetsByPriority?.[effectivePriority];
  if (!priorityTargets) {
    // Defensive only — the G.1 validator already requires all four
    // priorities on every policy, so this should be unreachable in
    // practice; kept as an explicit guard rather than a silent
    // fallback if it ever somehow isn't true.
    throw Errors.internal(`SLA policy is missing targets for priority ${effectivePriority}`);
  }
  const slaCapturedAt = new Date();
  const slaTargets = {
    firstResponseDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.firstResponseMinutes * 60 * 1000),
    resolutionDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.resolutionMinutes * 60 * 1000),
    pausedAt: null,
    totalPausedMs: 0,
  };

  let lastError = null;

  for (let attempt = 0; attempt < MAX_TICKET_NUMBER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const ticketId = new mongoose.Types.ObjectId();
      const conversationId = new mongoose.Types.ObjectId();
      const ticketNumber = generateTicketNumber();

      await SupportConversation.create(
        [{
          _id: conversationId,
          ticketRef: ticketId,
          channel: CHANNEL.IN_APP,
          status: CONVERSATION_STATUS.ACTIVE,
          participantRefs: [{ userRef: requesterId, roleAtTime: role }],
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 300),
        }],
        { session }
      );

      const [ticket] = await SupportTicket.create(
        [{
          _id: ticketId,
          ticketNumber,
          requesterRef: requesterId,
          requesterType,
          relatedSalonRef: resolvedSalonId,
          relatedBookingRef: resolvedBookingId,
          categoryRef,
          priority: effectivePriority,
          language: language || "en",
          subject,
          status: TICKET_STATUS.OPEN,
          routingSnapshot,
          slaPolicyRef: effectiveSlaPolicy._id,
          slaTargets,
          conversationRef: conversationId,
          createdBy: requesterId,
          updatedBy: requesterId,
        }],
        { session }
      );

      const [message] = await SupportMessage.create(
        [{
          conversationRef: conversationId,
          ticketRef: ticketId,
          senderRef: requesterId,
          senderType: SENDER_TYPE.CUSTOMER,
          visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
          body,
          attachments: attachments || [],
          channel: CHANNEL.IN_APP,
        }],
        { session }
      );

      await recordSupportAuditEvent(
        {
          ticketRef: ticketId,
          actorRef: requesterId,
          actorType: ACTOR_TYPE.CUSTOMER,
          action: AUDIT_ACTION.CREATED,
          entityId: ticketId,
          newValue: { status: TICKET_STATUS.OPEN, categoryRef, priority: ticket.priority },
        },
        session
      );

      await session.commitTransaction();
      session.endSession();

      // Socket-only — no notification (self-echo of the requester's
      // own action, deliberately not wired per the approved design).
      emitToRoom(io, `user:${requesterId}`, "support:ticket:created", {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
      });

      // Phase F.3.6 — best-effort, post-commit, non-blocking, same
      // philosophy as the emitToRoom/NotificationService calls right
      // above: the ticket was already successfully created and
      // committed; a routing/assignment failure must never make ticket
      // creation itself appear to fail to the customer. Logged, not
      // rethrown — mirrors NotificationService.send()'s own internal
      // non-critical error swallowing.
      try {
        const result = await routeAndAssignTicket({ ticketId: ticket._id });
        await emitRoutingOutcome({ io, ticket, fromStatus: TICKET_STATUS.OPEN, result });
      } catch (routingErr) {
        console.warn("[createTicket] routeAndAssignTicket failed (non-critical):", routingErr.message);
      }

      // Phase H — Bot Support. Additive, non-blocking, try/catch-
      // protected — same convention as every other channel's own
      // ticket-creation hook (createTicketFromEmail/WhatsApp/Call all
      // trigger the bot on their first message too, for parity).
      // Deliberately does NOT change this function's return shape
      // (still plain `ticket`, not `{ticket, message}`) — every
      // existing caller of createTicket() must see zero change.
      try {
        await processCustomerMessageForBot({ message, ticket, io });
      } catch (err) {
        console.warn("[createTicket] bot processing failed (non-critical):", err.message);
      }

      return ticket;
    } catch (err) {
      try {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
      } catch {}

      const isDuplicateTicketNumber = err.code === 11000 && err.keyPattern?.ticketNumber;
      if (isDuplicateTicketNumber && attempt < MAX_TICKET_NUMBER_ATTEMPTS - 1) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || Errors.internal("Could not create ticket");
}

/**
 * Phase H Step 9 — Email Support. A deliberate SIBLING of createTicket()
 * above, not a generalization of it — the amount of genuinely divergent
 * logic (no authenticated role, no resolveRelatedReferences() call, no
 * caller-supplied categoryRef, EMAIL-channel conversation) made a
 * parallel function the cleaner, lower-risk choice here, per the
 * approved Phase 1 design. createTicket() itself is completely
 * unmodified by this addition.
 *
 * Reuses, verbatim: the same transaction shape, the same ticketNumber-
 * collision retry loop, the same SLA-resolution-before-the-loop
 * pattern, the same recordSupportAuditEvent(CREATED) call, and the
 * same post-commit routeAndAssignTicket() call — every one of those
 * primitives is imported/called exactly as createTicket() already
 * does, never reimplemented.
 *
 * categoryRef has no picker in an email — resolved from
 * SUPPORT_EMAIL_DEFAULT_CATEGORY_CODE (.env), matching an existing
 * SupportCategory.code exactly. Never fabricated: an unset/unresolvable
 * default throws loudly (same "never fabricate SLA values" philosophy
 * createTicket() already applies to its own SLA-policy resolution).
 *
 * requesterId must already be a matched, real User — this function
 * never creates one (see emailInbound.service.js, the only caller).
 * requesterRole must be exactly "USER" or "OWNER" — the same
 * constraint createMyTicket's own requireRole("USER","OWNER") already
 * enforces for the in-app path; the caller is responsible for having
 * already checked this.
 */
export async function createTicketFromEmail({ requesterId, requesterRole, subject, body, attachments = [], io = null }) {
  const categoryCode = process.env.SUPPORT_EMAIL_DEFAULT_CATEGORY_CODE;
  if (!categoryCode) {
    throw Errors.internal("SUPPORT_EMAIL_DEFAULT_CATEGORY_CODE is not configured. Please contact support administration.");
  }
  const category = await SupportCategory.findOne({ code: categoryCode, isActive: true, isDeleted: false }).select("_id").lean();
  if (!category) {
    throw Errors.internal(`SUPPORT_EMAIL_DEFAULT_CATEGORY_CODE ("${categoryCode}") does not match any active category.`);
  }
  const categoryRef = category._id;

  // No salon/booking linkage is derivable from a raw email — matches
  // the existing "no booking, no salon" branch resolveRelatedReferences()
  // already returns for a USER with neither field supplied.
  const routingSnapshot = await captureRoutingSnapshot(null);
  const requesterType = requesterRole === "OWNER" ? REQUESTER_TYPE.SALON_OWNER : REQUESTER_TYPE.USER;

  const effectivePriority = PRIORITY.NORMAL;
  const effectiveSlaPolicy = await resolveEffectiveSlaPolicy({ categoryRef });
  if (!effectiveSlaPolicy) {
    throw Errors.internal("No SLA policy is configured for this category or as a global default. Please contact support administration.");
  }
  const priorityTargets = effectiveSlaPolicy.targetsByPriority?.[effectivePriority];
  if (!priorityTargets) {
    throw Errors.internal(`SLA policy is missing targets for priority ${effectivePriority}`);
  }
  const slaCapturedAt = new Date();
  const slaTargets = {
    firstResponseDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.firstResponseMinutes * 60 * 1000),
    resolutionDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.resolutionMinutes * 60 * 1000),
    pausedAt: null,
    totalPausedMs: 0,
  };

  let lastError = null;

  for (let attempt = 0; attempt < MAX_TICKET_NUMBER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const ticketId = new mongoose.Types.ObjectId();
      const conversationId = new mongoose.Types.ObjectId();
      const ticketNumber = generateTicketNumber();

      await SupportConversation.create(
        [{
          _id: conversationId,
          ticketRef: ticketId,
          channel: CHANNEL.EMAIL,
          status: CONVERSATION_STATUS.ACTIVE,
          participantRefs: [{ userRef: requesterId, roleAtTime: requesterRole }],
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 300),
        }],
        { session }
      );

      const [ticket] = await SupportTicket.create(
        [{
          _id: ticketId,
          ticketNumber,
          requesterRef: requesterId,
          requesterType,
          relatedSalonRef: null,
          relatedBookingRef: null,
          categoryRef,
          priority: effectivePriority,
          language: "en",
          subject,
          status: TICKET_STATUS.OPEN,
          routingSnapshot,
          slaPolicyRef: effectiveSlaPolicy._id,
          slaTargets,
          conversationRef: conversationId,
          createdBy: requesterId,
          updatedBy: requesterId,
        }],
        { session }
      );

      const [message] = await SupportMessage.create(
        [{
          conversationRef: conversationId,
          ticketRef: ticketId,
          senderRef: requesterId,
          senderType: SENDER_TYPE.CUSTOMER,
          visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
          body,
          attachments,
          channel: CHANNEL.EMAIL,
        }],
        { session }
      );

      await recordSupportAuditEvent(
        {
          ticketRef: ticketId,
          actorRef: requesterId,
          actorType: ACTOR_TYPE.CUSTOMER,
          action: AUDIT_ACTION.CREATED,
          entityId: ticketId,
          newValue: { status: TICKET_STATUS.OPEN, categoryRef, priority: ticket.priority, channel: CHANNEL.EMAIL },
        },
        session
      );

      await session.commitTransaction();
      session.endSession();

      // Best-effort, post-commit, non-blocking — identical philosophy
      // to createTicket()'s own routing call immediately below.
      try {
        const result = await routeAndAssignTicket({ ticketId: ticket._id });
        await emitRoutingOutcome({ io, ticket, fromStatus: TICKET_STATUS.OPEN, result });
      } catch (routingErr) {
        console.warn("[createTicketFromEmail] routeAndAssignTicket failed (non-critical):", routingErr.message);
      }

      return { ticket, conversation: { _id: conversationId }, message };
    } catch (err) {
      try {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
      } catch {}

      const isDuplicateTicketNumber = err.code === 11000 && err.keyPattern?.ticketNumber;
      if (isDuplicateTicketNumber && attempt < MAX_TICKET_NUMBER_ATTEMPTS - 1) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || Errors.internal("Could not create ticket from email");
}

/**
 * Phase H — WhatsApp Support. Sibling of createTicketFromEmail() —
 * same transaction/SLA/routing shape, deliberately not a rewrite of
 * createTicket() or a generalization of createTicketFromEmail(), per
 * the approved design's "no premature generalization" precedent
 * (SupportInboundEmailEvent.js's own header comment states this
 * explicitly for a future channel). The only real differences from
 * createTicketFromEmail() are: no email-specific fields, a WhatsApp-
 * specific default-category env var, and channel=WHATSAPP.
 */
export async function createTicketFromWhatsApp({ requesterId, requesterRole, subject, body, io = null }) {
  const categoryCode = process.env.SUPPORT_WHATSAPP_DEFAULT_CATEGORY_CODE;
  if (!categoryCode) {
    throw Errors.internal("SUPPORT_WHATSAPP_DEFAULT_CATEGORY_CODE is not configured. Please contact support administration.");
  }
  const category = await SupportCategory.findOne({ code: categoryCode, isActive: true, isDeleted: false }).select("_id").lean();
  if (!category) {
    throw Errors.internal(`SUPPORT_WHATSAPP_DEFAULT_CATEGORY_CODE ("${categoryCode}") does not match any active category.`);
  }
  const categoryRef = category._id;

  // No salon/booking linkage is derivable from a raw WhatsApp message —
  // matches the existing "no booking, no salon" branch
  // resolveRelatedReferences() already returns for a USER with neither
  // field supplied (same reasoning createTicketFromEmail() uses).
  const routingSnapshot = await captureRoutingSnapshot(null);
  const requesterType = requesterRole === "OWNER" ? REQUESTER_TYPE.SALON_OWNER : REQUESTER_TYPE.USER;

  const effectivePriority = PRIORITY.NORMAL;
  const effectiveSlaPolicy = await resolveEffectiveSlaPolicy({ categoryRef });
  if (!effectiveSlaPolicy) {
    throw Errors.internal("No SLA policy is configured for this category or as a global default. Please contact support administration.");
  }
  const priorityTargets = effectiveSlaPolicy.targetsByPriority?.[effectivePriority];
  if (!priorityTargets) {
    throw Errors.internal(`SLA policy is missing targets for priority ${effectivePriority}`);
  }
  const slaCapturedAt = new Date();
  const slaTargets = {
    firstResponseDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.firstResponseMinutes * 60 * 1000),
    resolutionDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.resolutionMinutes * 60 * 1000),
    pausedAt: null,
    totalPausedMs: 0,
  };

  let lastError = null;

  for (let attempt = 0; attempt < MAX_TICKET_NUMBER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const ticketId = new mongoose.Types.ObjectId();
      const conversationId = new mongoose.Types.ObjectId();
      const ticketNumber = generateTicketNumber();

      await SupportConversation.create(
        [{
          _id: conversationId,
          ticketRef: ticketId,
          channel: CHANNEL.WHATSAPP,
          status: CONVERSATION_STATUS.ACTIVE,
          participantRefs: [{ userRef: requesterId, roleAtTime: requesterRole }],
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 300),
        }],
        { session }
      );

      const [ticket] = await SupportTicket.create(
        [{
          _id: ticketId,
          ticketNumber,
          requesterRef: requesterId,
          requesterType,
          relatedSalonRef: null,
          relatedBookingRef: null,
          categoryRef,
          priority: effectivePriority,
          language: "en",
          subject,
          status: TICKET_STATUS.OPEN,
          routingSnapshot,
          slaPolicyRef: effectiveSlaPolicy._id,
          slaTargets,
          conversationRef: conversationId,
          createdBy: requesterId,
          updatedBy: requesterId,
        }],
        { session }
      );

      const [message] = await SupportMessage.create(
        [{
          conversationRef: conversationId,
          ticketRef: ticketId,
          senderRef: requesterId,
          senderType: SENDER_TYPE.CUSTOMER,
          visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
          body,
          attachments: [],
          channel: CHANNEL.WHATSAPP,
        }],
        { session }
      );

      await recordSupportAuditEvent(
        {
          ticketRef: ticketId,
          actorRef: requesterId,
          actorType: ACTOR_TYPE.CUSTOMER,
          action: AUDIT_ACTION.CREATED,
          entityId: ticketId,
          newValue: { status: TICKET_STATUS.OPEN, categoryRef, priority: ticket.priority, channel: CHANNEL.WHATSAPP },
        },
        session
      );

      await session.commitTransaction();
      session.endSession();

      // Best-effort, post-commit, non-blocking — identical philosophy
      // to createTicket()'s/createTicketFromEmail()'s own routing call.
      try {
        const result = await routeAndAssignTicket({ ticketId: ticket._id });
        await emitRoutingOutcome({ io, ticket, fromStatus: TICKET_STATUS.OPEN, result });
      } catch (routingErr) {
        console.warn("[createTicketFromWhatsApp] routeAndAssignTicket failed (non-critical):", routingErr.message);
      }

      return { ticket, conversation: { _id: conversationId }, message };
    } catch (err) {
      try {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
      } catch {}

      const isDuplicateTicketNumber = err.code === 11000 && err.keyPattern?.ticketNumber;
      if (isDuplicateTicketNumber && attempt < MAX_TICKET_NUMBER_ATTEMPTS - 1) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || Errors.internal("Could not create ticket from WhatsApp message");
}

/**
 * Phase H — Call Support. Sibling of createTicketFromEmail()/
 * createTicketFromWhatsApp() — same transaction/SLA/routing shape,
 * deliberately not a rewrite of createTicket() or a generalization of
 * either sibling, per the approved design's "no premature
 * generalization" precedent. Called only from callInbound.service.js
 * when an inbound call's caller has no existing open ticket (channel-
 * agnostic match — see that file's header) — every call that DOES
 * match an existing ticket attaches via a SupportCall row instead,
 * never through this function.
 */
export async function createTicketFromCall({ requesterId, requesterRole, subject, body, io = null }) {
  const categoryCode = process.env.SUPPORT_CALL_DEFAULT_CATEGORY_CODE;
  if (!categoryCode) {
    throw Errors.internal("SUPPORT_CALL_DEFAULT_CATEGORY_CODE is not configured. Please contact support administration.");
  }
  const category = await SupportCategory.findOne({ code: categoryCode, isActive: true, isDeleted: false }).select("_id").lean();
  if (!category) {
    throw Errors.internal(`SUPPORT_CALL_DEFAULT_CATEGORY_CODE ("${categoryCode}") does not match any active category.`);
  }
  const categoryRef = category._id;

  // No salon/booking linkage is derivable from a raw inbound call —
  // matches the existing "no booking, no salon" branch
  // resolveRelatedReferences() already returns for a USER with neither
  // field supplied (same reasoning createTicketFromEmail()/
  // createTicketFromWhatsApp() use).
  const routingSnapshot = await captureRoutingSnapshot(null);
  const requesterType = requesterRole === "OWNER" ? REQUESTER_TYPE.SALON_OWNER : REQUESTER_TYPE.USER;

  const effectivePriority = PRIORITY.NORMAL;
  const effectiveSlaPolicy = await resolveEffectiveSlaPolicy({ categoryRef });
  if (!effectiveSlaPolicy) {
    throw Errors.internal("No SLA policy is configured for this category or as a global default. Please contact support administration.");
  }
  const priorityTargets = effectiveSlaPolicy.targetsByPriority?.[effectivePriority];
  if (!priorityTargets) {
    throw Errors.internal(`SLA policy is missing targets for priority ${effectivePriority}`);
  }
  const slaCapturedAt = new Date();
  const slaTargets = {
    firstResponseDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.firstResponseMinutes * 60 * 1000),
    resolutionDueAt: new Date(slaCapturedAt.getTime() + priorityTargets.resolutionMinutes * 60 * 1000),
    pausedAt: null,
    totalPausedMs: 0,
  };

  let lastError = null;

  for (let attempt = 0; attempt < MAX_TICKET_NUMBER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const ticketId = new mongoose.Types.ObjectId();
      const conversationId = new mongoose.Types.ObjectId();
      const ticketNumber = generateTicketNumber();

      await SupportConversation.create(
        [{
          _id: conversationId,
          ticketRef: ticketId,
          channel: CHANNEL.PHONE,
          status: CONVERSATION_STATUS.ACTIVE,
          participantRefs: [{ userRef: requesterId, roleAtTime: requesterRole }],
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 300),
        }],
        { session }
      );

      const [ticket] = await SupportTicket.create(
        [{
          _id: ticketId,
          ticketNumber,
          requesterRef: requesterId,
          requesterType,
          relatedSalonRef: null,
          relatedBookingRef: null,
          categoryRef,
          priority: effectivePriority,
          language: "en",
          subject,
          status: TICKET_STATUS.OPEN,
          routingSnapshot,
          slaPolicyRef: effectiveSlaPolicy._id,
          slaTargets,
          conversationRef: conversationId,
          createdBy: requesterId,
          updatedBy: requesterId,
        }],
        { session }
      );

      const [message] = await SupportMessage.create(
        [{
          conversationRef: conversationId,
          ticketRef: ticketId,
          senderRef: requesterId,
          senderType: SENDER_TYPE.CUSTOMER,
          visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
          body,
          attachments: [],
          channel: CHANNEL.PHONE,
        }],
        { session }
      );

      await recordSupportAuditEvent(
        {
          ticketRef: ticketId,
          actorRef: requesterId,
          actorType: ACTOR_TYPE.CUSTOMER,
          action: AUDIT_ACTION.CREATED,
          entityId: ticketId,
          newValue: { status: TICKET_STATUS.OPEN, categoryRef, priority: ticket.priority, channel: CHANNEL.PHONE },
        },
        session
      );

      await session.commitTransaction();
      session.endSession();

      // Best-effort, post-commit, non-blocking — identical philosophy
      // to createTicket()'s/createTicketFromEmail()'s/
      // createTicketFromWhatsApp()'s own routing call.
      try {
        const result = await routeAndAssignTicket({ ticketId: ticket._id });
        await emitRoutingOutcome({ io, ticket, fromStatus: TICKET_STATUS.OPEN, result });
      } catch (routingErr) {
        console.warn("[createTicketFromCall] routeAndAssignTicket failed (non-critical):", routingErr.message);
      }

      return { ticket, conversation: { _id: conversationId }, message };
    } catch (err) {
      try {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
      } catch {}

      const isDuplicateTicketNumber = err.code === 11000 && err.keyPattern?.ticketNumber;
      if (isDuplicateTicketNumber && attempt < MAX_TICKET_NUMBER_ATTEMPTS - 1) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || Errors.internal("Could not create ticket from call");
}

/**
 * Phase S.1 — customer-facing, read-only category list for the Create
 * Ticket UI's category picker. Reuses the exact same
 * {isActive:true, isDeleted:false} filter createTicket() already
 * applies when validating a submitted categoryRef (above) — this is
 * simply the list-view of that same existing rule, not a new access
 * policy. No pagination: SupportCategory is an admin-curated,
 * small reference list (Phase C's own design comment on the model
 * calls it "admin-configurable", not a growing per-user collection
 * like tickets), so a full sorted list is returned in one call.
 */
export async function listActiveCategories() {
  return SupportCategory.find({ isActive: true, isDeleted: false })
    .select("_id name code description parentCategoryRef")
    .sort({ name: 1 })
    .lean();
}

export async function listMyTickets({ requesterId, query }) {
  const pagination = buildPagination(query);
  const filter = { requesterRef: requesterId, isDeleted: false };
  Object.assign(filter, buildStatusFilter(query, "status", Object.values(TICKET_STATUS)));

  return paginatedQuery(SupportTicket, filter, pagination, { sort: { createdAt: -1 } });
}

export async function getMyTicketDetail({ requesterId, ticketId, query = {} }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (ticket.requesterRef.toString() !== requesterId.toString()) {
    throw Errors.forbidden("This ticket does not belong to you");
  }

  // Customer-facing — CUSTOMER_VISIBLE only, enforced at the query
  // layer via the {ticketRef,visibility,createdAt} index, never
  // relying on the frontend to filter INTERNAL/SYSTEM messages out.
  // Paginated (Phase D) via the same buildPagination/paginatedQuery
  // helpers listMyTickets already uses — the filter+sort below is an
  // exact match for the existing index, no new index required.
  const pagination = buildPagination(query);
  const { docs: messages, meta: messagesPagination } = await paginatedQuery(
    SupportMessage,
    { ticketRef: ticket._id, visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE, isDeleted: false },
    pagination,
    { sort: { createdAt: 1 } }
  );

  return { ticket, messages, messagesPagination };
}

export async function addCustomerMessage({ requesterId, ticketId, body, attachments, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (ticket.requesterRef.toString() !== requesterId.toString()) {
    throw Errors.forbidden("This ticket does not belong to you");
  }
  if (!ticket.conversationRef) throw Errors.internal("Ticket has no conversation");

  const message = await SupportMessage.create({
    conversationRef: ticket.conversationRef,
    ticketRef: ticket._id,
    senderRef: requesterId,
    senderType: SENDER_TYPE.CUSTOMER,
    visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
    body,
    attachments: attachments || [],
    channel: CHANNEL.IN_APP,
  });

  await SupportConversation.updateOne(
    { _id: ticket.conversationRef },
    { $set: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 300) } }
  );

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: requesterId,
    actorType: ACTOR_TYPE.CUSTOMER,
    action: AUDIT_ACTION.CUSTOMER_REPLY,
    entityId: ticket._id,
  });

  // Socket-only — no notification (self-echo of the requester's own
  // action, deliberately not wired per the approved design).
  emitToRoom(io, `user:${requesterId}`, "support:message:new", {
    ticketId: ticket._id,
    messageId: message._id,
    senderType: SENDER_TYPE.CUSTOMER,
  });

  // A customer reply while the ticket was waiting on them moves it
  // back into IN_PROGRESS — the one lifecycle transition Phase C's
  // customer-facing flow legitimately triggers on its own.
  if (ticket.status === TICKET_STATUS.WAITING_FOR_USER) {
    // Phase G Step 4 — SLA resume. A separate, standalone atomic
    // update (NOT bundled into transitionTicketStatus()'s extraFields,
    // unlike the pause side in waitForUserAgentOwnTicket() above) —
    // this one genuinely needs race protection: two near-simultaneous
    // customer messages could both read this same `ticket` with
    // slaTargets.pausedAt still set before either write commits. The
    // filter's "slaTargets.pausedAt": pausedAtAtRead only matches if
    // the stored value is STILL exactly what was just read — a
    // concurrent duplicate finds it already cleared and matches zero
    // documents, a clean no-op, never double-counting the same pause
    // window. $inc (not a computed $set) accumulates totalPausedMs,
    // so the increment itself is atomic even under real concurrency,
    // not dependent on this process's possibly-stale read. Dot-path
    // targeting touches only these two leaf fields — firstResponseDueAt/
    // resolutionDueAt (G.2) are never part of this write at all, unlike
    // a whole-slaTargets-object replace.
    const pausedAtAtRead = ticket.slaTargets?.pausedAt || null;
    if (pausedAtAtRead) {
      const resumedAt = new Date();
      const pauseDurationMs = resumedAt.getTime() - pausedAtAtRead.getTime();
      await SupportTicket.updateOne(
        { _id: ticket._id, "slaTargets.pausedAt": pausedAtAtRead },
        {
          $set: { "slaTargets.pausedAt": null },
          $inc: { "slaTargets.totalPausedMs": pauseDurationMs },
        }
      );
    }

    // Safe against the transitionTicketStatus() call immediately
    // below: Mongoose's Document#save() persists only paths actually
    // mutated on this in-memory `ticket` object (a diff-based update,
    // not a blind full-document overwrite) — nothing here ever
    // assigns to `ticket.slaTargets`, so save() cannot re-include or
    // clobber the field the atomic updateOne() above just changed
    // directly at the collection level.
    const fromStatus = ticket.status;
    await transitionTicketStatus({
      ticket,
      toStatus: TICKET_STATUS.IN_PROGRESS,
      actorRef: requesterId,
      actorType: ACTOR_TYPE.CUSTOMER,
      reason: "Customer replied",
    });

    emitToRoom(io, `user:${requesterId}`, "support:ticket:statusChanged", {
      ticketId: ticket._id,
      fromStatus,
      toStatus: TICKET_STATUS.IN_PROGRESS,
    });

    await notifyTicketStatusChanged({ ticket, fromStatus, toStatus: TICKET_STATUS.IN_PROGRESS });
  }

  // Phase H — Bot Support. Additive, non-blocking, try/catch-protected
  // — the customer's own message and every step above have already
  // completed successfully; a bot failure must never fail this
  // request or corrupt what's already been persisted, exactly matching
  // the existing non-blocking philosophy already proven for the
  // EMAIL/WHATSAPP outbound-dispatch calls in addAgentReply().
  try {
    await processCustomerMessageForBot({ message, ticket, io });
  } catch (err) {
    console.warn("[addCustomerMessage] bot processing failed (non-critical):", err.message);
  }

  return message;
}

// Phase G Step 10 — SLA reopen recalculation. The originally-approved
// SLA implementation plan always listed this as its own step, between
// pause/resume (G.4) and the SLA evaluator (G.5) — deliberately
// deferred until now, and explicitly flagged as deferred by G.2's own
// comment ("no reopen recalculation ... later phases") and G.5's own
// audit ("a reopened ticket's slaTargets remains untouched ... likely
// wrong long-term but not this step's problem").
//
// WHY RECALCULATION IS NEEDED (confirmed by direct inspection, not
// assumed): VALID_TRANSITIONS only allows CLOSED -> REOPENED. Neither
// resolveTicketAssignment() (RESOLVED) nor closeTicket() (CLOSED)
// ever touches slaTargets — so a reopened ticket still carries
// whatever slaTargets it had at the moment it was first resolved,
// including a possibly-stale non-null `pausedAt` (WAITING_FOR_USER ->
// RESOLVED is a valid direct transition, confirmed in
// VALID_TRANSITIONS, and neither resolve nor close ever clears
// pausedAt). Left alone, a reopened ticket would either (a) look
// immediately breached against its original, long-past deadline, or
// (b) if still carrying a stale pausedAt, have G.5 treat it as
// "still currently paused" indefinitely once it's live again — both
// wrong.
//
// DESIGN: treated as restarting the SLA clock, not continuing the
// original one — reuses the EXACT SAME policy-resolution and due-date
// formula createTicket() (Phase G Step 2) already established
// (resolveEffectiveSlaPolicy() + calendar-minute arithmetic), just
// anchored at the reopen instant instead of ticket creation. All four
// Phase G Step 6 event-state flags are reset to null so the scanner
// evaluates this ticket fresh (the scanner's own eligibility query is
// unmodified and unmodified-necessary: a REOPENED, non-RESOLVED/
// CLOSED status combined with null flags already matches its existing
// $or branches, confirmed by reading jobs/slaScanner.job.js — no
// scanner change required). slaPolicyRef is also re-resolved (not
// just re-dated) — reopening is a fresh clock-start, so using
// whichever policy is CURRENTLY effective for this category is
// correct, the same way createTicket() always resolves the current
// policy rather than reusing a caller-supplied stale reference.
//
// firstRespondedAt is deliberately NEVER touched here — "once set,
// permanent" has been the established semantic since Phase G Step 3
// (SATISFIED never reverts), and nothing about a reopen changes
// whether an agent ever responded to this ticket historically.
//
// Never fabricates: if no active category-specific or global-default
// policy can be resolved, this throws — matching createTicket()'s own
// "never fabricate SLA values" precedent exactly rather than
// inventing a softer fallback that would leave the ticket in an
// undefined SLA state.
async function recalculateSlaOnReopen(ticket) {
  const effectiveSlaPolicy = await resolveEffectiveSlaPolicy({ categoryRef: ticket.categoryRef });
  if (!effectiveSlaPolicy) {
    throw Errors.internal("No SLA policy is configured for this category or as a global default. Please contact support administration.");
  }
  const priorityTargets = effectiveSlaPolicy.targetsByPriority?.[ticket.priority];
  if (!priorityTargets) {
    throw Errors.internal(`SLA policy is missing targets for priority ${ticket.priority}`);
  }
  const recalculatedAt = new Date();
  return {
    slaPolicyRef: effectiveSlaPolicy._id,
    slaTargets: {
      firstResponseDueAt: new Date(recalculatedAt.getTime() + priorityTargets.firstResponseMinutes * 60 * 1000),
      resolutionDueAt: new Date(recalculatedAt.getTime() + priorityTargets.resolutionMinutes * 60 * 1000),
      pausedAt: null,
      totalPausedMs: 0,
      firstResponseWarningAt: null,
      firstResponseBreachedAt: null,
      resolutionWarningAt: null,
      resolutionBreachedAt: null,
    },
  };
}

export async function reopenTicket({ requesterId, ticketId, reason, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (ticket.requesterRef.toString() !== requesterId.toString()) {
    throw Errors.forbidden("This ticket does not belong to you");
  }

  // No time-window restriction is enforced — an exact reopen-window
  // policy was left as an explicit open decision in Phase B (§25 item
  // 6), not invented here.
  const fromStatus = ticket.status;
  const slaRecalc = await recalculateSlaOnReopen(ticket);
  await transitionTicketStatus({
    ticket,
    toStatus: TICKET_STATUS.REOPENED,
    actorRef: requesterId,
    actorType: ACTOR_TYPE.CUSTOMER,
    reason: reason || null,
    extraFields: { reopenedAt: new Date(), reopenCount: (ticket.reopenCount || 0) + 1, ...slaRecalc },
    auditAction: AUDIT_ACTION.REOPENED,
  });

  emitToRoom(io, `user:${requesterId}`, "support:ticket:statusChanged", {
    ticketId: ticket._id,
    fromStatus,
    toStatus: TICKET_STATUS.REOPENED,
  });

  await notifyTicketStatusChanged({ ticket, fromStatus, toStatus: TICKET_STATUS.REOPENED });

  // Phase F.3.7 — bring the reopened ticket back into QUEUED and run a
  // FRESH routing/assignment decision via routeAndAssignTicket(), the
  // same unmodified engine createTicket() already uses. The previous
  // SupportAssignment stays exactly as F.3.5.1 left it — COMPLETED,
  // historical, never reused, never auto-restored. currentAssignment.
  // agentRef is explicitly cleared first so no stale reference can
  // leak into the fresh cycle even in the edge case where
  // resolveTicketAssignment never ran for this ticket. Best-effort,
  // post-commit, non-blocking — mirrors createTicket()'s own identical
  // philosophy: the reopen itself already succeeded and must not
  // appear to fail to the customer because of a downstream routing
  // problem.
  try {
    ticket.currentAssignment.agentRef = null;
    await transitionTicketStatus({
      ticket,
      toStatus: TICKET_STATUS.QUEUED,
      actorRef: requesterId,
      actorType: ACTOR_TYPE.CUSTOMER,
    });
    const result = await routeAndAssignTicket({ ticketId: ticket._id });
    await emitRoutingOutcome({ io, ticket, fromStatus: TICKET_STATUS.QUEUED, result });
  } catch (routingErr) {
    console.warn("[reopenTicket] fresh routing/assignment cycle failed (non-critical):", routingErr.message);
  }

  return ticket;
}

/**
 * Phase F.3.7 — agent-authored, CUSTOMER_VISIBLE reply. Deliberately
 * NOT routed through addCustomerMessage() above (that function's own
 * ownership check — ticket.requesterRef === caller — would always
 * reject an agent) and deliberately NOT refactored into a shared
 * generic helper either: every message-creating function in this
 * module (createTicket's own inline message, addCustomerMessage) is
 * already self-contained rather than routed through a shared
 * abstraction — this follows that same existing pattern rather than
 * introducing a new one. Still the exact same SupportMessage/
 * SupportConversation models and recordSupportAuditEvent() call —
 * not a second messaging system.
 *
 * Ownership is derived from the ticket's own currentAssignment.
 * agentRef, never a client-supplied value — an agent can only reply
 * to a ticket currently assigned to them.
 *
 * Reuses AUDIT_ACTION.CUSTOMER_REPLY — that action names the
 * message's audience (a customer-visible reply was added), not who
 * sent it; actorType (AGENT here) is what already carries the "who".
 * No dedicated "AGENT_REPLY" constant exists, and none was
 * established as required — reusing the existing, correctly-scoped
 * action is the minimal, non-inventive choice.
 */
export async function addAgentReply({ agentUserId, ticketId, body, attachments, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (!ticket.currentAssignment?.agentRef || ticket.currentAssignment.agentRef.toString() !== agentUserId.toString()) {
    throw Errors.forbidden("This ticket is not currently assigned to you");
  }
  if (!ticket.conversationRef) throw Errors.internal("Ticket has no conversation");

  // Phase H Step 9 — channel-aware. Reads the TICKET'S OWN conversation
  // channel instead of hardcoding IN_APP — confirmed safe by direct
  // inspection: addAgentReply() has exactly one caller in the entire
  // codebase (agentSupport.controller.js's addMyTicketReplyHandler),
  // and every ticket that exists today has an IN_APP-channel
  // conversation, so this is provably behavior-identical for every
  // current caller — only a ticket created via the new
  // createTicketFromEmail() (EMAIL-channel conversation) ever sees a
  // different value here.
  const conversation = await SupportConversation.findById(ticket.conversationRef).select("channel").lean();
  const messageChannel = conversation?.channel || CHANNEL.IN_APP;

  const message = await SupportMessage.create({
    conversationRef: ticket.conversationRef,
    ticketRef: ticket._id,
    senderRef: agentUserId,
    senderType: SENDER_TYPE.AGENT,
    visibility: MESSAGE_VISIBILITY.CUSTOMER_VISIBLE,
    body,
    attachments: attachments || [],
    channel: messageChannel,
  });

  // Phase G Step 3 — first-response tracking. Runs only after the
  // reply itself has genuinely been saved (never mark "first response"
  // for a reply that failed to persist). A standalone atomic
  // findOneAndUpdate — not a mutate-then-save on the `ticket` document
  // already held above — with { firstRespondedAt: null } as the match
  // condition, exactly the same race-guard idiom already proven in
  // this codebase (jobs/serviceOverdue.job.js's atomic conditional
  // flag-set): if two concurrent first replies both reach this line,
  // only the first request's update actually matches a document (the
  // second finds firstRespondedAt already non-null and updates zero
  // documents) — the stored timestamp is therefore always genuinely
  // the FIRST successful agent reply, never overwritten by a second
  // or third one. No new transaction/session/locking introduced —
  // addAgentReply() has never used one, matching every other write in
  // this function being its own independent statement.
  await SupportTicket.updateOne(
    { _id: ticket._id, firstRespondedAt: null },
    { $set: { firstRespondedAt: new Date() } }
  );

  await SupportConversation.updateOne(
    { _id: ticket.conversationRef },
    { $set: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 300) } }
  );

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: agentUserId,
    actorType: ACTOR_TYPE.AGENT,
    action: AUDIT_ACTION.CUSTOMER_REPLY,
    entityId: ticket._id,
  });

  emitToRoom(io, `user:${ticket.requesterRef}`, "support:message:new", {
    ticketId: ticket._id,
    messageId: message._id,
    senderType: SENDER_TYPE.AGENT,
  });

  // Phase F.3.8 — genuine notification gap (not a self-echo): the
  // customer, not the agent who just acted, is the recipient.
  await notifyAgentReplyReceived({ ticket });

  // Phase H Step 9 — Email Support. Only for an EMAIL-channel
  // conversation (never for IN_APP — this is the one guard that
  // prevents "accidentally sending IN_APP messages as emails"). Runs
  // AFTER every existing step above has already completed
  // successfully — an email delivery failure must never roll back or
  // block the ticket/message update that already happened, matching
  // NotificationService.send()'s own established non-blocking,
  // never-throw-to-the-caller convention in this codebase.
  if (messageChannel === CHANNEL.EMAIL) {
    try {
      const requester = await User.findOne({ _id: ticket.requesterRef, isDeleted: { $ne: true } })
        .select("name email")
        .lean();
      const { deliveryLogId } = await sendAgentReplyEmail({ ticket, message, requester });
      await SupportMessage.updateOne({ _id: message._id }, { $set: { deliveryLogRef: deliveryLogId } });
    } catch (err) {
      // Never rethrown — the SupportMessage this function already
      // created and returned to the caller remains the source of
      // truth; a delivery-side failure is recorded inside
      // sendAgentReplyEmail's own NotificationDeliveryLog write (or,
      // in the rare case this catch is what fires, simply logged here
      // and left undelivered/untracked rather than corrupting the
      // reply the agent already successfully sent in-app).
      console.warn("[addAgentReply] email dispatch failed (non-critical):", err.message);
    }
  }

  // Phase H — WhatsApp Support. Same guard/ordering/non-blocking
  // reasoning as the EMAIL branch immediately above — only for a
  // WHATSAPP-channel conversation, runs after every existing step has
  // already completed, never rethrown.
  if (messageChannel === CHANNEL.WHATSAPP) {
    try {
      const requester = await User.findOne({ _id: ticket.requesterRef, isDeleted: { $ne: true } })
        .select("phone")
        .lean();
      const { deliveryLogId } = await sendAgentReplyWhatsApp({ ticket, message, requester });
      await SupportMessage.updateOne({ _id: message._id }, { $set: { deliveryLogRef: deliveryLogId } });
    } catch (err) {
      // Never rethrown — see the EMAIL branch's identical comment above.
      console.warn("[addAgentReply] whatsapp dispatch failed (non-critical):", err.message);
    }
  }

  return message;
}

/**
 * Phase F.3.7 — INTERNAL note. Reuses the existing, already-reserved
 * AUDIT_ACTION.INTERNAL_NOTE (Phase C) — no new audit constant was
 * required or added. Never customer-visible: MESSAGE_VISIBILITY.
 * INTERNAL is filtered out of every customer-facing query by the
 * existing {ticketRef,visibility,createdAt} index, exactly as it
 * already is for getMyTicketDetail(); this function never touches
 * SupportConversation.lastMessagePreview (that field is surfaced to
 * the customer-facing ticket list/detail, so an internal note must
 * never update it).
 *
 * Authorization/scope (team-lead vs. SUPPORT_ADMIN) is resolved by
 * the caller and passed in as `scopeTeamIds` — null for global
 * (SUPPORT_ADMIN) access, an array of team ids for team-lead
 * scoping — this function only enforces that the ticket's current
 * team is within the given scope; it never queries SupportTeam
 * itself (that stays a controller-layer concern, per the approved
 * F.3.7 authorization design).
 */
export async function addInternalNote({ actorUserId, actorType, ticketId, body, attachments, scopeTeamIds = null, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");

  if (scopeTeamIds) {
    const teamRef = ticket.currentAssignment?.teamRef;
    if (!teamRef || !scopeTeamIds.some((t) => t.toString() === teamRef.toString())) {
      throw Errors.forbidden("This ticket is outside your team scope");
    }
  }
  if (!ticket.conversationRef) throw Errors.internal("Ticket has no conversation");

  const message = await SupportMessage.create({
    conversationRef: ticket.conversationRef,
    ticketRef: ticket._id,
    senderRef: actorUserId,
    senderType: SENDER_TYPE.AGENT,
    visibility: MESSAGE_VISIBILITY.INTERNAL,
    body,
    attachments: attachments || [],
    channel: CHANNEL.IN_APP,
  });

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: actorUserId,
    actorType,
    action: AUDIT_ACTION.INTERNAL_NOTE,
    entityId: ticket._id,
  });

  // Phase F.3.8 — internal audience ONLY (assigned agent + team +
  // supportAdmin rooms). The customer's user:{requesterRef} room is
  // never included here — an INTERNAL note must never reach it, under
  // any circumstance, matching the same rule already enforced for
  // REST reads (getMyTicketDetail's CUSTOMER_VISIBLE-only filter). No
  // NotificationService call either — see the phase report's
  // "Notifications" section for why persisted staff notifications are
  // out of scope this phase.
  emitToRooms(
    io,
    staffRooms({ agentRefs: [ticket.currentAssignment?.agentRef], teamRef: ticket.currentAssignment?.teamRef }),
    "support:ticket:internalNote",
    { ticketId: ticket._id, messageId: message._id }
  );

  return message;
}

/**
 * Phase F.3.7 — an agent's own currently-ACTIVE-assignment tickets
 * only, per the approved authorization matrix ("AGENT: own active
 * assignments only for agent-scoped operations"). Reuses the exact
 * buildPagination/buildStatusFilter/paginatedQuery helpers already
 * established by listMyTickets() — no new pagination architecture.
 */
export async function listAgentTickets({ agentUserId, query }) {
  const pagination = buildPagination(query);
  const filter = { "currentAssignment.agentRef": agentUserId, isDeleted: false };
  Object.assign(filter, buildStatusFilter(query, "status", Object.values(TICKET_STATUS)));

  // Phase H Step 9 (follow-up) — additive channel visibility for the
  // Admin Panel ticket list. SupportTicket itself has no channel
  // field (channel lives on SupportConversation); populate() is the
  // read-only join, no schema change, no other field affected.
  return paginatedQuery(SupportTicket, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [{ path: "conversationRef", select: "channel" }],
  });
}

/**
 * Phase F.3.7 — ticket detail for the agent it is currently assigned
 * to. Unlike getMyTicketDetail() (customer-facing, CUSTOMER_VISIBLE
 * only), this returns every non-deleted message regardless of
 * visibility — CUSTOMER_VISIBLE and INTERNAL alike — since the only
 * hard rule from the approved design is "customer/owner must never
 * see INTERNAL," not that internal actors should see less than
 * everything.
 */
export async function getAgentTicketDetail({ agentUserId, ticketId, query = {} }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (!ticket.currentAssignment?.agentRef || ticket.currentAssignment.agentRef.toString() !== agentUserId.toString()) {
    throw Errors.forbidden("This ticket is not currently assigned to you");
  }

  const pagination = buildPagination(query);
  const { docs: messages, meta: messagesPagination } = await paginatedQuery(
    SupportMessage,
    { ticketRef: ticket._id, isDeleted: false },
    pagination,
    { sort: { createdAt: 1 } }
  );

  // Phase H Step 8 (follow-up) — a SEPARATE `requester` field, never a
  // mutation of ticket.requesterRef itself. That field is relied on
  // elsewhere as a raw ObjectId (confirmed by direct inspection:
  // bookingVerification.service.js does `String(ticket.requesterRef)
  // !== ownerId`, and issueRefundHandler/getTicketVerificationHandler
  // both feed this same getAgentTicketDetail-shaped ticket into that
  // exact check) — populating requesterRef in place would silently
  // turn every such comparison into a permanent OWNERSHIP_MISMATCH,
  // breaking the refund/verification flow. Fetched as a small,
  // best-effort lookup: a missing/deleted User must never fail the
  // whole ticket-detail call.
  const requester = await User.findOne({ _id: ticket.requesterRef, isDeleted: { $ne: true } })
    .select("name phone email")
    .lean();

  return { ticket, messages, messagesPagination, requester: requester || null };
}

/**
 * Phase F.3.7 — SUPPORT_ADMIN (global, scopeTeamIds=null) or team-lead
 * (scoped to their own team's queues) ticket listing. scopeTeamIds is
 * resolved by the caller (controller layer) from SupportTeam.
 * teamLeadRef — this function never queries SupportTeam itself, same
 * separation of concerns as addInternalNote() above. Filters by
 * currentAssignment.teamRef, which hits no dedicated index today
 * (Phase F.1's indexes cover agentRef/queueRef, not teamRef) — an
 * acceptable, not-yet-optimized read at current scale; flagged as a
 * future index candidate, not a Phase F.3.7 blocker.
 */
export async function listAdminTickets({ scopeTeamIds = null, query }) {
  const pagination = buildPagination(query);
  const filter = { isDeleted: false };
  if (scopeTeamIds) {
    filter["currentAssignment.teamRef"] = { $in: scopeTeamIds };
  }
  Object.assign(filter, buildStatusFilter(query, "status", Object.values(TICKET_STATUS)));

  // Phase H Step 9 (follow-up) — see the identical comment in
  // listAgentTickets() above.
  return paginatedQuery(SupportTicket, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [{ path: "conversationRef", select: "channel" }],
  });
}

/** Phase F.3.7 — admin/team-lead ticket detail; see listAdminTickets(). */
export async function getAdminTicketDetail({ scopeTeamIds = null, ticketId, query = {} }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!ticket) throw Errors.notFound("Ticket not found");

  if (scopeTeamIds) {
    const teamRef = ticket.currentAssignment?.teamRef;
    if (!teamRef || !scopeTeamIds.some((t) => t.toString() === teamRef.toString())) {
      throw Errors.forbidden("This ticket is outside your team scope");
    }
  }

  const pagination = buildPagination(query);
  const { docs: messages, meta: messagesPagination } = await paginatedQuery(
    SupportMessage,
    { ticketRef: ticket._id, isDeleted: false },
    pagination,
    { sort: { createdAt: 1 } }
  );

  // Phase H Step 8 (follow-up) — a SEPARATE `requester` field, never a
  // mutation of ticket.requesterRef itself — see getAgentTicketDetail's
  // own comment above for exactly why (bookingVerification.service.js
  // and both getTicketVerificationHandler/issueRefundHandler in
  // adminSupport.controller.js consume this SAME ticket object and
  // rely on ticket.requesterRef staying a raw ObjectId).
  const requester = await User.findOne({ _id: ticket.requesterRef, isDeleted: { $ne: true } })
    .select("name phone email")
    .lean();

  return { ticket, messages, messagesPagination, requester: requester || null };
}

// ── Phase F.3.7 authorization-scope wrappers ────────────────────────
// These do NOT reimplement resolveTicketAssignment()/unassignTicket()/
// reassignTicket() — they are thin, minimal ownership/scope checks
// (a single lean read, no mutation, no engine decision-making) placed
// in front of the exact same unmodified functions F.3.4/F.3.5.1
// already built. This is the "API authorization layer/service
// boundary" enforcement point the approved F.3.7 decisions call for —
// deliberately kept here rather than inside assignmentResolution.
// service.js, which stays untouched this phase.

// Phase F.3.8 — widened to select+return the fields the emission
// helpers below need (requesterRef/requesterType/ticketNumber never
// change once set, so this pre-mutation read is always safe to reuse
// for the post-mutation notification/socket payload; only
// currentAssignment/status are what the subsequent engine call
// actually mutates).
const NOTIFY_FIELDS = "currentAssignment requesterRef requesterType ticketNumber status";

async function assertTicketAssignedToAgent(ticketId, agentUserId) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");
  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).select(NOTIFY_FIELDS).lean();
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (!ticket.currentAssignment?.agentRef || ticket.currentAssignment.agentRef.toString() !== agentUserId.toString()) {
    throw Errors.forbidden("This ticket is not currently assigned to you");
  }
  return ticket;
}

async function assertTicketWithinTeamScope(ticketId, scopeTeamIds) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");
  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).select(NOTIFY_FIELDS).lean();
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (scopeTeamIds) {
    const teamRef = ticket.currentAssignment?.teamRef;
    if (!teamRef || !scopeTeamIds.some((t) => t.toString() === teamRef.toString())) {
      throw Errors.forbidden("This ticket is outside your team scope");
    }
  }
  return ticket; // scopeTeamIds === null (SUPPORT_ADMIN) — global scope, no restriction
}

/**
 * Phase F.3.9 Defect #2 — "the assigned agent has started working on
 * this ticket": ASSIGNED -> IN_PROGRESS. VALID_TRANSITIONS has always
 * allowed this edge, but no controller/service anywhere ever invoked
 * it (confirmed by a repo-wide search before writing this) — a real
 * gap discovered during F.3.9's live DEV E2E verification (resolve
 * correctly rejected a freshly-assigned ticket with
 * INVALID_TICKET_STATE, since nothing could ever get it to
 * IN_PROGRESS first).
 *
 * Deliberately NOT routed through assignmentResolution.service.js —
 * unlike resolve/unassign/reassign, this transition has no assignment
 * or workload side effect at all (no new SupportAssignment row, no
 * capacity reservation/release), so there is nothing there to
 * delegate to. transitionTicketStatus() is called directly here,
 * exactly matching the precedent already set by addCustomerMessage's
 * own inline WAITING_FOR_USER->IN_PROGRESS auto-transition in this
 * same file, and by routeAndAssignTicket's own plain (non-transactional)
 * OPEN->TRIAGED/TRIAGED->QUEUED transitions — a single-document
 * transition with no cross-collection atomicity requirement has never
 * been wrapped in a session anywhere in this codebase, and isn't here
 * either. No new AUDIT_ACTION: transitionTicketStatus's own default
 * (STATUS_CHANGED) is reused, the same choice F.3.6 already made and
 * documented for the analogous OPEN/TRIAGED/QUEUED edges.
 *
 * Ownership derived the same way addAgentReply already does it — a
 * single non-lean fetch, ticket.currentAssignment.agentRef compared
 * directly against the caller's own req.user._id — never a
 * client-supplied agent id. Idempotent: already-IN_PROGRESS is a
 * deterministic no-op result, matching resolveTicketAssignment/
 * unassignTicket/reassignTicket's own established "reason" convention
 * rather than letting canTransition() throw a generic conflict for an
 * expected, ordinary case.
 *
 * Returns { ticket, reason } — reason is one of "STARTED" |
 * "ALREADY_IN_PROGRESS" | "INVALID_TICKET_STATE".
 */
export async function startAgentOwnTicket({ agentUserId, ticketId, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (!ticket.currentAssignment?.agentRef || ticket.currentAssignment.agentRef.toString() !== agentUserId.toString()) {
    throw Errors.forbidden("This ticket is not currently assigned to you");
  }

  if (ticket.status === TICKET_STATUS.IN_PROGRESS) {
    return { ticket, reason: "ALREADY_IN_PROGRESS" };
  }
  if (ticket.status !== TICKET_STATUS.ASSIGNED) {
    return { ticket, reason: "INVALID_TICKET_STATE" };
  }

  const fromStatus = ticket.status;
  const teamRef = ticket.currentAssignment?.teamRef || null;

  await transitionTicketStatus({
    ticket,
    toStatus: TICKET_STATUS.IN_PROGRESS,
    actorRef: agentUserId,
    actorType: ACTOR_TYPE.AGENT,
  });

  const rooms = [`user:${ticket.requesterRef}`, ...staffRooms({ teamRef })];
  emitToRooms(io, rooms, "support:ticket:statusChanged", {
    ticketId: ticket._id,
    fromStatus,
    toStatus: TICKET_STATUS.IN_PROGRESS,
  });
  await notifyTicketStatusChanged({ ticket, fromStatus, toStatus: TICKET_STATUS.IN_PROGRESS });

  return { ticket, reason: "STARTED" };
}

/**
 * Phase G Step 4 — "Agent marks ticket as Waiting for Customer":
 * IN_PROGRESS -> WAITING_FOR_USER. Exact same shape as
 * startAgentOwnTicket() above (agent-scoped, own-assigned-ticket-
 * only, idempotent-reason convention for the wrong-status case, no
 * new authorization primitive). Calendar-time only — no BusinessHours
 * involved anywhere in this function.
 *
 * Also pauses SLA resolution timing: slaTargets.pausedAt is set to
 * the transition timestamp, bundled into the SAME
 * transitionTicketStatus() call (and therefore the same ticket.save())
 * via extraFields. Safe to bundle here (unlike the resume side in
 * addCustomerMessage() below, which uses a separate atomic update
 * instead): canTransition() already rejects a second pause attempt on
 * its own (WAITING_FOR_USER has no self-transition in
 * VALID_TRANSITIONS, so a ticket already paused can never re-enter
 * this function's success path), and transitionTicketStatus()'s own
 * ticket.save() is guarded by Mongoose's default document versioning
 * against a genuinely concurrent second write.
 *
 * transitionTicketStatus()'s extraFields is applied via a shallow
 * Object.assign — passing a partial slaTargets object would silently
 * replace the ENTIRE sub-document, wiping G.2's firstResponseDueAt/
 * resolutionDueAt. All four existing slaTargets fields are therefore
 * read and re-supplied explicitly, changing only pausedAt.
 *
 * Returns { ticket, reason } — reason is one of "WAITING_FOR_USER" |
 * "ALREADY_WAITING_FOR_USER" | "INVALID_TICKET_STATE".
 */
export async function waitForUserAgentOwnTicket({ agentUserId, ticketId, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");
  if (!ticket.currentAssignment?.agentRef || ticket.currentAssignment.agentRef.toString() !== agentUserId.toString()) {
    throw Errors.forbidden("This ticket is not currently assigned to you");
  }

  if (ticket.status === TICKET_STATUS.WAITING_FOR_USER) {
    return { ticket, reason: "ALREADY_WAITING_FOR_USER" };
  }
  if (ticket.status !== TICKET_STATUS.IN_PROGRESS) {
    return { ticket, reason: "INVALID_TICKET_STATE" };
  }

  const fromStatus = ticket.status;
  const teamRef = ticket.currentAssignment?.teamRef || null;

  await transitionTicketStatus({
    ticket,
    toStatus: TICKET_STATUS.WAITING_FOR_USER,
    actorRef: agentUserId,
    actorType: ACTOR_TYPE.AGENT,
    extraFields: {
      slaTargets: {
        firstResponseDueAt: ticket.slaTargets?.firstResponseDueAt || null,
        resolutionDueAt: ticket.slaTargets?.resolutionDueAt || null,
        pausedAt: new Date(),
        totalPausedMs: ticket.slaTargets?.totalPausedMs || 0,
      },
    },
  });

  const rooms = [`user:${ticket.requesterRef}`, ...staffRooms({ teamRef })];
  emitToRooms(io, rooms, "support:ticket:statusChanged", {
    ticketId: ticket._id,
    fromStatus,
    toStatus: TICKET_STATUS.WAITING_FOR_USER,
  });
  await notifyTicketStatusChanged({ ticket, fromStatus, toStatus: TICKET_STATUS.WAITING_FOR_USER });

  return { ticket, reason: "WAITING_FOR_USER" };
}

/** Agent resolving a ticket — only if it is currently assigned to them. */
export async function resolveAgentOwnTicket({ agentUserId, ticketId, reason, io = null }) {
  const preTicket = await assertTicketAssignedToAgent(ticketId, agentUserId);
  const result = await resolveTicketAssignment({ ticketId, actorRef: agentUserId, actorType: ACTOR_TYPE.AGENT, reason });

  if (result.reason === "RESOLVED" && result.ticket) {
    const rooms = [`user:${result.ticket.requesterRef}`, ...staffRooms({ teamRef: preTicket.currentAssignment?.teamRef })];
    emitToRooms(io, rooms, "support:ticket:statusChanged", {
      ticketId: result.ticket._id,
      fromStatus: preTicket.status || null,
      toStatus: TICKET_STATUS.RESOLVED,
    });
    await notifyTicketStatusChanged({ ticket: result.ticket, fromStatus: preTicket.status || null, toStatus: TICKET_STATUS.RESOLVED });
  }

  return result;
}

/** Agent self-releasing a ticket — only if it is currently assigned to them. */
export async function unassignAgentOwnTicket({ agentUserId, ticketId, reason, io = null }) {
  const preTicket = await assertTicketAssignedToAgent(ticketId, agentUserId);
  const result = await unassignTicket({ ticketId, actorRef: agentUserId, actorType: ACTOR_TYPE.AGENT, reason });

  if (result.reason === "UNASSIGNED") {
    const teamRef = preTicket.currentAssignment?.teamRef || null;
    emitToRooms(io, staffRooms({ agentRefs: [agentUserId], teamRef }), "support:ticket:unassigned", {
      ticketId: preTicket._id,
      teamRef,
    });
    // unassignTicket()'s own transitionTicketStatus call is hardcoded
    // to ASSIGNED->QUEUED (assignmentResolution.service.js, frozen) —
    // reading that literal target here, not guessing it.
    const ticketForNotify = { _id: preTicket._id, requesterRef: preTicket.requesterRef, requesterType: preTicket.requesterType, ticketNumber: preTicket.ticketNumber };
    emitToRooms(io, [`user:${preTicket.requesterRef}`, ...staffRooms({ teamRef })], "support:ticket:statusChanged", {
      ticketId: preTicket._id,
      fromStatus: TICKET_STATUS.ASSIGNED,
      toStatus: TICKET_STATUS.QUEUED,
    });
    await notifyTicketStatusChanged({ ticket: ticketForNotify, fromStatus: TICKET_STATUS.ASSIGNED, toStatus: TICKET_STATUS.QUEUED });
  }

  return result;
}

/**
 * Agent adding an INTERNAL note — only on a ticket currently assigned
 * to them. Distinct scoping from addInternalNote()'s own scopeTeamIds
 * parameter (team-based, for the admin/team-lead surface) — an
 * individual agent's authority here is ownership-based, matching
 * resolve/unassign above, not team-based.
 */
export async function addAgentInternalNote({ agentUserId, ticketId, body, attachments, io = null }) {
  await assertTicketAssignedToAgent(ticketId, agentUserId);
  return addInternalNote({ actorUserId: agentUserId, actorType: ACTOR_TYPE.AGENT, ticketId, body, attachments, scopeTeamIds: null, io });
}

/** SUPPORT_ADMIN (scopeTeamIds=null) or team-lead-scoped reassignment. */
export async function reassignScopedTicket({ scopeTeamIds, ticketId, newAgentRef, actorRef, actorType, reason, io = null }) {
  const preTicket = await assertTicketWithinTeamScope(ticketId, scopeTeamIds);
  const result = await reassignTicket({ ticketId, newAgentRef, actorRef, actorType, reason });

  if (result.reason === "REASSIGNED") {
    // Reassignment never changes ticket.status (ASSIGNED->ASSIGNED,
    // per reassignTicket()'s own comment) — internal-audience-only
    // event, no customer statusChanged, no notification.
    const teamRef = preTicket.currentAssignment?.teamRef || null;
    emitToRooms(
      io,
      staffRooms({ agentRefs: [preTicket.currentAssignment?.agentRef, newAgentRef], teamRef }),
      "support:ticket:reassigned",
      { ticketId: preTicket._id, previousAgentRef: preTicket.currentAssignment?.agentRef || null, newAgentRef, teamRef }
    );
  }

  return result;
}

/** SUPPORT_ADMIN (scopeTeamIds=null) or team-lead-scoped unassignment. */
export async function unassignScopedTicket({ scopeTeamIds, ticketId, actorRef, actorType, reason, io = null }) {
  const preTicket = await assertTicketWithinTeamScope(ticketId, scopeTeamIds);
  const result = await unassignTicket({ ticketId, actorRef, actorType, reason });

  if (result.reason === "UNASSIGNED") {
    const teamRef = preTicket.currentAssignment?.teamRef || null;
    const previousAgentRef = preTicket.currentAssignment?.agentRef || null;
    emitToRooms(io, staffRooms({ agentRefs: [previousAgentRef], teamRef }), "support:ticket:unassigned", {
      ticketId: preTicket._id,
      teamRef,
    });
    const ticketForNotify = { _id: preTicket._id, requesterRef: preTicket.requesterRef, requesterType: preTicket.requesterType, ticketNumber: preTicket.ticketNumber };
    emitToRooms(io, [`user:${preTicket.requesterRef}`, ...staffRooms({ teamRef })], "support:ticket:statusChanged", {
      ticketId: preTicket._id,
      fromStatus: TICKET_STATUS.ASSIGNED,
      toStatus: TICKET_STATUS.QUEUED,
    });
    await notifyTicketStatusChanged({ ticket: ticketForNotify, fromStatus: TICKET_STATUS.ASSIGNED, toStatus: TICKET_STATUS.QUEUED });
  }

  return result;
}

/** SUPPORT_ADMIN (scopeTeamIds=null) or team-lead-scoped resolution. */
export async function resolveScopedTicket({ scopeTeamIds, ticketId, actorRef, actorType, reason, io = null }) {
  const preTicket = await assertTicketWithinTeamScope(ticketId, scopeTeamIds);
  const result = await resolveTicketAssignment({ ticketId, actorRef, actorType, reason });

  if (result.reason === "RESOLVED" && result.ticket) {
    const rooms = [`user:${result.ticket.requesterRef}`, ...staffRooms({ teamRef: preTicket.currentAssignment?.teamRef })];
    emitToRooms(io, rooms, "support:ticket:statusChanged", {
      ticketId: result.ticket._id,
      fromStatus: preTicket.status || null,
      toStatus: TICKET_STATUS.RESOLVED,
    });
    await notifyTicketStatusChanged({ ticket: result.ticket, fromStatus: preTicket.status || null, toStatus: TICKET_STATUS.RESOLVED });
  }

  return result;
}

/**
 * Phase S.4 — SUPPORT_ADMIN (scopeTeamIds=null) or team-lead-scoped
 * staff reopen of a CLOSED ticket. Deliberately NOT a call into
 * reopenTicket() above: that function is hardcoded to the customer
 * path — it rejects any caller whose id isn't ticket.requesterRef
 * (`"This ticket does not belong to you"`, which a staff actor would
 * always hit), and it hardcodes actorType: ACTOR_TYPE.CUSTOMER on
 * both of its transitionTicketStatus() calls, which would mislabel
 * the audit trail for a staff-initiated action even if the ownership
 * check were somehow bypassed. Reusing it as-is is therefore unsafe;
 * inspected directly before writing this (per the approved S.4
 * decision), not guessed.
 *
 * What IS reused, unmodified: the same frozen transitionTicketStatus()
 * engine call (ticketLifecycle.service.js), the same AUDIT_ACTION.
 * REOPENED / extraFields shape (reopenedAt, reopenCount) reopenTicket()
 * itself uses, and the same post-reopen "clear agentRef, transition to
 * QUEUED, run a fresh routeAndAssignTicket() cycle" flow — identical
 * behavior, correct actor. Authorization is assertTicketWithinTeamScope(),
 * the exact same primitive reassignScopedTicket/unassignScopedTicket/
 * resolveScopedTicket above already use — no new authorization rule
 * invented. scopeTeamIds===null (SUPPORT_ADMIN) is global; a team-lead
 * AGENT is scoped to their own team(s) via the ticket's
 * currentAssignment.teamRef, same as every other scoped wrapper here.
 *
 * CLOSED is the only VALID_TRANSITIONS edge into REOPENED — any other
 * current status returns the same deterministic "INVALID_TICKET_STATE"
 * reason (mapped to 409 by the existing REASON_STATUS table in both
 * controllers, no controller change needed for that mapping) rather
 * than throwing, matching startAgentOwnTicket()'s own established
 * idempotent-reason convention for "wrong status for this action".
 */
export async function reopenScopedTicket({ scopeTeamIds, ticketId, actorRef, actorType, reason, io = null }) {
  if (!mongoose.isValidObjectId(ticketId)) throw Errors.notFound("Ticket not found");

  const preTicket = await assertTicketWithinTeamScope(ticketId, scopeTeamIds);

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw Errors.notFound("Ticket not found");

  if (ticket.status !== TICKET_STATUS.CLOSED) {
    return { ticket, reason: "INVALID_TICKET_STATE" };
  }

  const fromStatus = ticket.status;
  const slaRecalc = await recalculateSlaOnReopen(ticket);
  await transitionTicketStatus({
    ticket,
    toStatus: TICKET_STATUS.REOPENED,
    actorRef,
    actorType,
    reason: reason || null,
    extraFields: { reopenedAt: new Date(), reopenCount: (ticket.reopenCount || 0) + 1, ...slaRecalc },
    auditAction: AUDIT_ACTION.REOPENED,
  });

  const teamRef = preTicket.currentAssignment?.teamRef || null;
  const rooms = [`user:${ticket.requesterRef}`, ...staffRooms({ teamRef })];
  emitToRooms(io, rooms, "support:ticket:statusChanged", {
    ticketId: ticket._id,
    fromStatus,
    toStatus: TICKET_STATUS.REOPENED,
  });
  await notifyTicketStatusChanged({ ticket, fromStatus, toStatus: TICKET_STATUS.REOPENED });

  // Same best-effort, post-commit, non-blocking fresh routing cycle as
  // reopenTicket()'s own identical philosophy — the reopen itself
  // already succeeded and must not appear to fail because of a
  // downstream routing problem.
  try {
    ticket.currentAssignment.agentRef = null;
    await transitionTicketStatus({
      ticket,
      toStatus: TICKET_STATUS.QUEUED,
      actorRef,
      actorType,
    });
    const result = await routeAndAssignTicket({ ticketId: ticket._id });
    await emitRoutingOutcome({ io, ticket, fromStatus: TICKET_STATUS.QUEUED, result });
  } catch (routingErr) {
    console.warn("[reopenScopedTicket] fresh routing/assignment cycle failed (non-critical):", routingErr.message);
  }

  return { ticket, reason: "REOPENED" };
}
