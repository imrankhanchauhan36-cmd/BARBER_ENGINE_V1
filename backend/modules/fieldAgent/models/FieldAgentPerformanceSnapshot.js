/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentPerformanceSnapshot.js
 *
 * FA-11.1 — one immutable, decomposed evidence record per Field Agent
 * per computation cycle. Deliberately NOT a rating/score document —
 * every field is individually traceable to its authoritative source
 * (AcquisitionClaim, AcquisitionEarningProgress,
 * FieldAgentEarningLedger, TerritoryAssignment,
 * TerritoryPartnerTermSnapshot, KYC, FieldAgentTraining, TestAttempt,
 * User, FraudSignal, FieldAgentAuditEvent). FA-11.1 defines the shape
 * only — the aggregation that fills these fields is FA-11.2 scope.
 *
 * Three explicitly separated buckets, per the FA-11 business decision
 * lock ("do not mix rolling and lifetime values"):
 *   - rollingWindow: activity within the policy's configured window
 *     (e.g. last 90 days) as of computedAt.
 *   - lifetime: cumulative-since-the-beginning facts.
 *   - currentState: point-in-time status (KYC/training/test/account/
 *     operational/term/active-claim state) — neither a window count
 *     nor a cumulative count, so it gets its own bucket rather than
 *     being miscategorized into either of the above.
 *
 * Historical correctness (locked): rollingWindowDays and
 * policyVersionRef are captured on the snapshot itself, so a LATER
 * PerformancePolicyVersion change (e.g. window changed from 90 to 60
 * days) can never silently reinterpret what an already-computed
 * snapshot meant. commercialPath is also denormalized at computation
 * time for the same reason.
 *
 * Idempotency (locked): exactly one snapshot per (fieldAgentRef,
 * cycleKey) — enforced by a unique index, not application logic.
 * cycleKey is a caller-supplied deterministic identifier for the
 * computation cycle (e.g. the job run's own date-based key); this
 * model does not compute or interpret it.
 *
 * Immutability (locked): mirrors FieldAgentEarningLedger's own
 * blockMutation pre-hook set exactly — the strongest, previously
 * proven-effective pattern in this codebase for "no update, no
 * delete, ever," rather than the weaker per-field `immutable: true`
 * idiom.
 */

import mongoose from "mongoose";
import {
  SUPPORT_RELATIONSHIP_EVIDENCE_UNAVAILABLE_MESSAGE,
  COMPLAINT_EVIDENCE_UNAVAILABLE_MESSAGE,
} from "../constants/performance.constants.js";

const territoryAssignmentHistoryEntrySchema = new mongoose.Schema(
  {
    territoryAssignmentRef: { type: mongoose.Schema.Types.ObjectId, ref: "TerritoryAssignment", required: true },
    territoryRef: { type: mongoose.Schema.Types.ObjectId, ref: "CommercialTerritory", required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveUntil: { type: Date, default: null },
    endReason: { type: String, default: null },
  },
  { _id: false }
);

const rollingWindowSchema = new mongoose.Schema(
  {
    claimsIssuedCount: { type: Number, required: true, min: 0 },
    acquisitionCreditedBookingCount: { type: Number, required: true, min: 0 },
    acquisitionCreditedAmountInPaise: { type: Number, required: true, min: 0 },
    territoryCreditedBookingCount: { type: Number, required: true, min: 0 },
    territoryCreditedAmountInPaise: { type: Number, required: true, min: 0 },
    fraudSignalCounts: { type: Map, of: Number, default: () => new Map() },
    adminActionCount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const lifetimeSchema = new mongoose.Schema(
  {
    salonsAcquiredCount: { type: Number, required: true, min: 0 },
    targetCompletionCount: { type: Number, required: true, min: 0 },
    // Nullable by design (locked business rule): undefined rate (zero
    // eligible progress records) is represented as null, never a
    // fabricated 0 — `required: true` would reject that explicit null,
    // so this field is intentionally NOT required.
    targetCompletionRate: { type: Number, default: null, min: 0, max: 1 },
    territoryTenureDays: { type: Number, default: null, min: 0 },
    territoryAssignmentHistory: { type: [territoryAssignmentHistoryEntrySchema], default: () => [] },
  },
  { _id: false }
);

const currentStateSchema = new mongoose.Schema(
  {
    claimsActiveCount: { type: Number, required: true, min: 0 },
    termStatus: {
      daysRemaining: { type: Number, default: null },
      expired: { type: Boolean, default: null },
    },
    kycStatus: { type: String, default: null },
    trainingStatus: { type: String, default: null },
    testStatus: { type: String, default: null },
    accountStatus: { type: String, default: null },
    operationalStatus: { type: String, default: null },
  },
  { _id: false }
);

const unavailableSchema = new mongoose.Schema(
  {
    supportRelationshipEvidence: { type: String, default: SUPPORT_RELATIONSHIP_EVIDENCE_UNAVAILABLE_MESSAGE, immutable: true },
    complaintEvidence: { type: String, default: COMPLAINT_EVIDENCE_UNAVAILABLE_MESSAGE, immutable: true },
  },
  { _id: false }
);

const fieldAgentPerformanceSnapshotSchema = new mongoose.Schema(
  {
    fieldAgentRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgent", required: true, immutable: true },

    // Denormalized at computation time — historical correctness if
    // commercialPath were ever to change after this snapshot exists.
    commercialPath: { type: String, required: true, immutable: true },

    // Caller-supplied deterministic idempotency key for the
    // computation cycle (e.g. a date-based key). Opaque to this model.
    cycleKey: { type: String, required: true, immutable: true },

    policyVersionRef: { type: mongoose.Schema.Types.ObjectId, ref: "PerformancePolicyVersion", required: true, immutable: true },
    computedAt: { type: Date, required: true, immutable: true },

    // Denormalized copy of the policy's window AT COMPUTATION TIME —
    // a later policy change must never reinterpret this snapshot.
    rollingWindowDays: { type: Number, required: true, immutable: true },

    rollingWindow: { type: rollingWindowSchema, required: true },
    lifetime: { type: lifetimeSchema, required: true },
    currentState: { type: currentStateSchema, required: true },
    unavailable: { type: unavailableSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Idempotency — exactly one snapshot per agent per computation cycle.
fieldAgentPerformanceSnapshotSchema.index({ fieldAgentRef: 1, cycleKey: 1 }, { unique: true });

// Scale lock — the one lookup index this milestone is authorized to
// add: "read the latest/history of snapshots for one agent" without
// an unbounded scan.
fieldAgentPerformanceSnapshotSchema.index({ fieldAgentRef: 1, computedAt: -1 });

//////////////////////////////////////////////////////////////
// Immutable — a snapshot is a historical fact, never corrected in
// place. A wrong computation is fixed by computing a new cycle, never
// by editing an old one. Mirrors FieldAgentEarningLedger's own
// editing-history guard exactly.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("FieldAgentPerformanceSnapshot entries are immutable — they cannot be updated or deleted.");
};
fieldAgentPerformanceSnapshotSchema.pre("updateOne", blockMutation);
fieldAgentPerformanceSnapshotSchema.pre("updateMany", blockMutation);
fieldAgentPerformanceSnapshotSchema.pre("findOneAndUpdate", blockMutation);
fieldAgentPerformanceSnapshotSchema.pre("deleteOne", blockMutation);
fieldAgentPerformanceSnapshotSchema.pre("deleteMany", blockMutation);
fieldAgentPerformanceSnapshotSchema.pre("findOneAndDelete", blockMutation);

export default mongoose.models.FieldAgentPerformanceSnapshot ||
  mongoose.model("FieldAgentPerformanceSnapshot", fieldAgentPerformanceSnapshotSchema);
