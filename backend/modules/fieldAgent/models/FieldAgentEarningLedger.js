/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentEarningLedger.js
 *
 * FA-9 — the single, immutable, append-only source of truth for every
 * Field Agent earning outcome (credited or zero). Mirrors WalletLedger's
 * own proven append-only discipline exactly (schema-level mutation
 * block below, not just convention) — but this is a NEW, separate
 * collection: Field Agent commission is never written into Salon's
 * WalletLedger, which is a different financial domain (salon payouts,
 * not field-agent commission).
 *
 * idempotencyKey = `earning:${bookingRef}:${entitlementType}` is the
 * true concurrency authority (unique index below) — at most one row
 * can ever exist per (booking, entitlementType) pair, regardless of
 * duplicate workers, retries, or replayed batches (FA-9 Issue 1/3
 * corrections).
 *
 * FA-9 Phase A — entitlementType ACQUISITION_REWARD is the one
 * exception to the "per booking" framing above: it is a one-time,
 * claim-keyed row (never produced by a completed Booking), so its
 * idempotencyKey is instead `earning:${acquisitionClaimRef}:ACQUISITION_REWARD`
 * (still unique, still the sole concurrency authority — just keyed by
 * claim instead of booking). See the booking-shaped fields below for
 * which ones this row leaves unpopulated.
 *
 * Every field here is written exactly once, server-side, inside
 * fieldAgentEarning.service.js's own transaction (or, for
 * ACQUISITION_REWARD, acquisitionClaim.service.js#adminApproveClaim's
 * own transaction) — no update endpoint exists anywhere in this
 * codebase for this collection.
 */

import mongoose from "mongoose";
import { EARNING_ENTITLEMENT_TYPE, EARNING_CREDIT_OUTCOME, POLICY_SOURCE } from "../constants/fieldAgentEarning.constants.js";

const integerValidator = {
  validator: Number.isInteger,
  message: "{VALUE} is not a valid integer amount (paise)",
};

// FA-9 Phase A — same rule, but tolerant of the explicit `null` that
// bookingCommissionAmountInPaise/rawEligibleAmountInPaise now carry
// for a non-booking-keyed ACQUISITION_REWARD row (Mongoose still runs
// a custom `validate` function against an explicit null default, even
// when `required` is false for that document — only `required` itself
// is skipped).
const nullableIntegerValidator = {
  validator: (v) => v === null || Number.isInteger(v),
  message: "{VALUE} is not a valid integer amount (paise)",
};

// FA-9 Phase A — true for every entitlementType except the new,
// non-booking-keyed ACQUISITION_REWARD. Used below to make the
// booking-shaped fields conditionally required WITHOUT weakening them
// for the two pre-existing, booking-keyed entitlement types. Safe as a
// schema-level `this`-based validator here specifically because this
// collection is only ever written via `.create()` (see file header) —
// never via `findOneAndUpdate`, which is the unreliable-`this` case the
// AREA-2.4.1 lesson (CommercialPolicyOverride.js) warns against.
const isBookingKeyedEntitlement = function () {
  return this.entitlementType !== EARNING_ENTITLEMENT_TYPE.ACQUISITION_REWARD;
};

const FieldAgentEarningLedgerSchema = new mongoose.Schema(
  {
    // Required for ACQUISITION/TERRITORY_PARTNER rows; left null for
    // ACQUISITION_REWARD (claim-keyed, not booking-keyed — see header).
    bookingRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: isBookingKeyedEntitlement,
      default: null,
      immutable: true,
    },

    entitlementType: {
      type: String,
      enum: Object.values(EARNING_ENTITLEMENT_TYPE),
      required: true,
      immutable: true,
    },

    // The sole idempotency/concurrency authority — see file header.
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },

    fieldAgentRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgent", required: true, immutable: true },

    // Populated for entitlementType ACQUISITION (per-booking credit
    // against the cumulative cap) AND ACQUISITION_REWARD (the one-time
    // reward row — this is in fact its sole claim linkage, since it has
    // no bookingRef).
    acquisitionClaimRef: { type: mongoose.Schema.Types.ObjectId, ref: "AcquisitionClaim", default: null, immutable: true },

    // Populated only for entitlementType TERRITORY_PARTNER.
    territoryAssignmentRef: { type: mongoose.Schema.Types.ObjectId, ref: "TerritoryAssignment", default: null, immutable: true },

    policySource: {
      type: String,
      enum: Object.values(POLICY_SOURCE),
      required: true,
      immutable: true,
    },

    // Points into CommercialPolicyVersion (NATIONAL) or
    // CommercialPolicyOverride (AREA_OVERRIDE) depending on
    // policySource — a bare ObjectId + discriminator, not a Mongoose
    // polymorphic ref (mirrors FraudSignal's own proven idiom).
    policyVersionRef: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },

    // Required for ACQUISITION/TERRITORY_PARTNER rows (the % actually
    // applied to a booking); left null for ACQUISITION_REWARD, which is
    // a fixed amount, not a rate applied to anything.
    appliedRatePercent: { type: Number, required: isBookingKeyedEntitlement, default: null, min: 0, max: 100, immutable: true },

    // Required for ACQUISITION/TERRITORY_PARTNER rows; left null for
    // ACQUISITION_REWARD (no booking commission is involved).
    bookingCommissionAmountInPaise: {
      type: Number,
      required: isBookingKeyedEntitlement,
      default: null,
      min: 0,
      validate: nullableIntegerValidator,
      immutable: true,
    },

    // Required for ACQUISITION/TERRITORY_PARTNER rows; left null for
    // ACQUISITION_REWARD (no raw booking-derived amount to cap against).
    rawEligibleAmountInPaise: {
      type: Number,
      required: isBookingKeyedEntitlement,
      default: null,
      min: 0,
      validate: nullableIntegerValidator,
      immutable: true,
    },

    creditedAmountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerValidator,
      immutable: true,
    },

    creditOutcome: {
      type: String,
      enum: Object.values(EARNING_CREDIT_OUTCOME),
      required: true,
      immutable: true,
    },

    // Required for ACQUISITION/TERRITORY_PARTNER rows; left null for
    // ACQUISITION_REWARD (no booking is involved — createdAt is this
    // row's only timestamp).
    bookingCompletedAt: { type: Date, required: isBookingKeyedEntitlement, default: null, immutable: true },
  },
  { timestamps: true, versionKey: false }
);

// idempotencyKey's unique index is declared inline on the field above
// (unique: true) — no separate .index() call here, avoiding a
// duplicate-index declaration (same idiom as WalletLedger.js's own
// idempotencyKey field).
FieldAgentEarningLedgerSchema.index({ fieldAgentRef: 1, createdAt: -1 });
FieldAgentEarningLedgerSchema.index({ acquisitionClaimRef: 1, createdAt: -1 }, { sparse: true });
FieldAgentEarningLedgerSchema.index({ bookingRef: 1 });

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE APPEND-ONLY AT THE SCHEMA LEVEL — same idiom as
// WalletLedger.js. Corrections happen via a future, separate
// reversal mechanism (explicitly out of scope for FA-9 V1), never by
// editing history.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("FieldAgentEarningLedger entries are immutable — they cannot be updated or deleted.");
};
FieldAgentEarningLedgerSchema.pre("updateOne", blockMutation);
FieldAgentEarningLedgerSchema.pre("updateMany", blockMutation);
FieldAgentEarningLedgerSchema.pre("findOneAndUpdate", blockMutation);
FieldAgentEarningLedgerSchema.pre("deleteOne", blockMutation);
FieldAgentEarningLedgerSchema.pre("deleteMany", blockMutation);
FieldAgentEarningLedgerSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.FieldAgentEarningLedger ||
  mongoose.model("FieldAgentEarningLedger", FieldAgentEarningLedgerSchema);
