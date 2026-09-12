/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/models/TestAttempt.js
 *
 * FA-3.4.2 — one exam attempt, permanently pinned to the TestVersion
 * (and its exact ordered question set) that was PUBLISHED at the
 * moment the attempt started. Immutable once finalized — enforced in
 * fieldAgentTest.service.js (service-layer discipline, same
 * convention every other lifecycle in this codebase uses), never a
 * schema-level hook.
 *
 * PINNING (PLAN V2 Correction 3): testVersionRef/questionRefs are set
 * once at creation and never reassigned. Because a PUBLISHED
 * TestVersion/TestQuestion is permanently immutable (see
 * testContent.service.js's assertDraft guard), grading this attempt
 * by explicitly re-loading testVersionRef/questionRefs at submission
 * time — however much later, regardless of how many newer versions
 * have since published — always reproduces the exact rules and
 * content the agent was actually tested on.
 *
 * questionRefs is a SNAPSHOT of ordered ids, not merely re-derivable
 * from testVersionRef — it is the authoritative delivery/grading
 * sequence (PLAN V2 Correction 4: Mongo's `$in` does not preserve
 * array order, so every read site must reconstruct order from this
 * array, never trust query result order).
 *
 * CONCURRENCY (PLAN V2 Correction 1): the partial unique index below
 * is the actual, DB-enforced guarantee that an application can never
 * have two simultaneously IN_PROGRESS attempts — {applicationRef,
 * attemptNumber} unique alone only prevents two attempts from
 * colliding on the same number, it does nothing to stop a second,
 * differently-numbered attempt from being created while one is
 * already active (see that file's own header for the full race
 * analysis this index closes).
 *
 * submissionClaimedAt (PLAN V2 Correction 2) is a TECHNICAL mutex
 * field only, never a fourth business status — `status` stays exactly
 * IN_PROGRESS | PASSED | FAILED. See
 * fieldAgentTest.service.js#submitTestAttempt for the atomic
 * claim/self-healing-stale-claim mechanism this field supports.
 */

import mongoose from "mongoose";
import { TEST_ATTEMPT_STATUS } from "../constants/fieldAgentTest.constants.js";

const answerSchema = new mongoose.Schema(
  {
    questionRef: { type: mongoose.Schema.Types.ObjectId, ref: "TestQuestion", required: true },
    // null = unanswered (scored incorrect, never rejected — see
    // fieldAgentTest.service.js's scoring rules).
    selectedOptionIndex: { type: Number, default: null },
    // Server-computed at submission only, never client-supplied.
    isCorrect: { type: Boolean, default: null },
  },
  { _id: false }
);

const testAttemptSchema = new mongoose.Schema(
  {
    applicationRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgentApplication", required: true },
    agentRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    testVersionRef: { type: mongoose.Schema.Types.ObjectId, ref: "TestVersion", required: true },

    // 1-based, unique per applicationRef — see the
    // {applicationRef,attemptNumber} index below.
    attemptNumber: { type: Number, required: true },

    status: {
      type: String,
      enum: Object.values(TEST_ATTEMPT_STATUS),
      default: TEST_ATTEMPT_STATUS.IN_PROGRESS,
      required: true,
    },

    // Server-selected, ordered snapshot — see file header.
    questionRefs: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "TestQuestion" }],
      required: true,
    },

    // Populated only at submission time; empty/absent while
    // IN_PROGRESS.
    answers: { type: [answerSchema], default: () => [] },

    score: { type: Number, default: null },
    passed: { type: Boolean, default: null },

    // Technical mutex only — see file header.
    submissionClaimedAt: { type: Date, default: null },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Historical numbering integrity — no two attempts for the same
// application can ever share a number, independent of the
// active-attempt race the partial index below closes.
testAttemptSchema.index({ applicationRef: 1, attemptNumber: 1 }, { unique: true });

// THE concurrency guard (PLAN V2 Correction 1) — at most one
// IN_PROGRESS attempt per application, DB-enforced, regardless of
// timing or attempt-number races. See file header.
testAttemptSchema.index(
  { applicationRef: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TEST_ATTEMPT_STATUS.IN_PROGRESS },
  }
);

// Start-eligibility ("is one already IN_PROGRESS") + cooldown ("most
// recent FAILED") queries.
testAttemptSchema.index({ applicationRef: 1, status: 1 });

// Agent-scoped lookups (e.g. a future "my test history" view).
testAttemptSchema.index({ agentRef: 1 });

export default mongoose.models.TestAttempt || mongoose.model("TestAttempt", testAttemptSchema);
