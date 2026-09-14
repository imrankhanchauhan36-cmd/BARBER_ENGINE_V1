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
 * Every field here is written exactly once, server-side, inside
 * fieldAgentEarning.service.js's own transaction — no update endpoint
 * exists anywhere in this codebase for this collection.
 */

import mongoose from "mongoose";
import { EARNING_ENTITLEMENT_TYPE, EARNING_CREDIT_OUTCOME, POLICY_SOURCE } from "../constants/fieldAgentEarning.constants.js";

const integerValidator = {
  validator: Number.isInteger,
  message: "{VALUE} is not a valid integer amount (paise)",
};

const FieldAgentEarningLedgerSchema = new mongoose.Schema(
  {
    bookingRef: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, immutable: true },

    entitlementType: {
      type: String,
      enum: Object.values(EARNING_ENTITLEMENT_TYPE),
      required: true,
      immutable: true,
    },

    // The sole idempotency/concurrency authority — see file header.
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },

    fieldAgentRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgent", required: true, immutable: true },

    // Populated only for entitlementType ACQUISITION.
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

    appliedRatePercent: { type: Number, required: true, min: 0, max: 100, immutable: true },

    bookingCommissionAmountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerValidator,
      immutable: true,
    },

    rawEligibleAmountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: integerValidator,
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

    bookingCompletedAt: { type: Date, required: true, immutable: true },
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
