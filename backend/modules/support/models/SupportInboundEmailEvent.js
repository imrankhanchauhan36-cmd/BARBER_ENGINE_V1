/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportInboundEmailEvent.js
 *
 * Phase H Step 9 — Email Support (inbound). The durable idempotency +
 * threading ledger for inbound email — deliberately a SEPARATE
 * collection from SupportMessage/SupportConversation/SupportTicket,
 * none of which are modified by this model's existence.
 *
 * providerEventId carries the UNIQUE INDEX that is the sole
 * idempotency authority for this whole channel — the same "unique
 * index is the real boundary, not an in-memory check" idiom this
 * codebase already uses for payment-webhook idempotency (see
 * Transaction.js / WalletTransaction.js's own comments). A retried
 * webhook delivery attempts an insert here, collides with E11000, and
 * is treated as an already-processed no-op by the calling service —
 * this document is never updated in place to "become" the duplicate;
 * the FIRST successful insert is the only one that ever exists.
 *
 * messageId / inReplyTo / references are the email's own RFC 5322
 * threading headers — persisted so a LATER inbound email's
 * inReplyTo/references can be matched against a PRIOR email's
 * messageId to find matchedTicketRef, without depending on subject
 * text as the primary identity mechanism.
 *
 * Deliberately NOT a channel-agnostic "InboundEvent" — Email-specific,
 * matching the existing Support module's naming convention
 * (Support-prefixed models). A future channel (WhatsApp/Call) would
 * get its own analogous ledger, not a shared one — no premature
 * generalization.
 */

import mongoose from "mongoose";

const SUPPORT_INBOUND_EMAIL_STATUS = Object.freeze({
  PROCESSED: "PROCESSED",
  UNMATCHED_SENDER: "UNMATCHED_SENDER",
  FAILED: "FAILED",
});

const supportInboundEmailEventSchema = new mongoose.Schema(
  {
    // The idempotency boundary — see file header. Provider-specific
    // (e.g. a SendGrid Inbound Parse envelope id, or for the dev
    // adapter, a caller-supplied test id) — never assumed to have any
    // particular format.
    providerEventId: { type: String, required: true, trim: true },

    // RFC 5322 threading headers, as received — never normalized/
    // reformatted, so a later comparison is always byte-exact against
    // what the sending mail server actually produced.
    messageId: { type: String, default: null, trim: true },
    inReplyTo: { type: String, default: null, trim: true },
    references: { type: [String], default: [] },

    fromEmail: { type: String, required: true, trim: true, lowercase: true },
    toEmail: { type: String, default: null, trim: true, lowercase: true },
    subject: { type: String, default: null, trim: true, maxlength: 500 },

    // Set only once a sender is successfully matched against an
    // existing User — never set to a newly-created User, since this
    // module never creates one (see emailInbound.service.js).
    matchedUserRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    matchedTicketRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", default: null },
    matchedConversationRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportConversation", default: null },

    status: {
      type: String,
      enum: Object.values(SUPPORT_INBOUND_EMAIL_STATUS),
      required: true,
    },

    // Populated only when status === FAILED — a parsing/processing
    // error, never a full stack trace (no secrets, no raw email body).
    errorMessage: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

// The idempotency index. Not partial/sparse — every row always has a
// real providerEventId (required:true), so a plain unique index is
// correct and sufficient, same reasoning SupportCategory.code's own
// non-partial unique index documents.
supportInboundEmailEventSchema.index({ providerEventId: 1 }, { unique: true });

// Reverse-threading lookup: "does any prior event's messageId appear
// in this new email's inReplyTo/references?" — one indexed point
// lookup per candidate id, never a collection scan.
supportInboundEmailEventSchema.index({ messageId: 1 }, { sparse: true });

export const SUPPORT_INBOUND_EMAIL_STATUS_VALUES = SUPPORT_INBOUND_EMAIL_STATUS;

export default mongoose.models.SupportInboundEmailEvent ||
  mongoose.model("SupportInboundEmailEvent", supportInboundEmailEventSchema);
