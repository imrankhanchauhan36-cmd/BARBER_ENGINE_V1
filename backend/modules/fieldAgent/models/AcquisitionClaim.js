/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/AcquisitionClaim.js
 *
 * FA-5.3 — the authoritative record of which Field Agent validly
 * acquired a given Salon. Deliberately independent of Area (WHERE the
 * Salon is) and CommercialTerritory/TerritoryAssignment (WHO
 * commercially operates that geography) — this model answers exactly
 * one question: "who validly acquired this salon?" No field here
 * references CommercialTerritory or TerritoryAssignment; no field on
 * Salon references this collection either (confirmed by repo-wide
 * audit that Salon carries zero acquisition semantics, and Salon
 * remains explicitly unmodified by this phase).
 *
 * salonRef/fieldAgentRef are immutable after creation. Created only
 * via acquisitionClaim.service.js#redeemReferral — never by an
 * endpoint that accepts a client-supplied salonRef or fieldAgentRef.
 *
 * "Authoritative attribution" is a DERIVED fact
 * (status === ACTIVE && salon.approval.status === APPROVED),
 * deliberately never persisted here — Salon's own approval.status is
 * never read into this model, and no background job keeps anything in
 * sync. If a territory later suspends/retires/reassigns, this record
 * is never rewritten (locked decision) — there is structurally no way
 * for it to be, since no territory reference exists to react to.
 *
 * stateRef/districtRef are a denormalized, write-once snapshot of the
 * Salon's own geography at claim-creation time, used ONLY for
 * admin-scoped listing performance — never re-synced, never treated as
 * a second source of truth for Salon geography (Salon.location.territory
 * remains authoritative for that).
 */

import mongoose from "mongoose";
import { CLAIM_STATUS, CLAIM_END_REASON } from "../constants/acquisitionClaim.constants.js";

const AcquisitionClaimSchema = new mongoose.Schema(
  {
    salonRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
    },

    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
    },

    // Traceability only — never read by any business-logic check.
    referralRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcquisitionReferral",
      default: null,
    },

    status: {
      type: String,
      enum: Object.values(CLAIM_STATUS),
      required: true,
      default: CLAIM_STATUS.ACTIVE,
    },

    // Explicit `null` in the enum list — same reason as
    // FieldAgent.commercialPath/TerritoryAssignment.endReason.
    endedReason: {
      type: String,
      enum: [...Object.values(CLAIM_END_REASON), null],
      default: null,
    },

    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    endedAt: { type: Date, default: null },

    // Denormalized snapshot, admin-scoping only — see file header.
    stateRef: { type: mongoose.Schema.Types.ObjectId, ref: "State", default: null },
    districtRef: { type: mongoose.Schema.Types.ObjectId, ref: "District", default: null },
  },
  { timestamps: true }
);

// The sole correctness authority for "at most one ACTIVE claim per
// salon" — a single-collection, single-key partial unique index. No
// transaction is required for this invariant on its own (unlike
// FA-5.2's cross-scope-type overlap problem) — a plain insert against
// this index is already atomic and correct across any number of
// backend instances.
AcquisitionClaimSchema.index(
  { salonRef: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: CLAIM_STATUS.ACTIVE } }
);

// "My claims" listing — NOT unique: one FieldAgent legitimately holds
// many ACTIVE claims across different salons.
AcquisitionClaimSchema.index({ fieldAgentRef: 1, status: 1 });

// Admin review listing.
AcquisitionClaimSchema.index({ status: 1, createdAt: -1 });

// STATE/DISTRICT admin scoped listing — mirrors CommercialTerritory's
// own identical pattern.
AcquisitionClaimSchema.index({ districtRef: 1, status: 1 });
AcquisitionClaimSchema.index({ stateRef: 1, status: 1 });

// Full claim history for one salon regardless of status — the partial
// index above only serves status:"ACTIVE" queries.
AcquisitionClaimSchema.index({ salonRef: 1, createdAt: -1 });

// FA-15 Phase B — scale hardening. adminListClaims (acquisitionClaim.
// service.js) runs with an EMPTY filter for an INDIA admin with no
// status/fieldAgentRef given, sorted { createdAt: -1 }. None of the
// compound indexes above have createdAt as a sole/leading key, so none
// can serve that specific query+sort — {status,createdAt} is ordered
// by status first, not a global createdAt ordering. Without this,
// that admin view degrades into a collection scan + in-memory sort at
// scale. Additive only — does not replace or duplicate any index above.
AcquisitionClaimSchema.index({ createdAt: -1 });

export default mongoose.models.AcquisitionClaim ||
  mongoose.model("AcquisitionClaim", AcquisitionClaimSchema);
