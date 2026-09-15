/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/TerritoryAssignment.js
 *
 * FA-5.2 — the temporal record of which FieldAgent operates a given
 * CommercialTerritory, and when. Deliberately a SEPARATE collection
 * from CommercialTerritory (not embedded) so full multi-year history
 * stays queryable by both territoryRef and fieldAgentRef without
 * unbounded array growth on the territory document itself — same
 * "unbounded embedded array is an anti-pattern" discipline
 * AreaDiscoveryCandidate's own bounded arrays were designed around.
 * The name mirrors the exact forward-reference already present in
 * FieldAgent.js's own FA-5.1 header comment.
 *
 * Exclusivity is enforced entirely by the two partial unique indexes
 * below — the real concurrency authority, not a service-layer
 * pre-check:
 *   - at most one ACTIVE assignment per territory (one active partner
 *     per territory)
 *   - at most one ACTIVE assignment per FieldAgent (a FieldAgent may
 *     hold at most one ACTIVE territory at a time — locked decision)
 *
 * Ending an assignment (partner exit, territory retirement, or admin
 * reassignment) never deletes or rewrites this document — status
 * flips to ENDED once, effectiveUntil/endReason/endedBy are set once,
 * and it remains permanently queryable as history (locked decision).
 *
 * TerritoryPartnerLicense remains explicitly deferred to a later
 * phase — this model has no license reference and does not gate
 * FieldAgent.operationalStatus in any way.
 */

import mongoose from "mongoose";
import { ASSIGNMENT_STATUS, ASSIGNMENT_END_REASON } from "../constants/commercialTerritory.constants.js";

const TerritoryAssignmentSchema = new mongoose.Schema(
  {
    territoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialTerritory",
      required: true,
    },

    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(ASSIGNMENT_STATUS),
      required: true,
      default: ASSIGNMENT_STATUS.ACTIVE,
    },

    effectiveFrom: {
      type: Date,
      required: true,
    },

    effectiveUntil: {
      type: Date,
      default: null,
    },

    // Explicit `null` in the enum list (not just an absent default) —
    // same reason as FieldAgent.commercialPath: Mongoose enum
    // validation otherwise rejects an explicitly-set `null`, and this
    // field is legitimately null while ACTIVE.
    endReason: {
      type: String,
      enum: [...Object.values(ASSIGNMENT_END_REASON), null],
      default: null,
    },

    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// One ACTIVE assignment per territory — DB-level, the real guarantee.
TerritoryAssignmentSchema.index(
  { territoryRef: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: ASSIGNMENT_STATUS.ACTIVE } }
);

// One ACTIVE territory per FieldAgent — DB-level (locked decision).
TerritoryAssignmentSchema.index(
  { fieldAgentRef: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: ASSIGNMENT_STATUS.ACTIVE } }
);

// Full chronological history per territory.
TerritoryAssignmentSchema.index({ territoryRef: 1, effectiveFrom: -1 });

// FA-11.4 — full chronological history per FIELD AGENT (the symmetric
// counterpart to the territory-keyed index above). Supports
// fieldAgentPerformance.service.js#computeTerritoryMetrics's
// TerritoryAssignment.find({fieldAgentRef}).sort({effectiveFrom:-1}) —
// previously a full COLLSCAN + in-memory SORT (confirmed by the FA-11.4
// audit: 2008/2008 docs examined for 8 matches), since neither
// existing fieldAgentRef index is usable (both are partial, ACTIVE-only)
// and the only non-partial history index is keyed by territoryRef, not
// fieldAgentRef. Index-only addition — the query itself is unchanged.
TerritoryAssignmentSchema.index({ fieldAgentRef: 1, effectiveFrom: -1 });

export default mongoose.models.TerritoryAssignment ||
  mongoose.model("TerritoryAssignment", TerritoryAssignmentSchema);
