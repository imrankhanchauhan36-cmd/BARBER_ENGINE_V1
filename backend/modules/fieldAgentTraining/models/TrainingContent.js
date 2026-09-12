/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/models/TrainingContent.js
 *
 * FA-3.3 — one ordered learning unit inside a TrainingModule.
 * contentType is restricted to exactly the 4 approved values (LESSON,
 * KNOWLEDGE_CHECK, PRACTICAL_SCENARIO, REFERENCE) — no bespoke types.
 *
 * MULTILINGUAL: translations[] carries per-language display text
 * only (title/body). The business-rule-bearing pieces —
 * completion mechanics, grading — are language-INDEPENDENT and live
 * outside translations[], so a translation can never silently change
 * what counts as correct or complete (approved plan requirement).
 * Each translation carries its own `approved` flag; an unapproved or
 * missing translation for the requested language falls back to
 * DEFAULT_LANGUAGE_CODE ('en'), which is mandatory on every item.
 *
 * GRADING SECRECY: `grading` holds the server-only answer key/rubric
 * for KNOWLEDGE_CHECK and PRACTICAL_SCENARIO items. `select: false` so
 * it is never present on a normal find()/findOne() — only
 * fieldAgentTraining.service.js's grading path explicitly
 * `.select("+grading")`s it. This is the single mechanism preventing
 * answer-key leakage to the agent-facing API (verified explicitly in
 * FA-3.3.1's live-verification script).
 *
 * MEDIA: media.publicId is a Cloudinary public_id uploaded with
 * type:"authenticated" (never public) — this document never stores a
 * permanent secure_url. Playback URLs are minted per-request, short-
 * TTL, by mediaDelivery.service.js.
 *
 * helpEligible marks an item as safe to surface through the separate,
 * curated Help endpoint (fieldAgentHelp.service.js) — Help never
 * queries PRACTICAL_SCENARIO/KNOWLEDGE_CHECK items or reads `grading`,
 * regardless of this flag (enforced in the service, defense-in-depth
 * beyond just this flag).
 */

import mongoose from "mongoose";
import {
  CONTENT_TYPE,
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE_CODE,
} from "../constants/fieldAgentTraining.constants.js";

const contentTranslationSchema = new mongoose.Schema(
  {
    languageCode: { type: String, enum: SUPPORTED_LANGUAGE_CODES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // LESSON/REFERENCE prose, or the PRACTICAL_SCENARIO prompt text.
    // KNOWLEDGE_CHECK stores its question text here too, with answer
    // options in `translations.$.options` below.
    body: { type: String, default: null, maxlength: 8000 },
    options: {
      type: [String],
      default: undefined,
    },
    // Draft translations can be authored ahead of admin sign-off;
    // only approved:true translations are ever served to an agent.
    approved: { type: Boolean, default: false },
  },
  { _id: false }
);

const mediaSchema = new mongoose.Schema(
  {
    publicId: { type: String, default: null },
    // Cloudinary resource_type — "image" | "video" | "raw".
    resourceType: { type: String, default: null },
  },
  { _id: false }
);

const trainingContentSchema = new mongoose.Schema(
  {
    trainingVersion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingVersion",
      required: true,
    },

    trainingModule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingModule",
      required: true,
    },

    contentType: {
      type: String,
      enum: Object.values(CONTENT_TYPE),
      required: true,
    },

    // Delivery order within the parent module (0-based).
    order: { type: Number, required: true },

    // Whether this item gates module completion. Admin must set this
    // explicitly false for REFERENCE items at authoring time —
    // reference material must never become an automatic-completion
    // loophole by silent default (approved plan requirement), so the
    // schema default is `true` for every contentType and the admin
    // authoring service is what flips REFERENCE items to false unless
    // explicitly overridden (see trainingContent.service.js#addContent).
    required: {
      type: Boolean,
      default: true,
    },

    translations: {
      type: [contentTranslationSchema],
      default: () => [],
    },

    media: { type: mediaSchema, default: () => ({}) },

    // LESSON only — minimum watch/view seconds before the server
    // accepts a completion event for this item. Null for non-LESSON
    // types (their completion mechanic is submission-based, not time-
    // based).
    watchThresholdSeconds: { type: Number, default: null },

    // KNOWLEDGE_CHECK / PRACTICAL_SCENARIO only. Server-only, see file
    // header. Deliberately `Mixed` — a knowledge check's rubric is a
    // simple {correctOptionIndex}, a practical scenario's is a
    // structured checklist/rubric; both are graded by the same
    // fieldAgentTraining.service.js#gradeSubmission using whatever
    // shape this item's own contentType implies, never a shared
    // schema forced across both.
    grading: { type: mongoose.Schema.Types.Mixed, default: null, select: false },

    // Minimum score (0-100) to count as a passing/completing
    // submission. Null for LESSON/REFERENCE (not submission-graded).
    passingScore: { type: Number, default: null },

    // Curated Help exposure marker — see file header.
    helpEligible: { type: Boolean, default: false },
  },
  { timestamps: true }
);

trainingContentSchema.index({ trainingModule: 1, order: 1 }, { unique: true });
trainingContentSchema.index({ trainingVersion: 1 });
trainingContentSchema.index({ helpEligible: 1, trainingVersion: 1 });

// Guarantees a mandatory DEFAULT_LANGUAGE_CODE translation always
// exists by the time this document is queried elsewhere — the service
// layer is the one place allowed to insert partially-authored drafts,
// but even a draft always seeds an 'en' placeholder so the language-
// fallback resolver (fieldAgentTraining.service.js) never has to
// special-case "no translations at all".
trainingContentSchema.pre("validate", function guardDefaultLanguage(next) {
  const hasDefault = (this.translations || []).some((t) => t.languageCode === DEFAULT_LANGUAGE_CODE);
  if (!hasDefault) {
    return next(new Error(`TrainingContent requires at least a '${DEFAULT_LANGUAGE_CODE}' translation`));
  }
  next();
});

export default mongoose.models.TrainingContent ||
  mongoose.model("TrainingContent", trainingContentSchema);
