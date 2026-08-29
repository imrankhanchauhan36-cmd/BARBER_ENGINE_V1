/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportCall.js
 *
 * Phase H — Call Support. The single AGGREGATE row per call — current/
 * authoritative state, incrementally updated as lifecycle events
 * arrive from SupportInboundCallEvent (see that model's header for why
 * these are two separate models: one call has many raw events but
 * exactly one current-state row). This is what a SupportTicket links
 * to and what the Admin Panel displays — never a SupportMessage (see
 * callInbound.service.js's header for why a call attached to an
 * existing ticket does not create one).
 *
 * providerCallId carries the UNIQUE INDEX — one call, one row, ever.
 * Every write to this document from callInbound.service.js is an
 * ATOMIC CONDITIONAL update (e.g. only set endedAt/durationSeconds if
 * status isn't already COMPLETED) — this is what makes a duplicate or
 * out-of-order lifecycle event safe even if the per-event ledger's own
 * idempotency check were somehow bypassed (defense in depth, matching
 * this codebase's existing atomic-conditional-update idiom already
 * used by addAgentReply()'s firstRespondedAt guard and
 * reserveAgentCapacity()'s capacity guard).
 *
 * recordingRef/recordingStatus are reserved, populated by nothing in
 * this phase — metadata-only per the approved design; no audio is
 * ever stored here or anywhere in this application.
 */

import mongoose from "mongoose";
import { CALL_DIRECTION, CALL_STATUS, CALL_OUTCOME, CALL_RECORDING_STATUS } from "../constants/support.constants.js";

const supportCallSchema = new mongoose.Schema(
  {
    // The idempotency + identity boundary — see file header.
    providerCallId: { type: String, required: true, trim: true },
    provider: { type: String, default: null, trim: true },

    direction: {
      type: String,
      enum: Object.values(CALL_DIRECTION),
      required: true,
    },

    fromPhoneNumber: { type: String, required: true, trim: true },
    toPhoneNumber: { type: String, default: null, trim: true },

    status: {
      type: String,
      enum: Object.values(CALL_STATUS),
      required: true,
    },

    startedAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: null, min: 0 },

    // The matched/created Support case this call belongs to — never
    // null once resolved (an unknown-caller call never reaches this
    // model at all; see callInbound.service.js).
    ticketRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", required: true },
    conversationRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportConversation", default: null },
    matchedUserRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Denormalized from ticket.currentAssignment.agentRef at
    // match/creation time — a convenience for display, never a second
    // routing decision (the ticket's own assignment remains
    // authoritative; see assignmentResolution.service.js, unmodified).
    agentRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Agent-recorded, minimal — see support.constants.js's own comment
    // on CALL_OUTCOME: intentionally flat, not a workflow.
    outcome: {
      type: String,
      enum: Object.values(CALL_OUTCOME),
      default: null,
    },
    outcomeNotes: { type: String, default: null, maxlength: 2000 },

    // Reserved, unpopulated this phase — metadata-only recording
    // strategy per the approved design (no audio stored anywhere).
    recordingRef: { type: String, default: null },
    recordingStatus: {
      type: String,
      enum: Object.values(CALL_RECORDING_STATUS),
      default: null,
    },

    // Minimal, non-sensitive provider fields only, for reconciliation —
    // never raw audio, never full webhook payloads with PII beyond
    // what's already captured in named fields above.
    providerMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// The identity + idempotency index — see file header.
supportCallSchema.index({ providerCallId: 1 }, { unique: true });

// Ticket-scoped lookups (e.g. rendering a ticket's call history) —
// mirrors how SupportAssignment is indexed by ticketRef.
supportCallSchema.index({ ticketRef: 1, createdAt: -1 });

// User-scoped reverse lookup — mirrors SupportInboundWhatsAppEvent's
// own matchedUserRef+createdAt index.
supportCallSchema.index({ matchedUserRef: 1, createdAt: -1 });

export default mongoose.models.SupportCall || mongoose.model("SupportCall", supportCallSchema);
