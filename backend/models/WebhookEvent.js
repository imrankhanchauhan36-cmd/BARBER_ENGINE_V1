import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// WEBHOOK EVENT — idempotency + audit log for inbound gateway webhooks
// (Razorpay P0-B). One document per gateway event id: the unique
// {provider, eventId} index is what makes a duplicate or retried delivery
// a safe no-op. The same collection also holds ACTION locks (kind ACTION,
// eventId "ACTION:<name>:<key>") that serialize once-only side effects
// which several different events can trigger, e.g. "refund this payment".
//
// Deliberately stores only ids, amounts and statuses — never customer
// contact details or the raw payload.
//////////////////////////////////////////////////////////////

export const WEBHOOK_PROVIDER = Object.freeze({ RAZORPAY: "RAZORPAY" });

export const WEBHOOK_EVENT_KIND = Object.freeze({
  EVENT:  "EVENT",   // an inbound gateway event
  ACTION: "ACTION",  // an internal once-only action lock
});

export const WEBHOOK_EVENT_STATUS = Object.freeze({
  PROCESSING:   "PROCESSING",    // claimed by a worker (lease: lockedAt)
  PROCESSED:    "PROCESSED",     // handled; duplicates are ignored
  IGNORED:      "IGNORED",       // verified but deliberately not acted on
  NEEDS_REVIEW: "NEEDS_REVIEW",  // anomaly (e.g. amount mismatch) — no automatic action taken
  FAILED:       "FAILED",        // handler error; a retry may re-claim it
});

const WebhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: Object.values(WEBHOOK_PROVIDER), required: true },
    kind:     { type: String, enum: Object.values(WEBHOOK_EVENT_KIND), default: WEBHOOK_EVENT_KIND.EVENT },

    // Razorpay's X-Razorpay-Event-Id (stable across its retries), or a body
    // hash when the header is absent; or an ACTION key.
    eventId:  { type: String, required: true },
    eventType:{ type: String, default: null },   // payment.captured, order.paid, ...

    paymentId: { type: String, default: null, index: true },
    orderId:   { type: String, default: null, index: true },
    refundId:  { type: String, default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    amountInPaise: { type: Number, default: null },

    status:   { type: String, enum: Object.values(WEBHOOK_EVENT_STATUS), default: WEBHOOK_EVENT_STATUS.PROCESSING, index: true },
    outcome:  { type: String, default: null },   // machine-readable result, e.g. AUTO_CONFIRMED, REFUND_CREATED
    error:    { type: String, default: null, maxlength: 500 },

    attempts:    { type: Number, default: 1 },
    lockedAt:    { type: Date, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export default mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", WebhookEventSchema);
