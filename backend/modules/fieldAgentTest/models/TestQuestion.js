/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/models/TestQuestion.js
 *
 * FA-3.4 — one single-choice exam question belonging directly to a
 * TestVersion (no intermediate module layer, unlike TrainingContent —
 * a certification test has no curriculum-module structure).
 *
 * MULTILINGUAL: translations[] carries per-language questionText +
 * options. Grading (`correctOptionIndex`) is language-INDEPENDENT and
 * lives outside translations[], so a translation can never silently
 * change what counts as correct (same non-negotiable rule
 * TrainingContent already follows). Each translation carries its own
 * `approved` flag; English ('en') is mandatory, Hindi ('hi') optional.
 *
 * GRADING SECRECY: `grading` holds the server-only answer key.
 * `select: false` so it is never present on a normal find()/findOne()
 * — only testContent.service.js's admin-authoring reads and (later)
 * fieldAgentTest.service.js's grading path explicitly
 * `.select("+grading")` it. This is the single mechanism preventing
 * answer-key leakage to the agent-facing API — the exact,
 * already-proven TrainingContent.grading mechanism.
 *
 * `active` lets an admin exclude a question from the fixed
 * server-defined question set during DRAFT authoring without deleting
 * it. Once published, both the version and every question under it
 * are permanently frozen (enforced in the service layer), so `active`
 * has no further effect after publish.
 */

import mongoose from "mongoose";
import { SUPPORTED_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE } from "../constants/fieldAgentTest.constants.js";

const questionTranslationSchema = new mongoose.Schema(
  {
    languageCode: { type: String, enum: SUPPORTED_LANGUAGE_CODES, required: true },
    questionText: { type: String, required: true, trim: true, maxlength: 500 },
    options: { type: [String], required: true },
    // Draft translations can be authored ahead of admin sign-off;
    // only approved:true translations are ever served to an agent or
    // counted toward the publish gate.
    approved: { type: Boolean, default: false },
  },
  { _id: false }
);

const testQuestionSchema = new mongoose.Schema(
  {
    testVersion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestVersion",
      required: true,
    },

    // Delivery order within the version (0-based).
    order: { type: Number, required: true },

    translations: {
      type: [questionTranslationSchema],
      default: () => [],
    },

    // { correctOptionIndex: Number }. Server-only, see file header.
    grading: { type: mongoose.Schema.Types.Mixed, default: null, select: false },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

testQuestionSchema.index({ testVersion: 1, order: 1 }, { unique: true });

// Guarantees a mandatory 'en' translation always exists by the time
// this document is queried elsewhere — same guard TrainingContent
// uses for the identical reason.
testQuestionSchema.pre("validate", function guardDefaultLanguage(next) {
  const hasDefault = (this.translations || []).some((t) => t.languageCode === DEFAULT_LANGUAGE_CODE);
  if (!hasDefault) {
    return next(new Error(`TestQuestion requires at least a '${DEFAULT_LANGUAGE_CODE}' translation`));
  }
  next();
});

export default mongoose.models.TestQuestion || mongoose.model("TestQuestion", testQuestionSchema);
