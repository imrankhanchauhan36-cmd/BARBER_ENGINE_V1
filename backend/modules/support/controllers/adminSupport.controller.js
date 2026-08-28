/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminSupport.controller.js
 *
 * Phase F.3.7 — SUPPORT_ADMIN / team-lead Support endpoints. Thin
 * controllers, same layering as every other Support controller —
 * business logic lives in supportTicket.service.js /
 * assignmentResolution.service.js.
 *
 * Team Lead is derived, not a role (approved F.3.7 decision):
 * resolveAdminScope() below is the one new authorization primitive
 * this phase introduces — a read-only SupportTeam.teamLeadRef lookup,
 * never a mutation, never touching the protected SupportTeam model
 * file itself. SUPPORT_ADMIN gets scopeTeamIds=null (global); an
 * AGENT who leads zero teams is rejected outright (403) rather than
 * silently granted or denied partial access.
 *
 * /assign and /close are intentionally SUPPORT_ADMIN-only — the
 * approved authorization matrix does not list either for team leads,
 * so assertIsSupportAdmin() gates just those two handlers.
 */

import { successResponse, Errors } from "../../../utils/response.js";
import SupportTeam from "../models/SupportTeam.js";
import { emitToRoom } from "../../../socket/index.js";
import { ACTOR_TYPE, TICKET_STATUS, AUDIT_ACTION } from "../constants/support.constants.js";
import {
  listAdminTickets,
  getAdminTicketDetail,
  addInternalNote,
  reassignScopedTicket,
  unassignScopedTicket,
  resolveScopedTicket,
  reopenScopedTicket,
  emitRoutingOutcome,
  notifyTicketStatusChanged,
} from "../services/supportTicket.service.js";
import { routeAndAssignTicket, closeTicket } from "../services/assignmentResolution.service.js";
import { resolveTicketVerification } from "../services/verification/verificationResolver.service.js";
import { recordSupportAuditEvent } from "../services/supportAudit.service.js";
import { issueRefundForCancelledBooking } from "../../../services/RefundExecutionService.js";

// The single India-level main-console Admin (role:"ADMIN",
// adminLevel:"INDIA" — the same DB-uniquely-constrained top tier
// requireSupportAccess already recognizes at the route level) is the
// top-level Support administrator and gets the exact same unrestricted
// admin treatment as SUPPORT_ADMIN everywhere in this file — global
// scope, not team-lead scope, and tagged ACTOR_TYPE.ADMIN in the audit
// trail. STATE/DISTRICT admins never reach this file at all: they
// already fail requireSupportAccess("AGENT","SUPPORT_ADMIN") at the
// route level (adminSupport.routes.js) before any handler here runs.
function isSupportAdminTier(req) {
  return req.user.role === "SUPPORT_ADMIN" || (req.user.role === "ADMIN" && req.user.adminLevel === "INDIA");
}

async function resolveAdminScope(req) {
  if (isSupportAdminTier(req)) {
    return null; // global scope
  }
  const teams = await SupportTeam.find({ teamLeadRef: req.user._id, isDeleted: false }).select("_id").lean();
  if (teams.length === 0) {
    throw Errors.forbidden("You are not a team lead of any Support team");
  }
  return teams.map((t) => t._id);
}

function assertIsSupportAdmin(req) {
  if (!isSupportAdminTier(req)) {
    throw Errors.forbidden("Only SUPPORT_ADMIN may perform this action");
  }
}

function resolveActorType(req) {
  return isSupportAdminTier(req) ? ACTOR_TYPE.ADMIN : ACTOR_TYPE.AGENT;
}

// Phase F.3.7 audit §11 — identical table to agentSupport.controller.js;
// see that file's own comment for the full rationale.
const REASON_STATUS = {
  TICKET_NOT_FOUND: 404,
  ALREADY_ASSIGNED: 200,
  ALREADY_RESOLVED: 200,
  ALREADY_CLOSED: 200,
  ALREADY_UNASSIGNED: 200,
  NO_OP_SAME_AGENT: 200,
  NO_ACTIVE_ASSIGNMENT: 409,
  INVALID_TICKET_STATE: 409,
  CONCURRENT_MODIFICATION: 409,
  NEW_AGENT_NOT_ELIGIBLE: 422,
  NEW_AGENT_CAPACITY_UNAVAILABLE: 422,
  WORKLOAD_RELEASE_FAILED: 500,
  NO_AGENT_AVAILABLE: 200,
  NO_TEAM_RESOLVED: 200,
  ALREADY_PROGRESSED: 200,
};

const statusForReason = (reason) => REASON_STATUS[reason] ?? 200;

export const listAdminTicketsHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const { docs, meta } = await listAdminTickets({ scopeTeamIds, query: req.query });

    return successResponse(res, {
      message: "Tickets fetched successfully",
      data: { tickets: docs },
      pagination: meta,
    });
  } catch (err) {
    return next(err);
  }
};

export const getAdminTicketHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const { ticket, messages, messagesPagination } = await getAdminTicketDetail({
      scopeTeamIds,
      ticketId: req.params.id,
      query: req.query,
    });

    return successResponse(res, {
      message: "Ticket fetched successfully",
      data: { ticket, messages },
      pagination: messagesPagination,
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H Step 6 (H.3) — the smallest possible read-only surface over
// the H.2b Verification Resolver. Reuses resolveAdminScope() +
// getAdminTicketDetail() completely unchanged — the exact same
// ticket-access/authorization mechanism getAdminTicketHandler above
// already uses (team-lead scope for AGENT, global for SUPPORT_ADMIN;
// an out-of-scope or missing ticket already throws forbidden/notFound
// from inside getAdminTicketDetail itself). No new authorization
// primitive is introduced. The client supplies only the ticket id in
// the URL — actor identity comes exclusively from req.user, exactly
// like every other handler in this file; nothing from req.body/query
// ever reaches resolveTicketVerification().
export const getTicketVerificationHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const { ticket } = await getAdminTicketDetail({ scopeTeamIds, ticketId: req.params.id });

    const verification = await resolveTicketVerification({
      ticket,
      actor: { id: req.user._id, role: req.user.role },
    });

    return successResponse(res, {
      message: "Verification fetched successfully",
      data: { verification },
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H Step 7 (H.4) — the first real business-mutating Support
// action. SUPPORT_ADMIN-only (assertIsSupportAdmin), matching the
// same, already-established precedent as /assign and /close — a
// real money-moving action warrants at least that same bar, and
// resolveTicketVerification()'s OWNERSHIP_MISMATCH re-derivation is
// only proven for requesterType USER (Phase H Step 5 disclosure),
// so keeping this SUPPORT_ADMIN-global rather than also opening a
// team-lead-scoped or agent-owned variant is a deliberate, narrower
// choice than the read-only verification endpoint's dual-scope
// pattern — not an oversight.
//
// The verification gate is re-run FRESH on every single call, inside
// this same request, immediately before any execution is attempted —
// never a cached/prior result, never anything from req.body. Only
// state === VERIFIED_ACTION_ALLOWED with "ISSUE_REFUND" present in
// allowedActions permits execution; every other outcome is audited as
// REFUND_DENIED and rejected, before RefundExecutionService is ever
// called.
export const issueRefundHandler = async (req, res, next) => {
  try {
    assertIsSupportAdmin(req);

    const { ticket } = await getAdminTicketDetail({ scopeTeamIds: null, ticketId: req.params.id });
    const actor = { id: req.user._id, role: req.user.role };

    const verification = await resolveTicketVerification({ ticket, actor });

    if (verification.state !== "VERIFIED_ACTION_ALLOWED" || !verification.allowedActions.includes("ISSUE_REFUND")) {
      await recordSupportAuditEvent({
        ticketRef: ticket._id,
        actorRef: req.user._id,
        actorType: ACTOR_TYPE.ADMIN,
        action: AUDIT_ACTION.REFUND_DENIED,
        entityType: "Booking",
        entityId: ticket.relatedBookingRef || null,
        reason: `Blocked by fresh verification — state=${verification.state}, reason=${verification.reason}`,
      });
      throw Errors.conflict(`Refund is not currently allowed for this ticket (${verification.reason})`);
    }

    let result;
    try {
      result = await issueRefundForCancelledBooking({
        bookingId: ticket.relatedBookingRef,
        triggeredBy: "ADMIN",
        triggeredById: req.user._id,
      });
    } catch (execErr) {
      await recordSupportAuditEvent({
        ticketRef: ticket._id,
        actorRef: req.user._id,
        actorType: ACTOR_TYPE.ADMIN,
        action: AUDIT_ACTION.REFUND_DENIED,
        entityType: "Booking",
        entityId: ticket.relatedBookingRef,
        reason: `Verification allowed the action but execution failed: ${execErr.message}`,
      });
      throw execErr;
    }

    await recordSupportAuditEvent({
      ticketRef: ticket._id,
      actorRef: req.user._id,
      actorType: ACTOR_TYPE.ADMIN,
      action: AUDIT_ACTION.REFUND_ISSUED,
      entityType: "Booking",
      entityId: ticket.relatedBookingRef,
      newValue: { refundPaise: result.refundPaise, alreadyIssued: result.alreadyIssued, walletTransactionId: result.walletTransactionId },
      reason: req.body.reason || null,
    });

    return successResponse(res, {
      message: result.alreadyIssued ? "Refund was already issued for this booking" : "Refund issued successfully",
      data: { result },
    });
  } catch (err) {
    return next(err);
  }
};

export const assignAdminTicketHandler = async (req, res, next) => {
  try {
    assertIsSupportAdmin(req);
    const result = await routeAndAssignTicket({ ticketId: req.params.id });

    // routeAndAssignTicket()'s own ALREADY_PROGRESSED short-circuit
    // guarantees every other reason value it can return here only
    // ever occurs starting from QUEUED (or a ticket auto-progressed
    // there moments earlier in this same call) — never guessed.
    if (result.ticket) {
      await emitRoutingOutcome({ io: req.app.get("io"), ticket: result.ticket, fromStatus: TICKET_STATUS.QUEUED, result });
    }

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket routing/assignment triggered successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const reassignAdminTicketHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const result = await reassignScopedTicket({
      scopeTeamIds,
      ticketId: req.params.id,
      newAgentRef: req.body.newAgentRef,
      actorRef: req.user._id,
      actorType: resolveActorType(req),
      reason: req.body.reason,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket reassigned successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const unassignAdminTicketHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const result = await unassignScopedTicket({
      scopeTeamIds,
      ticketId: req.params.id,
      actorRef: req.user._id,
      actorType: resolveActorType(req),
      reason: req.body.reason,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket unassigned successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const resolveAdminTicketHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const result = await resolveScopedTicket({
      scopeTeamIds,
      ticketId: req.params.id,
      actorRef: req.user._id,
      actorType: resolveActorType(req),
      reason: req.body.reason,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket resolved successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const closeAdminTicketHandler = async (req, res, next) => {
  try {
    assertIsSupportAdmin(req);
    const result = await closeTicket({
      ticketId: req.params.id,
      actorRef: req.user._id,
      actorType: ACTOR_TYPE.ADMIN,
      reason: req.body.reason,
    });

    // closeTicket() mutates only status/closedAt on the one ticket
    // document it holds and returns — unlike resolveAssignment()'s
    // engine, it never re-fetches a second, separately-mutated copy —
    // so result.ticket.currentAssignment.teamRef is trustworthy here.
    if (result.reason === "CLOSED" && result.ticket) {
      const io = req.app.get("io");
      const teamRef = result.ticket.currentAssignment?.teamRef || null;
      const rooms = [`user:${result.ticket.requesterRef}`];
      if (teamRef) rooms.push(`supportTeam:${teamRef}`);
      rooms.push("supportAdmin");
      for (const room of rooms) {
        emitToRoom(io, room, "support:ticket:statusChanged", {
          ticketId: result.ticket._id,
          fromStatus: TICKET_STATUS.RESOLVED,
          toStatus: TICKET_STATUS.CLOSED,
        });
      }
      await notifyTicketStatusChanged({ ticket: result.ticket, fromStatus: TICKET_STATUS.RESOLVED, toStatus: TICKET_STATUS.CLOSED });
    }

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket closed successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const reopenAdminTicketHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const result = await reopenScopedTicket({
      scopeTeamIds,
      ticketId: req.params.id,
      actorRef: req.user._id,
      actorType: resolveActorType(req),
      reason: req.body.reason,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket reopened successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const addAdminInternalNoteHandler = async (req, res, next) => {
  try {
    const scopeTeamIds = await resolveAdminScope(req);
    const message = await addInternalNote({
      actorUserId: req.user._id,
      actorType: resolveActorType(req),
      ticketId: req.params.id,
      body: req.body.body,
      attachments: req.body.attachments,
      scopeTeamIds,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Internal note added successfully",
      data: { message },
    });
  } catch (err) {
    return next(err);
  }
};
