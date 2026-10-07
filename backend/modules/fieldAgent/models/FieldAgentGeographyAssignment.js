/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentGeographyAssignment.js
 *
 * MUST-DO-NOW #5 — PHASE A — canonical Field Agent ADMINISTRATIVE
 * geography. Answers exactly one question: "which State/District is
 * this Field Agent administratively assigned to?" — nothing else.
 *
 * Deliberately NOT TerritoryAssignment/CommercialTerritory: that pair
 * is contractually TERRITORY_PARTNER-only (commercialTerritory.service
 * .js#assignPartner rejects any other commercialPath) and enforces
 * one-active-partner-per-territory exclusivity — neither constraint
 * fits "many Field Agents, of any commercialPath, share a state/
 * district". This model carries no commercialPath, no commission
 * field, no salonRef/acquisitionClaimRef/bookingRef, and must never
 * gate Territory Partner revenue, commission, or payout logic.
 *
 * Exclusivity is enforced entirely by the partial unique index below
 * (one ACTIVE assignment per Field Agent) — the same discipline
 * TerritoryAssignment.js itself already uses for its own ACTIVE
 * exclusivity, not a service-layer pre-check. Reassignment is an
 * explicit END-then-ASSIGN workflow (see fieldAgentGeography.service
 * .js) — ending never deletes or rewrites a row; it remains
 * permanently queryable as history.
 *
 * districtRef is optional by design (State-only assignment is valid);
 * when present it must belong to stateRef (validated at the service
 * layer against District.stateRef — the existing, canonical District
 * -> State relationship already used by commercialTerritory.service
 * .js's own validateGeographyFresh).
 */

import mongoose from "mongoose";

const fieldAgentGeographyAssignmentSchema = new mongoose.Schema(
  {
    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
    },

    stateRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: true,
    },

    districtRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      default: null,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "ENDED"],
      required: true,
      default: "ACTIVE",
    },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    endedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    effectiveFrom: {
      type: Date,
      required: true,
    },

    effectiveUntil: {
      type: Date,
      default: null,
    },

    endReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

// Final concurrency authority — at most one ACTIVE geography
// assignment per Field Agent. Unlimited historical ENDED rows.
// Deliberately NOT unique on {stateRef,districtRef} — many Field
// Agents must be able to share the same State/District.
fieldAgentGeographyAssignmentSchema.index(
  { fieldAgentRef: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);

// Full chronological history per Field Agent (getFieldAgentGeographyHistory).
fieldAgentGeographyAssignmentSchema.index({ fieldAgentRef: 1, effectiveFrom: -1 });

// Future RBAC roster scoping (Phase C) — resolving "which Field
// Agents are ACTIVE in State X / District Y" without a collection
// scan. {indexed} on stateRef/districtRef individually, per the
// model's field-level `index: true`-equivalent requirement, is
// subsumed by this compound index (stateRef-prefix queries use it too).
fieldAgentGeographyAssignmentSchema.index({ stateRef: 1, districtRef: 1, status: 1 });

export default mongoose.models.FieldAgentGeographyAssignment ||
  mongoose.model("FieldAgentGeographyAssignment", fieldAgentGeographyAssignmentSchema);
