import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// REFUND — persistent record of every refund sent to (or seen at) the
// payment gateway (Razorpay P0-C).
//
// One document per gateway refund. A payment can have several (partial
// refunds); the unique idempotencyKey is what makes a repeated request for
// "the same" refund a safe no-op. The gateway's own state (refundId, status)
// is stored next to ours and completed by the refund.processed /
// refund.failed webhooks.
//
// This is the GATEWAY-side refund record. It does not touch the salon wallet
// or ledger, and it is separate from WalletTransaction REFUND rows (refunds
// credited to the customer's in-app wallet).
//////////////////////////////////////////////////////////////

export const REFUND_PROVIDER = Object.freeze({ RAZORPAY: "RAZORPAY" });

export const REFUND_STATUS = Object.freeze({
  CREATING:  "CREATING",   // row written, gateway call not yet confirmed (a crash here is reconciled by refundRef)
  PENDING:   "PENDING",    // gateway accepted; not yet processed
  PROCESSED: "PROCESSED",  // gateway confirmed the money is on its way back
  FAILED:    "FAILED",     // gateway rejected / refund failed; a retry with the same key re-issues it
});

export const REFUND_REASON = Object.freeze({
  HOLD_EXPIRED:        "HOLD_EXPIRED",
  SLOT_TAKEN:          "SLOT_TAKEN",
  BOOKING_NOT_PAYABLE: "BOOKING_NOT_PAYABLE",
  ORDER_NOT_CURRENT:   "ORDER_NOT_CURRENT",
  BOOKING_CANCELLED:   "BOOKING_CANCELLED",
  EXTERNAL:            "EXTERNAL",   // created at the gateway outside this system (e.g. Razorpay dashboard)
});

const RefundSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: Object.values(REFUND_PROVIDER), default: REFUND_PROVIDER.RAZORPAY },

    paymentId: { type: String, required: true, index: true },
    orderId:   { type: String, default: null, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    amountInPaise:        { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: "amountInPaise must be a whole number (paise)" } },
    paymentAmountInPaise: { type: Number, required: true, min: 1 }, // the captured payment this refund is drawn from
    isFull:               { type: Boolean, default: false },         // true when this refund brings the payment to fully refunded
    currency:             { type: String, default: "INR", maxlength: 10 },

    reason: { type: String, default: null, maxlength: 100 },
    initiatedBy: {
      type: { type: String, enum: ["SYSTEM", "ADMIN", "USER", "EXTERNAL"], default: "SYSTEM" },
      id:   { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    // Caller-chosen deterministic key, e.g. `auto:<paymentId>` or
    // `booking-refund:<bookingId>` — one refund per key, ever.
    idempotencyKey: { type: String, required: true },

    razorpayRefundId: { type: String, default: null },  // rfnd_…
    refundStatus:     { type: String, enum: Object.values(REFUND_STATUS), default: REFUND_STATUS.CREATING, index: true },
    gatewayStatus:    { type: String, default: null },  // raw Razorpay status: pending | processed | failed

    failureReason: { type: String, default: null, maxlength: 500 },
    attempts:      { type: Number, default: 0 },
    processedAt:   { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

RefundSchema.index({ idempotencyKey: 1 }, { unique: true });
RefundSchema.index({ razorpayRefundId: 1 }, { unique: true, partialFilterExpression: { razorpayRefundId: { $type: "string" } } });

export default mongoose.models.Refund || mongoose.model("Refund", RefundSchema);
