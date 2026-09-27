/**
 * BARBER ENGINE V1
 * backend/modules/territoryAutoAssignment/models/SalonTerritoryAssignment.js
 *
 * STEP 5.2 — Territory Auto Assignment Engine. Records which Territory
 * Partner (FieldAgent) is currently linked to a given Salon, and via
 * which CommercialTerritory that link was resolved.
 *
 * DELIBERATELY A NEW, SEPARATE COLLECTION — not a field on Salon itself.
 * This respects the existing, LOCKED FA-5.3 architectural decision on
 * record in AcquisitionClaim.js's own header: "Salon remains explicitly
 * unmodified... no field on Salon references this collection either."
 * That decision exists specifically so Salon never grows extra
 * commercial-attribution fields that could desync from the real
 * source of truth (CommercialTerritory + TerritoryAssignment). This
 * model follows the exact same discipline for the same reason —
 * Salon.js is not touched by this module at all.
 *
 * One document per Salon (unique on salonRef) — a "current link"
 * snapshot, not an append-only history log (unlike TerritoryAssignment,
 * which IS the append-only history this snapshot is resolved from).
 * Written ONLY by TerritoryAutoAssignmentService.js, and ONLY at the
 * single moment a Salon is approved (controllers/salon.controller.js#
 * approveSalon) — see that service's own header for the full flow.
 *
 * READ-ONLY relationship to CommercialTerritory/TerritoryAssignment
 * (FA-5.2): this model and its service never write to either of those
 * collections, never call assignPartner/vacatePartner/activateTerritory/
 * etc. — they are resolved from, never mutated.
 */

import mongoose from "mongoose";
import { SALON_TERRITORY_ASSIGNMENT_SOURCE } from "../constants/territoryAutoAssignment.constants.js";

const SalonTerritoryAssignmentSchema = new mongoose.Schema(
  {
    salonRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
    },

    // The CommercialTerritory (FA-5.2) whose geography covered this
    // salon at resolution time. Read-only reference — never mutated
    // here.
    territoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialTerritory",
      required: true,
    },

    // The Territory Partner — a FieldAgent — currently linked to this
    // salon. Resolved from TerritoryAssignment.fieldAgentRef at the
    // moment of resolution; never itself the source of truth (the live
    // TerritoryAssignment document is).
    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
    },

    assignedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    source: {
      type: String,
      enum: Object.values(SALON_TERRITORY_ASSIGNMENT_SOURCE),
      required: true,
      default: SALON_TERRITORY_ASSIGNMENT_SOURCE.AUTO_ON_APPROVAL,
    },
  },
  { timestamps: true }
);

// One current link per salon — re-resolution (findOneAndUpdate upsert
// in the service) replaces the existing document in place rather than
// ever creating a second one.
SalonTerritoryAssignmentSchema.index({ salonRef: 1 }, { unique: true });

// "Which salons does this Territory Partner currently hold?" — admin/
// reporting lookups.
SalonTerritoryAssignmentSchema.index({ fieldAgentRef: 1 });

// "Which salons currently resolve to this Commercial Territory?"
SalonTerritoryAssignmentSchema.index({ territoryRef: 1 });

export default mongoose.models.SalonTerritoryAssignment ||
  mongoose.model("SalonTerritoryAssignment", SalonTerritoryAssignmentSchema);
