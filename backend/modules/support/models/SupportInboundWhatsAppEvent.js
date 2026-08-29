/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportInboundWhatsAppEvent.js
 *
 * Phase H — WhatsApp Support (inbound). The durable idempotency +
 * thread-disambiguation ledger for inbound WhatsApp messages —
 * deliberately a SEPARATE collection from
 * SupportMessage/SupportConversation/SupportTicket, none of which are
 * modified by this model's existence. Sibling of
 * SupportInboundEmailEvent.js, not a shared/generic "InboundEvent" —
 * that model's own header comment already states the precedent this
 * follows: "A future channel (WhatsApp/Call) would get its own
 * analogous ledger, not a shared one — no premature generalization."
 *
 * providerEventId carries the UNIQUE INDEX that is the sole
 * idempotency authority for this whole channel — the same
 * "unique index is the real boundary, not an in-memory check" idiom
 * already used for SupportInboundEmailEvent.providerEventId and, before
 * that, for payment-webhook idempotency (Transaction.js/
 * WalletTransaction.js). A retried webhook delivery attempts an insert
 * here, collides with E11000, and is treated as an already-processed
 * no-op by the calling service — this document is never updated in
 * place to "become" the duplicate; the FIRST successful insert is the
 * only one that ever exists.
 *
 * contextMessageId is WhatsApp's OPTIONAL reply-to message id (present
 * only when the customer explicitly quote-replies to a specific prior
 * message) — used only as a secondary disambiguation signal in
 * whatsappInbound.service.js (see that file's header for why phone
 * number + open-ticket-state is the PRIMARY threading mechanism here,
 * unlike Email's Message-ID-chain approach).
 *
 * fromPhoneNumber/toPhoneNumber are stored exactly as received from
 * the adapter (provider format, digits with country code) — never
 * normalized/reformatted here, so a later comparison or audit is
 * always byte-exact against what the provider actually sent. Country-
 * code stripping for User.phone matching happens in
 * whatsappInbound.service.js, not in this model.
 */

import mongoose from "mongoose";

const SUPPORT_INBOUND_WHATSAPP_STATUS = Object.freeze({
  PROCESSED: "PROCESSED",
  UNMATCHED_SENDER: "UNMATCHED_SENDER",
  FAILED: "FAILED",
});

const supportInboundWhatsAppEventSchema = new mongoose.Schema(
  {
    // The idempotency boundary — see file header. Provider-specific
    // (e.g. Meta Cloud API's own message "id"/wamid, or for the dev
    // adapter, a caller-supplied test id) — never assumed to have any
    // particular format.
    providerEventId: { type: String, required: true, trim: true },

    // WhatsApp's optional reply-to id, as received — never the primary
    // threading mechanism (see whatsappInbound.service.js).
    contextMessageId: { type: String, default: null, trim: true },

    fromPhoneNumber: { type: String, required: true, trim: true },
    toPhoneNumber: { type: String, default: null, trim: true },
    textBody: { type: String, default: null },

    // Set only once a sender is successfully matched against an
    // existing User — never set to a newly-created User, since this
    // module never creates one (see whatsappInbound.service.js).
    matchedUserRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    matchedTicketRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", default: null },
    matchedConversationRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportConversation", default: null },

    status: {
      type: String,
      enum: Object.values(SUPPORT_INBOUND_WHATSAPP_STATUS),
      required: true,
    },

    // Present on every row (unlike Email's provisional-then-updated
    // pattern, receivedAt is fixed at insert time); processedAt is set
    // once the service finishes handling the event (success or FAILED),
    // so a row stuck with processedAt:null would indicate a crash
    // mid-processing — useful operational signal at PAN-INDIA scale,
    // without adding any new idempotency mechanism.
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
supportInboundWhatsAppEventSchema.index({ providerEventId: 1 }, { unique: true });

// Reverse-threading lookup for the secondary disambiguation path
// (contextMessageId -> a prior outbound send's providerMessageId is
// looked up on NotificationDeliveryLog directly, not here — this index
// exists only for the rarer case of looking up a PRIOR INBOUND event's
// own providerEventId as a context match, mirroring
// SupportInboundEmailEvent's messageId index).
supportInboundWhatsAppEventSchema.index({ contextMessageId: 1 }, { sparse: true });

// Primary threading lookup: "does this matched user already have an
// open WhatsApp ticket?" is answered against SupportTicket directly
// (see whatsappInbound.service.js), not against this ledger — but a
// per-user reverse lookup on this ledger (e.g. for future admin
// tooling/audit) benefits from an index on the matched user too.
supportInboundWhatsAppEventSchema.index({ matchedUserRef: 1, createdAt: -1 });

export const SUPPORT_INBOUND_WHATSAPP_STATUS_VALUES = SUPPORT_INBOUND_WHATSAPP_STATUS;

export default mongoose.models.SupportInboundWhatsAppEvent ||
  mongoose.model("SupportInboundWhatsAppEvent", supportInboundWhatsAppEventSchema);
