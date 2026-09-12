/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/models/TrainingVersion.js
 *
 * FA-3.3 — one immutable curriculum snapshot. DRAFT is mutable (admin
 * authors modules/content against it); once PUBLISHED, this document
 * and every TrainingModule/TrainingContent under it become read-only
 * for good (enforced in trainingContent.service.js, not schema-level,
 * matching the codebase's existing convention of enforcing lifecycle
 * rules in the service layer rather than Mongoose hooks — see
 * fieldAgentApplication.service.js's own header comment on the same
 * choice).
 *
 * versionNumber is a simple auto-incrementing integer assigned at
 * creation (1, 2, 3, ...) — human-readable and total-ordered, so admin
 * tooling and audit logs can reference "v3" unambiguously without
 * re-deriving order from createdAt.
 */

import mongoose from "mongoose";
import { TRAINING_VERSION_STATUS } from "../constants/fieldAgentTraining.constants.js";

const trainingVersionSchema = new mongoose.Schema(
  {
    versionNumber: {
      type: Number,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: Object.values(TRAINING_VERSION_STATUS),
      default: TRAINING_VERSION_STATUS.DRAFT,
      required: true,
    },

    // Free-text admin note (e.g. "v2 — added GST explanation to
    // KYC_FINANCE_POLICY"). Never read by any completion/eligibility
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

// At most one PUBLISHED version at a time — partial unique index on a
// plain equality condition, same idiom as FieldAgentApplication's
// {userRef} unique-on-{nonTerminal:true} index (Mongo partial indexes
// don't support $ne/$nin, only equality, hence the dedicated boolean-
// like discriminator rather than filtering on status!="PUBLISHED").
trainingVersionSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: TRAINING_VERSION_STATUS.PUBLISHED },
  }
);

export default mongoose.models.TrainingVersion ||
  mongoose.model("TrainingVersion", trainingVersionSchema);
