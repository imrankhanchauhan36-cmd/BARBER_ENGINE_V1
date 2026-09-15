/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentComplianceCase.js
 *
 * FA-12.1 — the mutable case/workflow layer. A case represents an
 * ADMIN DECISION IN PROGRESS, distinct from the immutable evidence that
 * supports it (FieldAgentComplianceEvidence.js) and distinct from any
 * real-world enforcement action (which never happens automatically —
 * see the `decision.outcome` field below).
 *
 * LOCKED (FA-12 business decision lock):
 *   - No automatic SUSPENDED/BLOCKED status exists here, and this
 *     model NEVER writes to FieldAgent.operationalStatus or
 *     User.accountStatus. `ESCALATED_FOR_ENFORCEMENT` means an
 *     INDIA_ADMIN decided real-world enforcement is warranted — the
 *     enforcement itself remains a SEPARATE, manual admin action
 *     through the existing (unmodified) User.accountStatus mechanism.
 *   - `category` is immutable after opening — a genuinely different
 *     violation category means a NEW case, never a relabel, so
 *     historical categories stay stable even if the taxonomy evolves.
 *   - This is domain-foundation only: the transition SERVICE (the
 *     logic that actually moves a case between statuses, maintains
 *     `activeCaseMarker`, and writes FieldAgentComplianceAuditEvent
 *     rows) is FA-12.2 scope, not implemented here.
 *
 * CONCURRENCY: `version` supports optimistic-concurrency transitions
 * (FA-12.2's atomic findOneAndUpdate({_id,status,version}) idiom,
 * mirroring the proven AcquisitionClaim/TestAttempt pattern) — declared
 * structurally now, enforced by FA-12.2's service logic later.
 *
 * ACTIVE-CASE UNIQUENESS: `activeCaseMarker` is a domain-foundation
 * mechanism, not yet driven by any transition logic (FA-12.2's job).
 * It defaults to `true` on a freshly-opened case; FA-12.2's transition
 * service is expected to `$unset` it when a case enters any terminal
 * status (WARNING_ISSUED/ESCALATED/DISMISSED/RESOLVED) and restore it
 * to `true` on an admin-initiated reopen. The partial unique index
 * below uses `{activeCaseMarker: {$exists: true}}` (a filter operator
 * unambiguously supported by MongoDB partial indexes, unlike relying
 * on an untested `$in`/`$nin` over multiple status values) — so at
 * most one case per (fieldAgentRef, category) can ever have the marker
 * present at a time, i.e. at most one ACTIVE case, while any number of
 * terminal (marker-absent) historical cases remain untouched.
 */

import mongoose from "mongoose";
import { FA12_VIOLATION_CATEGORY, FA12_CASE_STATUS } from "../constants/compliance.constants.js";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";

const caseDecisionSchema = new mongoose.Schema(
  {
    outcome: {
      type: String,
      enum: ["WARNING_ISSUED", "ESCALATED_FOR_ENFORCEMENT", "DISMISSED", "NO_ACTION"],
      required: true,
    },
    reasoning: { type: String, required: true, trim: true, maxlength: 2000 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    decidedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const reopenEntrySchema = new mongoose.Schema(
  {
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reopenedAt: { type: Date, required: true, default: Date.now },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const fieldAgentComplianceCaseSchema = new mongoose.Schema(
  {
    fieldAgentRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgent", required: true, immutable: true },

    // Denormalized at open, immutable — historical-correctness
    // discipline mirroring FA-11's own commercialPath snapshot on
    // FieldAgentPerformanceSnapshot.
    commercialPath: {
      type: String,
      enum: [...Object.values(COMMERCIAL_PATH), null],
      required: true,
      immutable: true,
    },

    // Immutable after opening — see file header.
    category: {
      type: String,
      enum: Object.values(FA12_VIOLATION_CATEGORY),
      required: true,
      immutable: true,
    },

    status: {
      type: String,
      enum: Object.values(FA12_CASE_STATUS),
      required: true,
      default: FA12_CASE_STATUS.OPEN,
    },

    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    openedAt: { type: Date, required: true, default: Date.now, immutable: true },

    assignedAdminRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Populated only once a decision is made (FA-12.2).
    decision: { type: caseDecisionSchema, default: null },

    reopenedHistory: { type: [reopenEntrySchema], default: () => [] },

    // Optimistic concurrency — see file header.
    version: { type: Number, required: true, default: 0 },

    // See file header — present (true) while the case is active,
    // $unset by FA-12.2 on entering a terminal status.
    activeCaseMarker: { type: Boolean, default: true },
  },
  { timestamps: true }
);

fieldAgentComplianceCaseSchema.index({ fieldAgentRef: 1, status: 1 });
fieldAgentComplianceCaseSchema.index({ fieldAgentRef: 1, createdAt: -1 });
fieldAgentComplianceCaseSchema.index({ status: 1, createdAt: -1 });

// At most one ACTIVE case per (fieldAgentRef, category) — see file
// header for why $exists:true (not $in over status values) is used.
fieldAgentComplianceCaseSchema.index(
  { fieldAgentRef: 1, category: 1 },
  { unique: true, partialFilterExpression: { activeCaseMarker: { $exists: true } } }
);

export default mongoose.models.FieldAgentComplianceCase ||
  mongoose.model("FieldAgentComplianceCase", fieldAgentComplianceCaseSchema);
