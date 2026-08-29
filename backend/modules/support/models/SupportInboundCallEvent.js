/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportInboundCallEvent.js
 *
 * Phase H — Call Support (inbound). The durable, append-only,
 * per-webhook-DELIVERY idempotency ledger — one row per EVENT, not per
 * call. Deliberately separate from SupportCall.js (the aggregate,
 * one-row-per-CALL state), because unlike Email/WhatsApp's one-shot
 * inbound events, a single phone call is a multi-event lifecycle
 * (ringing -> answered -> completed), each delivered as its own
 * webhook. This ledger is the raw record of every delivery attempt;
 * SupportCall.js is the current/authoritative state derived from it.
 * Same "unique index is the real boundary, not an in-memory check"
 * idiom as SupportInboundEmailEvent.js / SupportInboundWhatsAppEvent.js.
 *
 * providerEventId is the SPECIFIC delivery's own id (a real provider
 * gives each lifecycle event — ringing/answered/completed — its own
 * event id even though they share one providerCallId; a dev adapter
 * can construct one deterministically, e.g. `${providerCallId}:${eventType}`,
 * to guarantee this per-event uniqueness without a real provider).
 * providerCallId is the STABLE identifier shared by every event
 * belonging to the same call — indexed but NOT unique here (many
 * events, one call), unique instead on SupportCall.providerCallId.
 */

import mongoose from "mongoose";

const SUPPORT_INBOUND_CALL_EVENT_STATUS = Object.freeze({
  PROCESSED: "PROCESSED",
  UNMATCHED_SENDER: "UNMATCHED_SENDER",
  FAILED: "FAILED",
});

const supportInboundCallEventSchema = new mongoose.Schema(
  {
    // The idempotency boundary — see file header.
    providerEventId: { type: String, required: true, trim: true },

    // The call this event belongs to (shared across that call's whole
    // lifecycle) — see file header for why this is indexed, not unique.
    providerCallId: { type: String, required: true, trim: true },

    // Provider-reported lifecycle stage for THIS event, e.g.
    // "INITIATED"/"RINGING"/"ANSWERED"/"COMPLETED" — never assumed to
    // have any particular format; a dev-adapter/real-provider concern.
    eventType: { type: String, default: null, trim: true },

    fromPhoneNumber: { type: String, required: true, trim: true },
    toPhoneNumber: { type: String, default: null, trim: true },

    // Set only once a caller is successfully matched against an
    // existing User — never set to a newly-created User, since this
    // module never creates one (see callInbound.service.js).
    matchedUserRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    matchedTicketRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", default: null },
    matchedConversationRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportConversation", default: null },

    status: {
      type: String,
      enum: Object.values(SUPPORT_INBOUND_CALL_EVENT_STATUS),
      required: true,
    },

    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },

    // Populated only when status === FAILED — a parsing/processing
    // error, never a full stack trace (no secrets, no raw payload).
    errorMessage: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

// The idempotency index. Not partial/sparse — every row always has a
// real providerEventId (required:true), same reasoning
// SupportInboundEmailEvent.providerEventId's own index documents.
supportInboundCallEventSchema.index({ providerEventId: 1 }, { unique: true });

// Many events share one call — this is the lookup used to gather a
// call's full raw event history (e.g. for admin/audit display), never
// a uniqueness boundary.
supportInboundCallEventSchema.index({ providerCallId: 1, createdAt: 1 });

export const SUPPORT_INBOUND_CALL_EVENT_STATUS_VALUES = SUPPORT_INBOUND_CALL_EVENT_STATUS;

export default mongoose.models.SupportInboundCallEvent ||
  mongoose.model("SupportInboundCallEvent", supportInboundCallEventSchema);
