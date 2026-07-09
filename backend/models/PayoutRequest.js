import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 STATUS — expanded from the original 3-state enum
//
// v2 — FIX: removed `immutable: true` from status. That option
// was the root cause of a critical bug: Mongoose's immutable
// setter silently no-ops any change to the field once the
// document is no longer "new" (i.e. after its first save, which
// happens immediately at creation since `status` has a default
// value). Every later `payout.status = "PAID"` assignment was
// being dropped — the document was permanently stuck at
// "REQUESTED" no matter what the controller did, while still
// returning success:true. Combined with the (separately fixed)
// wallet.balance field-name bug, this meant payouts could be
// re-approved infinitely since the REQUESTED guard never
// actually changed state in the database.
//
// The original intent — "once PAID/REJECTED, don't let anything
// change it again" — is enforced correctly in the controller via
// `if (payout.status !== "REQUESTED") return 409/400`, which is
// the actual, working guard. The schema-level immutable flag was
// redundant with that check AND broke the very transition the
// check is meant to gate.
//////////////////////////////////////////////////////////////

export const PAYOUT_STATUS = {
  REQUESTED:  "REQUESTED",   // owner submitted, awaiting admin
  PROCESSING: "PROCESSING",  // admin approved, payout in flight (manual transfer or gateway)
  PAID:       "PAID",        // confirmed successful
  FAILED:     "FAILED",      // gateway/manual transfer failed after approval
  REJECTED:   "REJECTED",    // admin declined before processing
  CANCELLED:  "CANCELLED",   // owner cancelled before admin approval
};

export const PAYOUT_PROVIDER = {
  MANUAL:    "MANUAL",     // admin transfers by hand, enters UTR themselves
  RAZORPAYX: "RAZORPAYX",  // automatic — Razorpay Payouts API
};

const PayoutRequestSchema = new mongoose.Schema(
  {
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
    },

    amountInPaise: {
      type:     Number,
      required: true,
      min:      1,
    },

    currency: {
      type:      String,
      default:   "INR",
      maxlength: 10,
    },

    status: {
      type:    String,
      enum:    Object.values(PAYOUT_STATUS),
      default: PAYOUT_STATUS.REQUESTED,
      index:   true,
      // ✅ immutable REMOVED — see comment above. State transitions
      // are gated by controller logic, not by locking the schema path.
    },

    // ── Provider layer (manual today, RazorpayX tomorrow — no
    // controller rewrite needed when that switch happens) ──────
    payoutProvider: {
      type:    String,
      enum:    Object.values(PAYOUT_PROVIDER),
      default: PAYOUT_PROVIDER.MANUAL,
    },
    providerPayoutId: {
      type:    String,
      default: null,
    },
    utr: {
      type:    String,
      default: null,
    },
    // Raw gateway/webhook response — for internal debugging only.
    // NEVER expose this in any API response to owner or admin UI.
    providerResponse: {
      type:    mongoose.Schema.Types.Mixed,
      default: null,
      select:  false,
    },

    failureReason: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    // ── Admin audit fields ──────────────────────────────────
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    adminNote: {
      type: String,
      default: null,
    },

    // ── Cancellation (owner-initiated, only before approval) ──
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// Most common admin query — list by status, newest first
PayoutRequestSchema.index({ status: 1, createdAt: -1 });

// ✅ DB-LEVEL SAFETY NET: a salon cannot have two REQUESTED
// withdrawals open at the same time. This is enforced in the
// controller too, but a partial unique index means even a race
// condition or a bypassed controller path cannot create a
// duplicate open request.
PayoutRequestSchema.index(
  { salonId: 1 },
  { unique: true, partialFilterExpression: { status: PAYOUT_STATUS.REQUESTED } }
);

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.PayoutRequest ||
  mongoose.model("PayoutRequest", PayoutRequestSchema);