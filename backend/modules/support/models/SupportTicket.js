/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportTicket.js
 *
 * Phase C — Support Core. Frozen per Phase B §5.
 *
 * routingSnapshot is captured once at creation and never rewritten —
 * mirrors Booking.userRef/salonRef immutability. currentAssignment is
 * a denormalized current-state pointer (same idiom as
 * Salon.assignedAdmin / District.primaryAdminRef) — full history
 * lives in SupportAuditEvent, not here. Routing/Queue/Team/Agent do
 * not exist yet (later phases) so currentAssignment stays null until
 * then; a ticket must remain fully valid with every currentAssignment
 * field null.
 */

import mongoose from "mongoose";
import {
  TICKET_STATUS,
  REQUESTER_TYPE,
  PRIORITY,
  ROUTING_SNAPSHOT_SOURCE,
} from "../constants/support.constants.js";

const routingSnapshotSchema = new mongoose.Schema(
  {
    countryRef: { type: mongoose.Schema.Types.ObjectId, ref: "Country", default: null },
    stateRef: { type: mongoose.Schema.Types.ObjectId, ref: "State", default: null },
    districtRef: { type: mongoose.Schema.Types.ObjectId, ref: "District", default: null },
    cityRef: { type: mongoose.Schema.Types.ObjectId, ref: "City", default: null },
    areaRef: { type: mongoose.Schema.Types.ObjectId, ref: "Area", default: null },
    capturedAt: { type: Date, default: null },
    source: {
      type: String,
      enum: Object.values(ROUTING_SNAPSHOT_SOURCE),
      default: ROUTING_SNAPSHOT_SOURCE.NONE,
    },
  },
  { _id: false }
);

// Queue/Team models now exist (Phase F.1) — `ref:` added is metadata
// only (enables .populate()), no change to this shape or behavior.
// agentRef refs User directly (an agent's identity), matching the
// codebase-wide convention that every actor/person reference points
// at User, not at a domain-specific profile document.
const currentAssignmentSchema = new mongoose.Schema(
  {
    queueRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportQueue", default: null },
    teamRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTeam", default: null },
    agentRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: null },
  },
  { _id: false }
);

const slaTargetsSchema = new mongoose.Schema(
  {
    firstResponseDueAt: { type: Date, default: null },
    resolutionDueAt: { type: Date, default: null },
    pausedAt: { type: Date, default: null },
    totalPausedMs: { type: Number, default: 0 },

    // Phase G Step 6 — additive SLA event-state markers only. Each
    // starts null and is flipped to a timestamp EXACTLY ONCE, by an
    // atomic `updateOne({..., field: null}, {$set: {field: now}})`
    // in the SLA scanner job — the same idempotent-flip idiom already
    // proven by firstRespondedAt (Phase G Step 3) and
    // slaTargets.pausedAt/totalPausedMs (Phase G Step 4). These four
    // fields are the sole persistence/idempotency mechanism for
    // "was an SLA_WARNING/SLA_BREACHED audit event already recorded
    // for this ticket+dimension" — nothing else on this document is
    // touched by that job. Never set by ticket creation (G.2), never
    // read by G.5's pure evaluator (which has no DB access at all).
    firstResponseWarningAt: { type: Date, default: null },
    firstResponseBreachedAt: { type: Date, default: null },
    resolutionWarningAt: { type: Date, default: null },
    resolutionBreachedAt: { type: Date, default: null },
  },
  { _id: false }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      trim: true,
    },

    requesterRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requesterType: {
      type: String,
      enum: Object.values(REQUESTER_TYPE),
      required: true,
    },

    relatedSalonRef: { type: mongoose.Schema.Types.ObjectId, ref: "Salon", default: null },
    relatedBookingRef: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },

    categoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportCategory",
      required: true,
    },

    priority: {
      type: String,
      enum: Object.values(PRIORITY),
      default: PRIORITY.NORMAL,
    },

    // App-validated against SUPPORTED_LANGUAGES — not its own
    // collection (Phase B §5: too lightweight to justify one).
    language: { type: String, default: "en" },

    subject: { type: String, required: true, trim: true, maxlength: 200 },

    status: {
      type: String,
      enum: Object.values(TICKET_STATUS),
      default: TICKET_STATUS.OPEN,
      required: true,
    },

    routingSnapshot: { type: routingSnapshotSchema, default: () => ({}) },
    currentAssignment: { type: currentAssignmentSchema, default: () => ({}) },

    // SupportSlaPolicy doesn't exist until Phase G — plain ObjectId,
    // no `ref:`, same forward-compatibility reasoning as currentAssignment.
    slaPolicyRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    slaTargets: { type: slaTargetsSchema, default: () => ({}) },

    conversationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportConversation",
      default: null,
    },

    firstRespondedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    reopenedAt: { type: Date, default: null },
    reopenCount: { type: Number, default: 0 },

    // Phase H — Bot Support. Null means the bot may still engage with
    // this ticket; set (to the escalation time) means the bot must
    // permanently stay silent — supportBot.service.js checks this
    // field before doing any classification work. Deliberately a
    // single nullable field, not a new lifecycle status — reuses the
    // EXISTING TICKET_STATUS values (WAITING_FOR_USER, etc.) for
    // everything else; this is purely a bot-engagement flag,
    // orthogonal to ticket status.
    botHandoffAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Approved Phase-C index set only (Phase B freeze §3/§C) — geo-reporting,
// SLA-breach-scan, and text-search indexes are explicitly deferred.
supportTicketSchema.index({ ticketNumber: 1 }, { unique: true });
supportTicketSchema.index({ requesterRef: 1, status: 1 });
supportTicketSchema.index({ "currentAssignment.agentRef": 1, status: 1 });
supportTicketSchema.index({ "currentAssignment.queueRef": 1, status: 1, priority: 1, createdAt: 1 });
supportTicketSchema.index({ relatedSalonRef: 1 }, { sparse: true });
supportTicketSchema.index({ relatedBookingRef: 1 }, { sparse: true });

export default mongoose.models.SupportTicket || mongoose.model("SupportTicket", supportTicketSchema);
