/**
 * BARBER ENGINE V1
 * backend/modules/support/validators/supportInternal.validator.js
 *
 * Phase F.3.7 — agent/admin-facing mutation schemas. Same Joi
 * conventions as supportTicket.validator.js (shared `objectId`
 * primitive, `.unknown(false)`, per-field `.messages()`) — no new
 * validation architecture, and the attachment shape is copied
 * verbatim rather than re-exported to avoid a cross-file coupling
 * neither validator file previously had.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const attachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  type: Joi.string().optional(),
  publicId: Joi.string().optional(),
  mimeType: Joi.string().optional(),
  sizeBytes: Joi.number().positive().optional(),
});

export const supportInternalSchemas = {
  // POST /admin/tickets/:id/assign — routeAndAssignTicket() takes only
  // a ticketId, no body fields it can act on; the schema deliberately
  // stays empty rather than accepting fields the service can't use.
  assign: Joi.object({}).unknown(false),

  // POST /agent/tickets/:id/start — startAgentOwnTicket() takes only
  // a ticketId, no body fields it can act on; same empty-schema
  // convention as `assign` above.
  start: Joi.object({}).unknown(false),

  // POST /agent/tickets/:id/wait-for-user — Phase G Step 4,
  // waitForUserAgentOwnTicket() takes only a ticketId, same
  // empty-schema convention as `start`/`assign` above.
  waitForUser: Joi.object({}).unknown(false),

  reassign: Joi.object({
    newAgentRef: objectId.required().messages({ "any.required": "newAgentRef is required" }),
    reason: Joi.string().trim().max(500).allow(null).optional(),
  }).unknown(false),

  unassign: Joi.object({
    reason: Joi.string().trim().max(500).allow(null).optional(),
  }).unknown(false),

  resolve: Joi.object({
    reason: Joi.string().trim().max(500).allow(null).optional(),
  }).unknown(false),

  close: Joi.object({
    reason: Joi.string().trim().max(500).allow(null).optional(),
  }).unknown(false),

  // POST /admin/tickets/:id/refund — Phase H Step 7 (H.4). No
  // business field is ever accepted here — bookingId/transactionId/
  // amount are never client-supplied; the only input is an optional
  // free-text reason for the audit trail, same shape as resolve/close.
  issueRefund: Joi.object({
    reason: Joi.string().trim().max(500).allow(null).optional(),
  }).unknown(false),

  // POST /admin/tickets/:id/reopen — Phase S.4, same shape as
  // customer-facing reopenTicket's own `reason` field.
  reopen: Joi.object({
    reason: Joi.string().trim().max(500).allow(null).optional(),
  }).unknown(false),

  agentReply: Joi.object({
    body: Joi.string().trim().min(1).max(5000).required().messages({
      "any.required": "body is required",
    }),
    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
  }).unknown(false),

  internalNote: Joi.object({
    body: Joi.string().trim().min(1).max(5000).required().messages({
      "any.required": "body is required",
    }),
    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
  }).unknown(false),

  // Phase H — Call Support. Minimal, matching CALL_DIRECTION/
  // CALL_OUTCOME's own deliberately small enums (support.constants.js)
  // — no workflow fields invented here.
  logCall: Joi.object({
    direction: Joi.string().valid("INBOUND", "OUTBOUND").required().messages({
      "any.required": "direction is required",
    }),
    durationSeconds: Joi.number().integer().min(0).allow(null).default(null),
    outcome: Joi.string().valid("RESOLVED", "FOLLOW_UP_REQUIRED", "ESCALATED", "CUSTOMER_UNREACHABLE", "WRONG_NUMBER", "OTHER").allow(null).default(null),
    outcomeNotes: Joi.string().trim().max(2000).allow(null, "").default(null),
  }).unknown(false),

  callOutcome: Joi.object({
    outcome: Joi.string().valid("RESOLVED", "FOLLOW_UP_REQUIRED", "ESCALATED", "CUSTOMER_UNREACHABLE", "WRONG_NUMBER", "OTHER").required().messages({
      "any.required": "outcome is required",
    }),
    outcomeNotes: Joi.string().trim().max(2000).allow(null, "").default(null),
  }).unknown(false),
};
