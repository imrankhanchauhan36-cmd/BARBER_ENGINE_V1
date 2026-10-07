import mongoose from "mongoose";

// FINANCE-P0-1 — same immutable bank-snapshot shape as
// modules/payout/models/GenericPayoutRequest.js's own bankSnapshotSchema.
// Structurally required for Razorpay Route dispatch: PayoutProvider's
// resolveDispatchDestinationForEntity() cross-checks live KYC bank data
// against exactly this snapshot before ever sending money, and fails
// safe (returns null, no dispatch) if no snapshot is present — so this
// is additive-but-necessary for the RAZORPAY_ROUTE provider path to be
// functional, not merely decorative. Unused/null for the MANUAL
// provider (unchanged behavior).
const bankSnapshotSchema = new mongoose.Schema(
  {
    accountHolder: { type: String, default: null, immutable: true },
    maskedAccount: { type: String, default: null, immutable: true },
    ifsc:          { type: String, default: null, immutable: true },
    bankName:      { type: String, default: null, immutable: true },
  },
  { _id: false }
);

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
  REQUESTED:  "REQUESTED",   // owner submitted, funds LOCKED, awaiting admin decision
  // FINANCE-P0-1 — NEW. Admin has approved but gateway dispatch has not
  // yet completed (or, for the MANUAL provider, this is a transient
  // internal state the request passes through within the same approve
  // call — see adminPayout.controller.js#approvePayout). Funds remain
  // LOCKED here, never PROCESSING, until dispatch actually runs — see
  // this file's own header for why this state must exist and be durable
  // (crash-safety: a server crash after this commits but before gateway
  // dispatch leaves the payout safely recoverable from exactly here).
  APPROVED:   "APPROVED",
  PROCESSING: "PROCESSING",  // gateway dispatch in flight (manual settlement or Razorpay Route)
  PAID:       "PAID",        // confirmed successful
  FAILED:     "FAILED",      // gateway/manual transfer failed after approval
  REJECTED:   "REJECTED",    // admin declined before processing
  CANCELLED:  "CANCELLED",   // owner cancelled before admin approval
};

// FA-P4-B Step 2 — statuses in which a payout still holds funds / is
// in flight, i.e. "the owner already has an open withdrawal". Used by
// both the DB-level unique index below and the controller's own
// pre-check so the two can never drift. FAILED is deliberately NOT
// open: WalletBalanceService.failPayout returns the money to AVAILABLE,
// so a failed payout no longer blocks a new request.
//
// FINANCE-P0-1 — widened to include APPROVED: once admin has approved
// a payout, funds are still LOCKED and no second request may be opened
// for this salon until this one reaches a terminal state (PAID/FAILED/
// REJECTED/CANCELLED).
export const OPEN_PAYOUT_STATUSES = [
  PAYOUT_STATUS.REQUESTED,
  PAYOUT_STATUS.APPROVED,
  PAYOUT_STATUS.PROCESSING,
];

export const PAYOUT_PROVIDER = {
  MANUAL:    "MANUAL",     // admin transfers by hand, enters UTR themselves
  // Deliberately NEVER registered in PayoutProviderResolver — see that
  // file's own header. Resolving this throws loudly rather than
  // silently falling back to ManualProvider. Left in place, unused,
  // not activated by FINANCE-P0-1 — the ticket's own explicit
  // instruction ("Do NOT activate the intentionally blocked RAZORPAYX
  // provider path from System A").
  RAZORPAYX: "RAZORPAYX",
  // FINANCE-P0-1 — the real, live gateway path, merged in from
  // GenericPayoutRequest (modules/payout/). Same string
  // ("RAZORPAY_ROUTE") already registered in PayoutProviderResolver
  // against the real RazorpayXPayoutProvider — no resolver change
  // needed, it already resolves this value.
  RAZORPAY_ROUTE: "RAZORPAY_ROUTE",
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
    // FINANCE-P0-1 — merged in from GenericPayoutRequest's own Razorpay
    // Route dispatch tracking. Additive only; null/unused for the
    // MANUAL provider, exactly as on that model.
    providerContactId: { type: String, default: null },
    providerFundAccountId: { type: String, default: null },
    // Last raw status string reported by Razorpay (e.g. "processing",
    // "processed") — informational only, never the source of truth for
    // `status` above. Same field/convention as GenericPayoutRequest.
    providerStatus: { type: String, default: null },
    // FINANCE-P0-1 — optional, captured only when a dispatch via
    // RAZORPAY_ROUTE is possible; null/unused for MANUAL. See schema
    // header comment above for why this is required for that path.
    bankSnapshot: {
      type: bankSnapshotSchema,
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
    // FINANCE-P0-1 — when APPROVED moved to PROCESSING (gateway dispatch
    // began). Null for a MANUAL-provider payout that settles within the
    // same approve call. Purely informational/audit — no code branches
    // on this field.
    processingAt: {
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

// Plain lookup index — history/list queries filter by salonId alone.
PayoutRequestSchema.index({ salonId: 1 });

// ✅ DB-LEVEL SAFETY NET: a salon cannot have two OPEN withdrawals
// at the same time. This is enforced in the controller too, but a
// partial unique index means even a race condition or a bypassed
// controller path cannot create a duplicate open request.
//
// FA-P4-B Step 2 — two fixes to the previous definition:
//  1. It covered only REQUESTED, so a PROCESSING payout (an async
//     provider leaves one in flight) no longer blocked a second
//     request. It now covers every OPEN_PAYOUT_STATUSES value.
//  2. It was declared as an unnamed { salonId: 1 } unique index, which
//     Mongo names "salonId_1" — the same name as the plain lookup
//     index, so the two collided and the unique one was never actually
//     built in the database. It now has its own explicit name.
//
// FINANCE-P0-1 — the partialFilterExpression now reflects the widened
// OPEN_PAYOUT_STATUSES (adds APPROVED) automatically, since it reads
// that constant directly. DEPLOYMENT NOTE (not performed by this
// change, since the live collection has 0 documents today — see the
// FINANCE-P0-1 implementation report): an index with this same name
// already exists in production with the OLD filter; the live database
// will need this index dropped and rebuilt on deploy (safe and
// instant on an empty collection) — no index mutation was run against
// the live database as part of this implementation.
PayoutRequestSchema.index(
  { salonId: 1 },
  {
    name: "salonId_open_unique",
    unique: true,
    partialFilterExpression: { status: { $in: OPEN_PAYOUT_STATUSES } },
  }
);

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.PayoutRequest ||
  mongoose.model("PayoutRequest", PayoutRequestSchema);