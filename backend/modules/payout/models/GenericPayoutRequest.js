/**
 * BARBER ENGINE V1
 * backend/modules/payout/models/GenericPayoutRequest.js
 *
 * STEP 6.3 — Generic PayoutRequest Engine. ONE model supporting all
 * three wallet-owner kinds STEP 6.2 already unified: SALON,
 * ACQUISITION_AGENT, TERRITORY_PARTNER — keyed by {entityType,
 * entityId}, the exact same convention SalonEarnings/WalletLedger
 * already use (no new naming scheme invented).
 *
 * DELIBERATELY A NEW, SEPARATE MODEL/COLLECTION — not a modification
 * of models/PayoutRequest.js (SALON-only, "Phase 7 — 10/10 FROZEN",
 * a live real-money schema its own controller already depends on
 * exactly as shaped today) and not of FieldAgentPayoutRequest.js
 * (FIELD_AGENT-only). Mongoose model name is GenericPayoutRequest
 * (not "PayoutRequest") specifically to avoid any model-registry
 * collision with the existing, untouched PayoutRequest model.
 *
 * SCOPE (LOCKED, per the ticket): this step only ever creates
 * REQUESTED rows and moves AVAILABLE→LOCKED on the entity's wallet in
 * the same transaction. No admin-approval endpoint, no
 * PROCESSING/PAID transition, no Razorpay Route call exists anywhere
 * in this module yet — see GenericPayoutRequestService.js's own header.
 *
 * bankSnapshot is IMMUTABLE (ticket's own explicit requirement) —
 * captured once, at request-creation time, from the entity's
 * resolved, verified KYC bank data (see payoutKycResolver.service.js,
 * read-only) — never re-read from KYC afterward, and every field is
 * schema-level immutable so a later edit attempt is a silent no-op at
 * best and should never be relied upon; PATCH-style mutation of this
 * document is not exposed by this step at all.
 */

import mongoose from "mongoose";
import { PAYOUT_ENTITY_TYPE, GENERIC_PAYOUT_STATUS, GENERIC_PAYOUT_PROVIDER } from "../constants/genericPayoutRequest.constants.js";

const bankSnapshotSchema = new mongoose.Schema(
  {
    accountHolder: { type: String, default: null, immutable: true },
    maskedAccount: { type: String, default: null, immutable: true }, // e.g. "XXXX1234" — never the full/encrypted number
    ifsc:          { type: String, default: null, immutable: true },
    bankName:      { type: String, default: null, immutable: true },
  },
  { _id: false }
);

const genericPayoutRequestSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: Object.values(PAYOUT_ENTITY_TYPE),
      required: true,
      immutable: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },

    amountInPaise: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator: Number.isInteger,
        message: "amountInPaise must be a whole number (paise, not rupees)",
      },
    },

    currency: {
      type: String,
      default: "INR",
      maxlength: 10,
    },

    status: {
      type: String,
      enum: Object.values(GENERIC_PAYOUT_STATUS),
      default: GENERIC_PAYOUT_STATUS.REQUESTED,
      index: true,
      // Deliberately NOT immutable:true — same documented lesson as
      // PayoutRequest.js / FieldAgentPayoutRequest.js: an immutable
      // path silently no-ops every later status assignment once the
      // document has saved once. This step never transitions status
      // itself, but the field must remain writable for a future step.
    },

    payoutProvider: {
      type: String,
      enum: Object.values(GENERIC_PAYOUT_PROVIDER),
      default: GENERIC_PAYOUT_PROVIDER.MANUAL,
    },

    // Snapshotted once at creation from the resolved, verified KYC
    // bank record — see file header. Required: a request can never be
    // created without one (payoutKycResolver.service.js throws first).
    bankSnapshot: {
      type: bankSnapshotSchema,
      required: true,
    },

    // STEP 6.4 — Razorpay Route dispatch tracking. Additive only —
    // bankSnapshot above stays untouched/immutable. Mirrors
    // FieldAgentPayoutRequest's own equivalent fields exactly. None of
    // these are ever client-suppliable; only genericPayoutDispatch.
    // service.js writes them.
    providerContactId: { type: String, default: null },
    providerFundAccountId: { type: String, default: null },
    providerPayoutId: { type: String, default: null },
    // Last raw status string reported by Razorpay (e.g. "processing",
    // "processed") — informational only, never the source of truth for
    // `status` above.
    providerStatus: { type: String, default: null },
    utr: { type: String, default: null },
    failureReason: { type: String, default: null, maxlength: 500 },
    // Raw gateway response — internal debugging only. NEVER expose this
    // in any API response, same rule as PayoutRequest.js/
    // FieldAgentPayoutRequest.js's own identical field.
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    // True once a FAILED payout's funds were returned to AVAILABLE
    // (WalletBalanceService.failPayout already ran) — mirrors
    // FieldAgentPayoutRequest.fundsReleased exactly.
    fundsReleased: { type: Boolean, default: false },

    // Request-creation idempotency — scoped per (entityType, entityId)
    // pair, mirroring FieldAgentPayoutRequest's own per-agent scoping
    // exactly (two different entities coincidentally generating the
    // same client-side key value must never collide).
    idempotencyKey: {
      type: String,
      required: true,
      maxlength: 200,
      immutable: true,
    },

    // DB-indexable proxy for "is this request still open" — MongoDB
    // partial indexes only support equality/$exists/comparison
    // operators (and a top-level $and), not $in, so this boolean is
    // the same workaround FieldAgentPayoutRequest.js's own header
    // documents. true while REQUESTED/PROCESSING; a future step flips
    // it to false in the same update that moves status to a terminal
    // value — never set directly from a request body.
    isOpen: {
      type: Boolean,
      default: true,
    },

    triggeredBy: {
      type: String,
      enum: ["OWNER", "FIELD_AGENT", "SYSTEM"],
      default: "SYSTEM",
    },
    triggeredById: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// "My withdrawals" history query, per entity.
genericPayoutRequestSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

// Admin-style listing (reserved for a future step — no admin surface
// exists yet in this module).
genericPayoutRequestSchema.index({ status: 1, createdAt: -1 });

// DB-LEVEL SAFETY NET (ticket's own explicit requirement) — "one open
// payout request per entity", even under a race or a bypassed service
// call. Direct generalization of PayoutRequest.js's own
// salonId_open_unique idiom to {entityType, entityId}.
genericPayoutRequestSchema.index(
  { entityType: 1, entityId: 1 },
  {
    name: "entity_open_unique",
    unique: true,
    partialFilterExpression: { isOpen: true },
  }
);

// Request-creation idempotency — one request per (entity, idempotency
// key) pair.
genericPayoutRequestSchema.index(
  { entityType: 1, entityId: 1, idempotencyKey: 1 },
  { unique: true }
);

export default mongoose.models.GenericPayoutRequest ||
  mongoose.model("GenericPayoutRequest", genericPayoutRequestSchema);
