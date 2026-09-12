/**
 * BARBER ENGINE V1
 * backend/modules/kyc/models/FieldAgentKycSyncEvent.js
 * Field Agent KYC -> FA-2 Application Lifecycle Sync — Outbox Event — FA-3.2 Consistency Layer
 *
 * Persistent transactional outbox, same architecture family as
 * models/RatingEvent.js (Rating & Review Engine Phase 2): no external
 * queue infrastructure — a MongoDB-backed, distributed-safe,
 * database-claimed outbox instead. Consumed by
 * modules/kyc/jobs/fieldAgentKycSync.job.js.
 *
 * WHY THIS EXISTS: three FieldAgentApplication transitions (first KYC
 * touch, admin approval, admin rejection) each chain after a FROZEN
 * KYC-side transaction (getOrCreateKYC/approveKYC/rejectKYC) that
 * cannot be modified to share a session. Writing a durable event here
 * — instead of mutating FieldAgentApplication directly in the request
 * path — means a crash between the frozen commit and this write is
 * always recoverable (via the reconciliation half of the same job,
 * using durable VerificationLog evidence), and the actual application
 * mutation always goes through FA-2's own setApplicationStatus/
 * assertValidTransition, never bypassed.
 *
 * EVENT IDENTITY (two different shapes, by design):
 *
 *   FIRST_TOUCH_TO_KYC_PENDING — identity is { kycRef, transitionType }.
 *   A given KYC record is created exactly once, ever (enforced by the
 *   frozen getOrCreateKYC's own create-once logic + KYC.ownerId's
 *   unique index), so there is only ever one KYC_INITIATED decision
 *   per KYC record — no sourceLogId needed for uniqueness.
 *
 *   APPROVAL_TO_TRAINING_PENDING / REJECTION_TO_KYC_REJECTED — identity
 *   is sourceLogId ALONE. The same KYC record can legitimately be
 *   rejected, resubmitted, and rejected again (or approved more than
 *   once across separate review cycles) — {kycRef,transitionType}
 *   would incorrectly collide across these separate, independent
 *   decisions. sourceLogId points at the specific, immutable
 *   VerificationLog row (ADMIN_APPROVED/ADMIN_REJECTED) that produced
 *   THIS decision — a MongoDB ObjectId, globally unique by
 *   construction — so each decision occurrence gets its own permanent
 *   identity that can never be reused or confused with another.
 *   transitionType is still stored on these rows for readability/
 *   querying, but is NOT part of the uniqueness constraint (it's
 *   fully derivable from the log row's own `action`).
 */

import mongoose from "mongoose";

export const FIELD_AGENT_KYC_SYNC_TRANSITION = {
  FIRST_TOUCH_TO_KYC_PENDING:   "FIRST_TOUCH_TO_KYC_PENDING",
  APPROVAL_TO_TRAINING_PENDING: "APPROVAL_TO_TRAINING_PENDING",
  REJECTION_TO_KYC_REJECTED:    "REJECTION_TO_KYC_REJECTED",
};

export const FIELD_AGENT_KYC_SYNC_STATUS = {
  PENDING:    "PENDING",
  PROCESSING: "PROCESSING",
  PROCESSED:  "PROCESSED",
  FAILED:     "FAILED",
  // Not an error, not a success — this specific historical decision
  // occurrence is no longer applicable because a later, legitimate
  // event (a resubmission, or a newer decision of the same kind)
  // already determined the application's current state. Kept
  // permanently, never deleted, for an honest audit trail.
  SUPERSEDED: "SUPERSEDED",
};

export const FIELD_AGENT_KYC_SYNC_SOURCE = {
  FAST_PATH:     "FAST_PATH",
  RECONCILIATION: "RECONCILIATION",
};

const FieldAgentKycSyncEventSchema = new mongoose.Schema(
  {
    kycRef:  { type: mongoose.Schema.Types.ObjectId, ref: "KYC",  required: true },
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    transitionType: {
      type:     String,
      enum:     Object.values(FIELD_AGENT_KYC_SYNC_TRANSITION),
      required: true,
    },

    // The FieldAgentApplication.status this transition expects to
    // move FROM, and the target it moves TO — both plain APPLICATION_STATUS
    // string values (not re-imported here to avoid a hard dependency
    // between this model and FA-2's constants file; the job file
    // validates them against the real enum at apply time).
    expectedFromStatus: { type: String, required: true },
    toStatus:           { type: String, required: true },

    status: {
      type:    String,
      enum:    Object.values(FIELD_AGENT_KYC_SYNC_STATUS),
      default: FIELD_AGENT_KYC_SYNC_STATUS.PENDING,
    },

    // Set atomically at claim time — a PROCESSING row whose claimedAt
    // is older than the job's stale-claim threshold is treated as an
    // abandoned claim (worker crashed mid-processing) and becomes
    // reclaimable again. Same idiom as RatingEvent.js/Booking.js's
    // own HOLD-expiry pattern.
    claimedAt: { type: Date,   default: null },
    claimedBy: { type: String, default: null },

    attempts:  { type: Number, default: 0 },
    lastError: { type: String, default: null },

    processedAt:  { type: Date, default: null },
    supersededAt: { type: Date, default: null },

    // First time this event observed "prerequisite (FIRST_TOUCH) not
    // yet applied" — bounds how long an approval/rejection event will
    // wait before escalating to FAILED, INDEPENDENTLY of `attempts`
    // (which is reserved for genuine apply errors). See the job file's
    // PREREQUISITE_WAIT_TIMEOUT_MS.
    firstWaitingAt: { type: Date, default: null },

    source: {
      type:     String,
      enum:     Object.values(FIELD_AGENT_KYC_SYNC_SOURCE),
      required: true,
    },

    // Load-bearing identity for APPROVAL/REJECTION events (see file
    // header) — deliberately NO `default: null` here. A sparse index
    // only excludes documents where the field is genuinely ABSENT; a
    // Mongoose default of `null` would instead write an explicit null
    // onto every FIRST_TOUCH event (which never sets this field),
    // making them all collide on the same indexed null value under
    // the sparse unique index below after the very first one exists.
    // Omitting the field entirely for FIRST_TOUCH events (simply never
    // passing sourceLogId in their $setOnInsert) is what keeps them
    // truly untouched by this index, as intended.
    sourceLogId: { type: mongoose.Schema.Types.ObjectId, ref: "VerificationLog" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// FIRST_TOUCH identity — partial: only applies to first-touch rows,
// so it never constrains approval/rejection rows (which share no
// {kycRef,transitionType} uniqueness requirement — see file header).
FieldAgentKycSyncEventSchema.index(
  { kycRef: 1, transitionType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transitionType: FIELD_AGENT_KYC_SYNC_TRANSITION.FIRST_TOUCH_TO_KYC_PENDING,
    },
  }
);

// APPROVAL/REJECTION identity — sparse+unique: enforces uniqueness
// only among documents that actually have a sourceLogId (i.e. never
// applies to FIRST_TOUCH rows, which leave it null).
FieldAgentKycSyncEventSchema.index(
  { sourceLogId: 1 },
  { unique: true, sparse: true }
);

// Consumer's claim-scan query: { status: PENDING/PROCESSING } oldest
// first. Partial filter keeps the index tiny once most events reach
// PROCESSED/FAILED/SUPERSEDED — mirrors RatingEvent.js's own idiom.
FieldAgentKycSyncEventSchema.index(
  { status: 1, createdAt: 1 },
  {
    partialFilterExpression: {
      status: { $in: [FIELD_AGENT_KYC_SYNC_STATUS.PENDING, FIELD_AGENT_KYC_SYNC_STATUS.PROCESSING] },
    },
  }
);

export default mongoose.models.FieldAgentKycSyncEvent ||
  mongoose.model("FieldAgentKycSyncEvent", FieldAgentKycSyncEventSchema);
