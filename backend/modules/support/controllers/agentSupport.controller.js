/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/agentSupport.controller.js
 *
 * Phase F.3.7 — AGENT-facing Support endpoints. Thin controllers,
 * same layering as supportTicket.controller.js — DTO shaping only,
 * business logic lives entirely in supportTicket.service.js /
 * assignmentResolution.service.js. Every handler derives identity
 * exclusively from req.user._id/role — never a client-supplied
 * agentRef, matching the codebase's established ownership-derivation
 * convention. Ownership scoping itself ("is this ticket currently
 * assigned to me") is enforced inside the service-layer wrapper
 * functions this controller calls, not here.
 */

import { successResponse } from "../../../utils/response.js";
import {
  listAgentTickets,
  getAgentTicketDetail,
  addAgentReply,
  addAgentInternalNote,
  resolveAgentOwnTicket,
  unassignAgentOwnTicket,
  startAgentOwnTicket,
  waitForUserAgentOwnTicket,
} from "../services/supportTicket.service.js";
import { resolveTicketVerification } from "../services/verification/verificationResolver.service.js";
import { listAssignmentHistory } from "../services/assignmentResolution.service.js";
import { getTicketEmailHistory } from "../services/emailHistory.service.js";
import { logAgentCall, updateCallOutcome, getTicketCallHistory } from "../services/callLog.service.js";
import { getTicketBotActivity } from "../services/botActivity.service.js";

// Phase F.3.7 audit §11 — deterministic service `reason` -> HTTP status
// mapping, mirrored identically in adminSupport.controller.js. Every
// mutation service function returns a result object with a `reason`
// string rather than throwing for expected outcomes (confirmed across
// resolveTicketAssignment/unassignTicket/reassignTicket/closeTicket);
// this table is the mechanical translation the audit specified, not a
// new HTTP convention.
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
  STARTED: 200,
  ALREADY_IN_PROGRESS: 200,
  WAITING_FOR_USER: 200,
  ALREADY_WAITING_FOR_USER: 200,
};

const statusForReason = (reason) => REASON_STATUS[reason] ?? 200;

export const listMyAssignedTicketsHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const { docs, meta } = await listAgentTickets({ agentUserId, query: req.query });

    return successResponse(res, {
      message: "Assigned tickets fetched successfully",
      data: { tickets: docs },
      pagination: meta,
    });
  } catch (err) {
    return next(err);
  }
};

export const getMyAssignedTicketHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const { ticket, messages, messagesPagination, requester } = await getAgentTicketDetail({
      agentUserId,
      ticketId: req.params.id,
      query: req.query,
    });

    return successResponse(res, {
      message: "Ticket fetched successfully",
      data: { ticket, messages, requester },
      pagination: messagesPagination,
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H Step 6 (H.3) — mirrors adminSupport.controller.js's
// getTicketVerificationHandler exactly, but reuses THIS scope's own
// existing ticket-access mechanism (getAgentTicketDetail — "is this
// ticket currently assigned to me") since agentSupport.routes.js has
// no team-lead/global scope concept. Two endpoints exist, one per
// existing ticket-detail authorization mechanism, matching the
// codebase's own established dual-endpoint pattern (getMyAssignedTicketHandler
// vs getAdminTicketHandler) rather than inventing a third mechanism.
export const getMyTicketVerificationHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const { ticket } = await getAgentTicketDetail({ agentUserId, ticketId: req.params.id });

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

export const startMyTicketHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const result = await startAgentOwnTicket({
      agentUserId,
      ticketId: req.params.id,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket started successfully",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const waitForUserMyTicketHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const result = await waitForUserAgentOwnTicket({
      agentUserId,
      ticketId: req.params.id,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: statusForReason(result.reason),
      message: "Ticket marked as waiting for customer",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const resolveMyTicketHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const result = await resolveAgentOwnTicket({
      agentUserId,
      ticketId: req.params.id,
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

export const unassignMyTicketHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const result = await unassignAgentOwnTicket({
      agentUserId,
      ticketId: req.params.id,
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

export const addMyTicketReplyHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const message = await addAgentReply({
      agentUserId,
      ticketId: req.params.id,
      body: req.body.body,
      attachments: req.body.attachments,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Reply added successfully",
      data: { message },
    });
  } catch (err) {
    return next(err);
  }
};

export const addMyTicketInternalNoteHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const message = await addAgentInternalNote({
      agentUserId,
      ticketId: req.params.id,
      body: req.body.body,
      attachments: req.body.attachments,
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

// Phase H Step 8 (follow-up) — read-only assignment history for the
// agent's own currently-assigned ticket. Reuses getAgentTicketDetail()
// purely as the existing ownership gate ("is this ticket currently
// assigned to me") — its messages/requester fields are discarded
// here, no new authorization logic introduced. Full audit trail is
// deliberately NOT exposed to AGENT (see supportAudit.service.js's
// listAuditEvents() comment) — assignment history is the
// least-privilege subset appropriate for the agent's own case.
export const getMyTicketAssignmentHistoryHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    await getAgentTicketDetail({ agentUserId, ticketId: req.params.id });
    const history = await listAssignmentHistory({ ticketId: req.params.id });

    return successResponse(res, {
      message: "Assignment history fetched successfully",
      data: { history },
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H Step 9 (follow-up) — read-only email history for the
// agent's own currently-assigned ticket. Reuses getAgentTicketDetail()
// purely as the existing ownership gate, same pattern as
// getMyTicketAssignmentHistoryHandler above — no new authorization
// logic introduced, no admin-only data exposed.
export const getMyTicketEmailHistoryHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    await getAgentTicketDetail({ agentUserId, ticketId: req.params.id });
    const history = await getTicketEmailHistory({ ticketId: req.params.id });

    return successResponse(res, {
      message: "Email history fetched successfully",
      data: history,
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H — Call Support. Manually log a call against the agent's own
// assigned ticket — ownership is enforced inside logAgentCall() itself
// (same pattern as addAgentReply()), not here.
export const logMyTicketCallHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const call = await logAgentCall({
      agentUserId,
      ticketId: req.params.id,
      direction: req.body.direction,
      durationSeconds: req.body.durationSeconds,
      outcome: req.body.outcome,
      outcomeNotes: req.body.outcomeNotes,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Call logged successfully",
      data: { call },
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H — Call Support. Record/update a call's outcome — the one
// deliberately minimal post-call action.
export const updateMyTicketCallOutcomeHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    const call = await updateCallOutcome({
      agentUserId,
      ticketId: req.params.id,
      callId: req.params.callId,
      outcome: req.body.outcome,
      outcomeNotes: req.body.outcomeNotes,
    });

    return successResponse(res, {
      message: "Call outcome recorded successfully",
      data: { call },
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H — Call Support. Read-only call history for the agent's own
// assigned ticket. Reuses getAgentTicketDetail() purely as the
// existing ownership gate, same pattern as
// getMyTicketEmailHistoryHandler above.
export const getMyTicketCallHistoryHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    await getAgentTicketDetail({ agentUserId, ticketId: req.params.id });
    const history = await getTicketCallHistory({ ticketId: req.params.id });

    return successResponse(res, {
      message: "Call history fetched successfully",
      data: history,
    });
  } catch (err) {
    return next(err);
  }
};

// Phase H — Bot Support. Read-only bot activity for the agent's own
// assigned ticket. Reuses getAgentTicketDetail() purely as the
// existing ownership gate, same pattern as every other history
// handler above.
export const getMyTicketBotActivityHandler = async (req, res, next) => {
  try {
    const agentUserId = req.user._id;
    await getAgentTicketDetail({ agentUserId, ticketId: req.params.id });
    const activity = await getTicketBotActivity({ ticketId: req.params.id });

    return successResponse(res, {
      message: "Bot activity fetched successfully",
      data: activity,
    });
  } catch (err) {
    return next(err);
  }
};
