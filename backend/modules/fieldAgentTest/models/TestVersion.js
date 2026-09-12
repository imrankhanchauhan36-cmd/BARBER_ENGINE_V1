/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/models/TestVersion.js
 *
 * FA-3.4 — one immutable exam configuration + question-set snapshot.
 * DRAFT is mutable (admin authors questions and tunes
 * passingScore/maxAttempts/retryCooldownMinutes against it); once
 * PUBLISHED, this document and every TestQuestion under it become
 * read-only for good (enforced in testContent.service.js, not
 * schema-level — same convention TrainingVersion already uses).
 *
 * passingScore/maxAttempts/retryCooldownMinutes live on the version
 * itself (unlike TrainingVersion, which has no top-level business
 * fields) because these are whole-test settings, not per-question —
 * and because a TestAttempt pins to a specific TestVersion, these
 * settings must travel with it permanently (PLAN V2 Correction 3):
 * an attempt started against v1 is graded against v1's passingScore
 * forever, even after v2/v3 publish with different values.
 *
 * versionNumber is a simple auto-incrementing integer assigned at
 * creation, same idiom as TrainingVersion.
 */

import mongoose from "mongoose";
import {
  TEST_VERSION_STATUS,
  DEFAULT_PASSING_SCORE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_COOLDOWN_MINUTES,
} from "../constants/fieldAgentTest.constants.js";

const testVersionSchema = new mongoose.Schema(
  {
    versionNumber: {
      type: Number,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: Object.values(TEST_VERSION_STATUS),
      default: TEST_VERSION_STATUS.DRAFT,
      required: true,
    },

    passingScore: { type: Number, required: true, default: DEFAULT_PASSING_SCORE },
    maxAttempts: { type: Number, required: true, default: DEFAULT_MAX_ATTEMPTS },
    retryCooldownMinutes: { type: Number, required: true, default: DEFAULT_RETRY_COOLDOWN_MINUTES },

    // Free-text admin note. Never read by any grading/eligibility
    // logic — display-only.
    notes: { type: String, default: null, maxlength: 1000 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one PUBLISHED version at a time — same partial-unique-index
// idiom as TrainingVersion/FieldAgentApplication.
testVersionSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TEST_VERSION_STATUS.PUBLISHED },
  }
);

export default mongoose.models.TestVersion || mongoose.model("TestVersion", testVersionSchema);
