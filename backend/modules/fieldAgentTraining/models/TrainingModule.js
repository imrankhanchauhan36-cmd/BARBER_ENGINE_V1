/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/models/TrainingModule.js
 *
 * FA-3.3 — one of the 10 mandatory curriculum modules within a single
 * TrainingVersion. moduleKey is restricted to the fixed MODULE_KEY
 * enum (never free text) and order is derived from MODULE_KEY_ORDER —
 * both enforced in trainingContent.service.js at creation time so a
 * version can never end up with a duplicate, missing, or out-of-order
 * module.
 *
 * title carries the same per-language translation shape as
 * TrainingContent's translations array (see that file's header for
 * the full rationale) — kept here rather than hard-coding the module
 * display name, since even module titles must be translatable.
 */

import mongoose from "mongoose";
import { MODULE_KEY, SUPPORTED_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE } from "../constants/fieldAgentTraining.constants.js";

const moduleTranslationSchema = new mongoose.Schema(
  {
    languageCode: { type: String, enum: SUPPORTED_LANGUAGE_CODES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, default: null, trim: true, maxlength: 1000 },
    // Defaults true (unlike TrainingContent's own translations, which
    // default false) — a module title/summary is display metadata,
    // not gradeable curriculum body text, so it doesn't warrant the
    // same draft-sign-off gate. fieldAgentTraining.service.js's
    // resolveTranslation() is shared by both and filters on this
    // field either way, so an admin who DOES want to stage an
    // unapproved module title can still set this false explicitly.
    approved: { type: Boolean, default: true },
  },
  { _id: false }
);

const trainingModuleSchema = new mongoose.Schema(
  {
    trainingVersion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingVersion",
      required: true,
    },

    moduleKey: {
      type: String,
      enum: Object.values(MODULE_KEY),
      required: true,
    },

    // Mandatory curriculum delivery order (0-based), fixed by
    // MODULE_KEY_ORDER — never independently chosen by admin.
    order: { type: Number, required: true },

    // Business-rule-bearing content lives in translations[]; every
    // module must carry at least a DEFAULT_LANGUAGE_CODE ('en') entry
    // (enforced in the service, not schema — schema allows an empty
    // array only transiently while a draft module is first created).
    translations: {
      type: [moduleTranslationSchema],
      default: () => [],
    },
  },
  { timestamps: true }
);

// One module per key per version — a version can never have two
// FOUNDATION modules, and never a duplicate order slot.
trainingModuleSchema.index({ trainingVersion: 1, moduleKey: 1 }, { unique: true });
trainingModuleSchema.index({ trainingVersion: 1, order: 1 }, { unique: true });

export default mongoose.models.TrainingModule ||
  mongoose.model("TrainingModule", trainingModuleSchema);
