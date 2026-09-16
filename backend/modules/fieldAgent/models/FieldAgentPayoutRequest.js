/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentPayoutRequest.js
 *
 * FA-14 — Field Agent Payout / Withdrawal / Disbursement. A NEW,
 * standalone model — deliberately NOT a modification of
 * backend/models/PayoutRequest.js (that model is salon-specific,
 * keyed by salonId, and remains completely untouched). This file
 * mirrors its PROVEN shape (status enum, provider field, audit
 * fields, partial-unique-index idiom) without reusing its code.
 *
 * FINANCIAL ARCHITECTURE (locked V1 decision — Option A):
 * There is no continuously-credited Field Agent wallet/balance
 * document. "Available balance" is always computed on demand as
 * SUM(FieldAgentEarningLedger.creditedAmountInPaise WHERE
 * creditOutcome=CREDITED) minus SUM(amountInPaise of this agent's own
 * non-terminal FieldAgentPayoutRequest rows) — see
 * fieldAgentPayout.service.js#computeAvailableBalance. This model
 * itself never reads or writes FieldAgentEarningLedger — FA-9 remains
 * completely untouched by this file.
 *
 * bankSnapshot is captured once, at request-creation time, from the
 * Field Agent's then-current verified KYC bank data (modules/kyc/
 * models/KYC.js, read-only) — the payout preserves whatever
 * destination was actually approved for it even if the agent's KYC
 * bank details are edited afterward. Only masked/non-sensitive fields
 * are snapshotted; the encrypted account number itself is never
 * copied here (it stays in KYC.js only).
 *
 * V1 = MANUAL payout only (payoutProvider always MANUAL) — no
 * automatic/RazorpayX provider is introduced by this file.
 */

import mongoose from "mongoose";

export const FIELD_AGENT_PAYOUT_STATUS = Object.freeze({
  REQUESTED:  "REQUESTED",   // agent submitted, awaiting admin
  PROCESSING: "PROCESSING",  // admin approved, manual transfer in flight
  PAID:       "PAID",        // admin confirmed the manual transfer succeeded
  FAILED:     "FAILED",      // manual transfer attempt failed after approval
  REJECTED:   "REJECTED",    // admin declined before processing
  CANCELLED:  "CANCELLED",   // agent cancelled before admin approval
});

// Explicit transition table — same idiom as
// backend/utils/bookingState.machine.js's BOOKING_TRANSITIONS. A
// terminal status (PAID/REJECTED/CANCELLED) has an empty array, so it
// can never transition again. FAILED -> PROCESSING is the one
// explicit "admin retries a failed manual payout" path (locked V1
// rule: explicit retry allowed, no automatic retry job).
export const FIELD_AGENT_PAYOUT_TRANSITIONS = Object.freeze({
  [FIELD_AGENT_PAYOUT_STATUS.REQUESTED]: [
    FIELD_AGENT_PAYOUT_STATUS.PROCESSING,
    FIELD_AGENT_PAYOUT_STATUS.REJECTED,
    FIELD_AGENT_PAYOUT_STATUS.CANCELLED,
  ],
  [FIELD_AGENT_PAYOUT_STATUS.PROCESSING]: [
    FIELD_AGENT_PAYOUT_STATUS.PAID,
    FIELD_AGENT_PAYOUT_STATUS.FAILED,
  ],
  [FIELD_AGENT_PAYOUT_STATUS.FAILED]: [
    FIELD_AGENT_PAYOUT_STATUS.PROCESSING, // explicit admin retry only
  ],
  [FIELD_AGENT_PAYOUT_STATUS.PAID]:      [],
  [FIELD_AGENT_PAYOUT_STATUS.REJECTED]:  [],
  [FIELD_AGENT_PAYOUT_STATUS.CANCELLED]: [],
});

// Statuses that still "consume" balance — i.e. have not yet released
// their reserved amount back to the agent. Used by
// computeAvailableBalance()'s reservation sum. REQUESTED/PROCESSING
// reserve; PAID has genuinely left the earned pool (paid out); FAILED
// is deliberately still reserving — a failed manual attempt is meant
// to be explicitly retried (FAILED -> PROCESSING, see the transition
// table above), not treated as money returned to the agent, so it
// must not become spendable by a second, new withdrawal while the
// failed one is still awaiting resolution. Only REJECTED/CANCELLED
// (both genuinely terminal, never resolving to a payment) release the
// reservation back to available.
export const FIELD_AGENT_PAYOUT_RESERVING_STATUSES = Object.freeze([
  FIELD_AGENT_PAYOUT_STATUS.REQUESTED,
  FIELD_AGENT_PAYOUT_STATUS.PROCESSING,
  FIELD_AGENT_PAYOUT_STATUS.FAILED,
  FIELD_AGENT_PAYOUT_STATUS.PAID,
]);

// Statuses that count as "open" for the one-active-withdrawal DB
// constraint below — i.e. block a NEW request from being created.
// PAID is excluded (genuinely resolved, a new withdrawal is fine);
// FAILED is included for the same reason it stays in the reserving
// set above (still awaiting an explicit admin retry, not abandoned).
export const FIELD_AGENT_PAYOUT_OPEN_STATUSES = Object.freeze([
  FIELD_AGENT_PAYOUT_STATUS.REQUESTED,
  FIELD_AGENT_PAYOUT_STATUS.PROCESSING,
  FIELD_AGENT_PAYOUT_STATUS.FAILED,
]);

// FA-14 V1 = MANUAL only. The enum still exists (not a bare string
// literal) so a future phase can add a second value without a schema
// migration — but nothing in this phase ever sets or reads anything
// but MANUAL.
export const FIELD_AGENT_PAYOUT_PROVIDER = Object.freeze({
  MANUAL: "MANUAL",
});

const bankSnapshotSchema = new mongoose.Schema(
  {
    accountHolder: { type: String, default: null },
    maskedAccount: { type: String, default: null }, // e.g. "XXXX1234" — never the full/encrypted number
    ifsc:          { type: String, default: null },
    bankName:      { type: String, default: null },
  },
  { _id: false }
);

const fieldAgentPayoutRequestSchema = new mongoose.Schema(
  {
    fieldAgentRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "FieldAgent",
      required: true,
    },

    amountInPaise: {
      type:     Number,
      required: true,
      min:      1,
      validate: {
        validator: Number.isInteger,
        message:   "amountInPaise must be a whole number (paise, not rupees)",
      },
    },

    currency: {
      type:      String,
      default:   "INR",
      maxlength: 10,
    },

    status: {
      type:    String,
      enum:    Object.values(FIELD_AGENT_PAYOUT_STATUS),
      default: FIELD_AGENT_PAYOUT_STATUS.REQUESTED,
      index:   true,
      // Deliberately NOT immutable:true — same documented lesson as
      // PayoutRequest.js: an immutable path silently no-ops every
      // later status assignment once the document has saved once.
      // Transitions are gated by fieldAgentPayout.service.js's
      // explicit transition-table check instead.
    },

    payoutProvider: {
      type:    String,
      enum:    Object.values(FIELD_AGENT_PAYOUT_PROVIDER),
      default: FIELD_AGENT_PAYOUT_PROVIDER.MANUAL,
    },
    providerPayoutId: {
      type:    String,
      default: null,
    },
    utr: {
      type:    String,
      default: null,
    },
    // Raw manual-payout confirmation details, if ever needed for
    // internal debugging — NEVER exposed in any API response to the
    // agent or admin UI.
    providerResponse: {
      type:    mongoose.Schema.Types.Mixed,
      default: null,
      select:  false,
    },

    // Snapshotted once at creation from the agent's verified KYC bank
    // data — never re-read from KYC.js again after this document is
    // created, and never client-suppliable (see validator).
    bankSnapshot: {
      type:     bankSnapshotSchema,
      required: true,
    },

    failureReason: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    // ── Admin audit fields ──────────────────────────────────
    approvedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },
    approvedAt: {
      type:    Date,
      default: null,
    },
    adminNote: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    // ── Cancellation (agent-initiated, only before approval) ──
    cancelledAt: {
      type:    Date,
      default: null,
    },

    // Request-creation idempotency — see fieldAgentPayout.service.js.
    // Scoped per-agent (not globally unique) so two different agents
    // can coincidentally generate the same client-side key value
    // without colliding.
    idempotencyKey: {
      type:      String,
      required:  true,
      maxlength: 200,
    },

    // MongoDB partial indexes only support equality/$exists/comparison
    // operators and a top-level $and in partialFilterExpression — $in
    // is NOT supported, so "status is one of [REQUESTED, PROCESSING,
    // FAILED]" cannot be expressed directly as the filter for the
    // one-active-withdrawal unique index below. This plain boolean is
    // the DB-indexable proxy for FIELD_AGENT_PAYOUT_OPEN_STATUSES:
    // true while status is REQUESTED/PROCESSING/FAILED, flipped to
    // false by fieldAgentPayout.service.js in the exact same update
    // that moves status to PAID/REJECTED/CANCELLED (the three
    // genuinely terminal-for-this-purpose statuses) — never set
    // directly from a request body.
    isOpen: {
      type:    Boolean,
      default: true,
    },
  },
  { timestamps: true, versionKey: false }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// Most common admin query — list by status, newest first.
fieldAgentPayoutRequestSchema.index({ status: 1, createdAt: -1 });

// FA-14 final-audit finding (scale) — the admin's default, no-status-
// filter "view everything" list (fieldAgentPayout.service.js's
// listPayoutsForAdmin with an empty filter) sorts by createdAt alone.
// Neither compound index above has createdAt as its SOLE leading key —
// {status,createdAt} is primarily ordered by status, so an empty-filter
// query cannot use it to produce documents in true createdAt order.
// Without this index, that query degrades to a full collection scan +
// in-memory blocking sort, which at PAN-India volume can eventually
// exceed MongoDB's 32MB sort-memory limit and fail outright (not just
// run slowly) — a genuine, concrete scale problem, not a hypothetical
// one. This single-field index is the minimum fix for exactly that one
// query shape; no other index or model was touched.
fieldAgentPayoutRequestSchema.index({ createdAt: -1 });

// Agent's own "my withdrawals" history query.
fieldAgentPayoutRequestSchema.index({ fieldAgentRef: 1, status: 1, createdAt: -1 });

// DB-LEVEL SAFETY NET (locked V1 rule) — an agent cannot have two open
// (REQUESTED/PROCESSING/FAILED-awaiting-retry) withdrawals at the same
// time, even under a race or a bypassed controller path. Mirrors
// PayoutRequest.js's own proven partialFilterExpression idiom, but
// keyed on the plain `isOpen` boolean above rather than a $in on
// status — MongoDB partial indexes only support equality/$exists/
// comparison operators (and top-level $and), not $in, in
// partialFilterExpression.
fieldAgentPayoutRequestSchema.index(
  { fieldAgentRef: 1 },
  {
    unique: true,
    partialFilterExpression: { isOpen: true },
  }
);

// Request-creation idempotency — one request per (agent, idempotency
// key) pair; scoped per-agent per the field's own comment above.
fieldAgentPayoutRequestSchema.index(
  { fieldAgentRef: 1, idempotencyKey: 1 },
  { unique: true }
);

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.FieldAgentPayoutRequest ||
  mongoose.model("FieldAgentPayoutRequest", fieldAgentPayoutRequestSchema);
