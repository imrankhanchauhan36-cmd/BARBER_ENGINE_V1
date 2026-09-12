/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/models/FieldAgentTraining.js
 *
 * FA-3.3 — one enrollment document per agent PER training cycle,
 * pinned forever to the exact `trainingVersion` it was created
 * against (never reassigned). An agent can accumulate multiple
 * historical FieldAgentTraining documents over their lifetime — one
 * per training cycle — but at most one is ever `isActive:true` at a
 * time (partial-unique index below, same idiom as
 * FieldAgentApplication's own {userRef} partial-unique-on-nonTerminal
 * index). Historical (superseded) enrollments are NEVER deleted or
 * overwritten — they stay queryable forever for audit.
 *
 * IMPORTANT — this is NOT auto-migration. Per the approved
 * versioning contract ("no silent migration"), an agent mid-training
 * (`status: IN_PROGRESS`) on an older version stays pinned to it even
 * after a newer version publishes — fieldAgentTraining.service.js
 * #getOrCreateEnrollment only ever opens a NEW active enrollment
 * (superseding the old one) when the agent's current active
 * enrollment is already COMPLETED *and* their application has
 * separately become eligible (TRAINING_PENDING) again for a genuinely
 * new training cycle. FA-2's current state machine has no route back
 * to TRAINING_PENDING once TEST_PENDING is reached, so this path is
 * dormant today — this model exists to be structurally correct for
 * whenever a future phase (e.g. a compliance-driven retraining
 * requirement) opens that route, without needing a schema change then.
 *
 * Progress is embedded (bounded — at most 10 modules and, in
 * practice, a few dozen content items total per version), never a
 * separate per-event collection — server-authoritative completion
 * only needs "is this item/module/training done", not a full event
 * stream (that's what TrainingAuditEvent is for).
 */

import mongoose from "mongoose";
import {
  CONTENT_PROGRESS_STATUS,
  MODULE_PROGRESS_STATUS,
  FIELD_AGENT_TRAINING_STATUS,
} from "../constants/fieldAgentTraining.constants.js";

const contentProgressSchema = new mongoose.Schema(
  {
    trainingContent: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingContent", required: true },
    status: {
      type: String,
      enum: Object.values(CONTENT_PROGRESS_STATUS),
      default: CONTENT_PROGRESS_STATUS.IN_PROGRESS,
    },
    // KNOWLEDGE_CHECK/PRACTICAL_SCENARIO — number of graded submission
    // attempts so far. Retriable, no cap in v1 (FA-3.4 is the gated,
    // high-stakes test; in-module checks are formative).
    attempts: { type: Number, default: 0 },
    bestScore: { type: Number, default: null },
    // LESSON — highest contiguous watch/view position reached, in
    // seconds, used to compare against TrainingContent.watchThresholdSeconds.
    maxWatchSeconds: { type: Number, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: false }
);

const moduleProgressSchema = new mongoose.Schema(
  {
    trainingModule: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingModule", required: true },
    moduleKey: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(MODULE_PROGRESS_STATUS),
      default: MODULE_PROGRESS_STATUS.IN_PROGRESS,
    },
    completedAt: { type: Date, default: null },
  },
  { _id: false }
);

const fieldAgentTrainingSchema = new mongoose.Schema(
  {
    agentRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Denormalized, informational pointer only (same rationale as
    // FieldAgentApplication.kycRef) — never the identity boundary.
    // Identity for every request is always req.user._id -> agentRef.
    applicationRef: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Pinned forever at enrollment time. Never reassigned.
    trainingVersion: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingVersion", required: true },

    status: {
      type: String,
      enum: Object.values(FIELD_AGENT_TRAINING_STATUS),
      default: FIELD_AGENT_TRAINING_STATUS.IN_PROGRESS,
    },

    // true for exactly the one CURRENT enrollment cycle of this
    // agent; flipped to false (never deleted) the moment a later
    // enrollment supersedes it — see file header. A freshly-created
    // enrollment is always active; nothing else sets this true.
    isActive: { type: Boolean, default: true },

    moduleProgress: { type: [moduleProgressSchema], default: () => [] },
    contentProgress: { type: [contentProgressSchema], default: () => [] },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },

    // Language the agent was last learning in — pure UX convenience
    // (a sensible default for their next fetch), never read by any
    // completion/business-rule logic.
    lastLanguageCode: { type: String, default: null },
  },
  { timestamps: true }
);

// At most one ACTIVE enrollment per agent at any time — partial
// unique index (plain equality only, same Mongo constraint that
// shaped FieldAgentApplication's own {userRef} index: $ne/$nin can't
// be used in a partialFilterExpression, hence the dedicated boolean
// rather than filtering on status).
fieldAgentTrainingSchema.index(
  { agentRef: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// An agent can never enroll twice (active or superseded) against the
// exact same version — belt-and-suspenders alongside the isActive
// index above, and what actually prevents a concurrent double-create
// race from producing two documents for one {agent,version} pair.
fieldAgentTrainingSchema.index({ agentRef: 1, trainingVersion: 1 }, { unique: true });

fieldAgentTrainingSchema.index({ trainingVersion: 1, status: 1 });

export default mongoose.models.FieldAgentTraining ||
  mongoose.model("FieldAgentTraining", fieldAgentTrainingSchema);
