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
    const { ticket, messages, messagesPagination } = await getAgentTicketDetail({
      agentUserId,
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
