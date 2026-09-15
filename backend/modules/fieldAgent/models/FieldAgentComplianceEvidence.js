/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentComplianceEvidence.js
 *
 * FA-12.1 — one immutable, point-in-time compliance evidence record.
 * Evidence has NO lifecycle (unlike FieldAgentComplianceCase) — it is
 * either filed standalone or attached to a case, and never changes
 * after that.
 *
 * LOCKED DISTINCTION (FA-12 business decision lock):
 *   Compliance evidence != compliance case != disciplinary decision.
 * This model is ONLY the evidence layer. It never itself represents a
 * violation, a decision, or an enforcement action — see
 * FieldAgentComplianceCase.js for the case/decision layer.
 *
 * sourceSnapshot is a SMALL, EXPLICITLY BOUNDED plain object — never
 * an unrestricted Mixed dump of the cited source document (FA-12 audit
 * lock). Only the fields relevant to the evidence's own `sourceType`
 * are populated; the rest stay null. This mirrors FA-9's own
 * "snapshot at a point in time" discipline (e.g.
 * AcquisitionEarningProgress.targetInPaise) — the snapshot captures
 * what the source looked like AT FILING TIME, immutably, even if the
 * source document is later further mutated by its own owning module.
 *
 * Immutability: mirrors FieldAgentEarningLedger's own hard 6-hook
 * blockMutation pattern exactly — deliberately STRICTER than
 * FieldAgentAuditEvent's own soft/convention-only immutability,
 * because this is evidence underpinning a real disciplinary case, not
 * a routine module audit trail. This is an explicit design choice, not
 * an oversight — see FieldAgentComplianceAuditEvent.js's own header for
 * the identical reasoning applied there too.
 *
 * NEVER references Booking, Salon, WalletLedger, FieldAgentEarningLedger,
 * AcquisitionEarningProgress, or FieldAgentEarningPolicyGap as a
 * sourceType — those remain FA-9/FA-10's frozen financial domain,
 * untouched by FA-12 (locked boundary).
 */

import mongoose from "mongoose";
import { FA12_VIOLATION_CATEGORY, FA12_EVIDENCE_SOURCE_TYPE, EVIDENCE_DESCRIPTION_MAX_LENGTH } from "../constants/compliance.constants.js";

// Explicitly bounded per-sourceType snapshot fields — a flat, fully
// whitelisted shape (never Mixed). Only the subset relevant to the
// evidence's own sourceType is expected to be populated; enforcing
// exactly which subset is FA-12.2 service-layer responsibility (this
// is domain-foundation schema only).
const sourceSnapshotSchema = new mongoose.Schema(
  {
    // FRAUD_SIGNAL
    fraudSignalType: { type: String, default: null },
    fraudSignalSeverity: { type: String, default: null },
    // KYC_STATUS
    kycStatus: { type: String, default: null },
    // TERRITORY_ASSIGNMENT
    territoryAssignmentStatus: { type: String, default: null },
    territoryAssignmentEndReason: { type: String, default: null },
    // ACQUISITION_CLAIM
    acquisitionClaimStatus: { type: String, default: null },
    acquisitionClaimEndedReason: { type: String, default: null },
    // Shared, source-agnostic point-in-time marker (when the cited
    // source's state, as captured above, was actually true).
    asOf: { type: Date, default: null },
  },
  { _id: false }
);

const fieldAgentComplianceEvidenceSchema = new mongoose.Schema(
  {
    fieldAgentRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgent", required: true, immutable: true },

    evidenceType: {
      type: String,
      enum: Object.values(FA12_VIOLATION_CATEGORY),
      required: true,
      immutable: true,
    },

    sourceType: {
      type: String,
      enum: Object.values(FA12_EVIDENCE_SOURCE_TYPE),
      required: true,
      immutable: true,
    },

    // Nullable — absent for a pure ADMIN_NARRATIVE evidenceType, where
    // the evidence IS the admin's own written account with no other
    // system-detected fact behind it.
    sourceRef: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },

    sourceSnapshot: { type: sourceSnapshotSchema, default: () => ({}) },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: EVIDENCE_DESCRIPTION_MAX_LENGTH,
      immutable: true,
    },

    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    reportedAt: { type: Date, required: true, default: Date.now, immutable: true },

    // Nullable — evidence may be filed standalone before any case
    // exists, or attached to one later (FA-12.2). Once set, immutable —
    // evidence is never silently moved between cases.
    //
    // Deliberately NO `default: null` — the {caseRef:1} index below is
    // sparse, and MongoDB's sparse indexes only exclude a field that is
    // genuinely ABSENT, not one explicitly set to `null`. A `default:
    // null` would defeat the sparse index's own purpose by writing a
    // real (duplicate-valued) entry for every standalone-evidence row.
    caseRef: { type: mongoose.Schema.Types.ObjectId, ref: "FieldAgentComplianceCase", immutable: true },

    // Sparse UNIQUE — populated only for deterministic sources
    // (e.g. `evidence:fraudsignal:<id>`, `evidence:kyc:<id>:<status>`)
    // to prevent double-filing the same underlying fact as duplicate
    // evidence. ADMIN_NARRATIVE rows never populate this (each
    // narrative is inherently unique) — never forced through a
    // fabricated dedupe key just to satisfy this field.
    //
    // Deliberately NO `default: null` (same reasoning as `caseRef`
    // above, but here it is load-bearing, not just wasteful: this
    // index is UNIQUE, so an explicit `null` default would make every
    // second ADMIN_NARRATIVE row collide with the first on a duplicate
    // `dedupeKey: null` — confirmed as a real defect during FA-12.1's
    // own verification and fixed here before it ever shipped.
    dedupeKey: { type: String, immutable: true },
  },
  { timestamps: true }
);

fieldAgentComplianceEvidenceSchema.index({ fieldAgentRef: 1, reportedAt: -1 });
fieldAgentComplianceEvidenceSchema.index({ caseRef: 1 }, { sparse: true });
fieldAgentComplianceEvidenceSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

//////////////////////////////////////////////////////////////
// Immutable — evidence is a historical fact, never corrected in
// place. A mistaken filing is addressed by the case/decision layer
// (e.g. DISMISSED), never by editing or deleting the evidence itself.
// Mirrors FieldAgentEarningLedger's own editing-history guard exactly.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("FieldAgentComplianceEvidence entries are immutable — they cannot be updated or deleted.");
};
fieldAgentComplianceEvidenceSchema.pre("save", function (next) {
  if (!this.isNew) return next(blockMutation());
  next();
});
fieldAgentComplianceEvidenceSchema.pre("updateOne", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("updateMany", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("findOneAndUpdate", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("deleteOne", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("deleteMany", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("findOneAndDelete", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("replaceOne", blockMutation);
fieldAgentComplianceEvidenceSchema.pre("findOneAndReplace", blockMutation);

export default mongoose.models.FieldAgentComplianceEvidence ||
  mongoose.model("FieldAgentComplianceEvidence", fieldAgentComplianceEvidenceSchema);
