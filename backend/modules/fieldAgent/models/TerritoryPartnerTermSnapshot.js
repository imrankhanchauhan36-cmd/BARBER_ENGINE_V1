/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js
 *
 * FA-10 — the immutable, server-created record of a Territory
 * Partner's 3-year (business-configured) term for one TerritoryAssignment.
 * Mirrors AcquisitionEarningProgress's own "snapshot once, at the
 * relationship's creation instant, never recompute from current
 * policy" principle exactly (FA-9's target-snapshot architecture) —
 * applied here to term length instead of earning target.
 *
 * termMonths is sourced from CommercialPolicyVersion.licenseTermMonths
 * — confirmed authoritative for this exact purpose by that model's own
 * header: "a future TerritoryPartnerLicense pins this version's values
 * at ISSUANCE" (FA-5 Architecture Decision Lock §11). CommercialPolicyOverride
 * deliberately does NOT carry licenseTermMonths (confirmed by reading
 * its schema — only the three earning-rate fields were carried over in
 * FA-9), so the source is always the NATIONAL policy, never a
 * geography override — term structure is business-wide, not locally
 * configurable in this model.
 *
 * "ISSUANCE" = TerritoryAssignment.effectiveFrom (no separate license
 * entity exists or is created by FA-10 — the assignment IS the
 * relationship becoming effective, per the locked business rule).
 *
 * One snapshot per assignment, enforced by the unique index below —
 * created once, inside the same transaction as the TerritoryAssignment
 * itself when a policy is available at that instant (see
 * commercialTerritory.service.js#assignPartner's own additive call),
 * or later via FA-9's own gap-reconciliation mechanism
 * (TERM_SNAPSHOT_GAP, reusing FieldAgentEarningPolicyGap — never a
 * second, parallel gap-tracking system).
 *
 * Never mutated after creation. A renewed/replacement assignment (a
 * separate TerritoryAssignment document, created by the existing
 * admin workflow) gets its own separate snapshot — this document is
 * never edited to represent a renewal (FA-10 explicitly excludes any
 * renewal workflow).
 */

import mongoose from "mongoose";

const TerritoryPartnerTermSnapshotSchema = new mongoose.Schema(
  {
    territoryAssignmentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TerritoryAssignment",
      required: true,
      immutable: true,
    },

    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
      immutable: true,
    },

    // = TerritoryAssignment.effectiveFrom at the moment this snapshot
    // was created — copied, not referenced, so this document remains
    // self-explanatory without a join even if read in isolation.
    termStartAt: { type: Date, required: true, immutable: true },

    // Snapshotted from CommercialPolicyVersion.licenseTermMonths as
    // resolved AT termStartAt — never re-read from a later policy.
    termMonths: {
      type: Number,
      required: true,
      immutable: true,
      validate: { validator: Number.isInteger, message: "termMonths must be a whole number of months" },
    },

    // Computed once, at creation, via UTC calendar-month addition
    // (Date.UTC — no local-timezone/DST ambiguity). Never recomputed.
    termExpiresAt: { type: Date, required: true, immutable: true },

    // Audit trail — which national policy version supplied termMonths.
    policyVersionRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialPolicyVersion",
      required: true,
      immutable: true,
    },
  },
  { timestamps: true }
);

// At most one snapshot per assignment — the real concurrency
// authority, same idiom as every other "exactly once" guarantee in
// this codebase (AcquisitionEarningProgress{acquisitionClaimRef}, etc.).
TerritoryPartnerTermSnapshotSchema.index({ territoryAssignmentRef: 1 }, { unique: true });
TerritoryPartnerTermSnapshotSchema.index({ fieldAgentRef: 1, createdAt: -1 });

export default mongoose.models.TerritoryPartnerTermSnapshot ||
  mongoose.model("TerritoryPartnerTermSnapshot", TerritoryPartnerTermSnapshotSchema);
