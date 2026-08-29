/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportBotAction.js
 *
 * Phase H — Bot Support. Two purposes in one purpose-built model,
 * avoiding a redundant third mechanism (per the approved design):
 *
 * 1. IDEMPOTENCY — the unique index on `triggerMessageRef` (the
 *    customer SupportMessage._id that triggered this bot attempt) is
 *    the durable, DB-backed boundary — same "unique index is the real
 *    boundary, not an in-memory check" idiom already proven three
 *    times (SupportInboundEmailEvent/SupportInboundWhatsAppEvent/
 *    SupportInboundCallEvent), applied here to "have I already
 *    processed this customer message" instead of a provider event id.
 *    A retried/duplicate bot-hook invocation for the SAME message
 *    collides on insert (E11000) and is treated as a safe no-op.
 *
 * 2. TELEMETRY/AUDIT — finer-grained bot operational detail (category
 *    classified, confidence, decision, outcome, error) lives here,
 *    NOT as additional AUDIT_ACTION enum values on SupportAuditEvent
 *    (which stays a case-lifecycle trail, human/admin-facing) —
 *    mirroring the exact SupportAuditEvent-vs-SupportCall separation
 *    Call Support already established.
 *
 * Deliberately a SEPARATE collection from SupportMessage/
 * SupportTicket, neither of which are modified by this model's
 * existence beyond SupportTicket's own single new botHandoffAt field.
 */

import mongoose from "mongoose";

const SUPPORT_BOT_DECISION = Object.freeze({
  REPLIED: "REPLIED",
  CLARIFIED: "CLARIFIED",
  ESCALATED: "ESCALATED",
  SKIPPED: "SKIPPED", // bot correctly chose to do nothing (e.g. already handed off)
});

const SUPPORT_BOT_OUTCOME = Object.freeze({
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
});

const supportBotActionSchema = new mongoose.Schema(
  {
    // The idempotency boundary — see file header.
    triggerMessageRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportMessage",
      required: true,
    },

    ticketRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", required: true },
    conversationRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportConversation", default: null },

    // Classification result — a SupportCategory reference, never a
    // parallel intent enum (per the approved design's explicit reuse
    // of the existing category taxonomy).
    classifiedCategoryRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportCategory", default: null },
    confidence: { type: Number, default: null, min: 0, max: 1 },

    decision: {
      type: String,
      enum: Object.values(SUPPORT_BOT_DECISION),
      required: true,
    },
    outcome: {
      type: String,
      enum: Object.values(SUPPORT_BOT_OUTCOME),
      required: true,
    },

    // The bot-generated reply text, when decision is REPLIED/CLARIFIED
    // — duplicated here (not just on the SupportMessage) so this row
    // is a complete, self-contained telemetry record even if the
    // message were ever deleted; never a substitute for the message.
    replyText: { type: String, default: null, maxlength: 2000 },

    // Populated only for ESCALATED.
    escalationReason: { type: String, default: null, maxlength: 500 },

    // Populated only when outcome === FAILED — a parsing/provider
    // error, never a full stack trace, never raw provider payloads
    // with customer PII beyond what's already in triggerMessageRef.
    errorMessage: { type: String, default: null, maxlength: 500 },

    provider: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

// The idempotency index. Not partial/sparse — every row always has a
// real triggerMessageRef (required:true).
supportBotActionSchema.index({ triggerMessageRef: 1 }, { unique: true });

// Ticket-scoped lookups (rendering a ticket's bot-activity history) —
// mirrors SupportCall's own ticketRef+createdAt index.
supportBotActionSchema.index({ ticketRef: 1, createdAt: -1 });

export const SUPPORT_BOT_DECISION_VALUES = SUPPORT_BOT_DECISION;
export const SUPPORT_BOT_OUTCOME_VALUES = SUPPORT_BOT_OUTCOME;

export default mongoose.models.SupportBotAction || mongoose.model("SupportBotAction", supportBotActionSchema);
