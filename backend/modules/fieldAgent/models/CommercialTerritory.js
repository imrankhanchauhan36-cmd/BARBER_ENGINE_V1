/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/CommercialTerritory.js
 *
 * FA-5.2 — the admin-defined commercial operating unit. Deliberately
 * SEPARATE from Area (geography master — "where is this place?"),
 * AreaServiceability ("can ZEMISH service this Area?"), and
 * Salon.location.territory (a pure geography snapshot on a Salon
 * document, proven by repo-wide audit to carry zero commercial
 * semantics) — this model answers exactly one question: "who
 * commercially operates this geography?" None of those three
 * concepts are merged here.
 *
 * scopeType is exactly one of DISTRICT/CITY/AREA_SET — a single
 * Commercial Territory never spans multiple districts or multiple
 * cities in V1 (locked business decision). Ancestor geography refs
 * are always re-validated fresh against the live District/City/Area
 * collections in commercialTerritory.service.js at write time — never
 * trusted from client input, same discipline already proven in
 * areaDiscoveryResolution.controller.js (AREA-2.5.3).
 *
 * scopeKey is a server-computed, deterministic canonical string (see
 * commercialTerritory.service.js#computeScopeKey) used ONLY to enforce
 * "no two DRAFT territories with the identical composition" via the
 * partial unique index below. It plays no role in the ACTIVE-vs-ACTIVE
 * overlap check, which is a district-scoped transactional procedure
 * (see TerritoryActivationLock.js) because that comparison is
 * cross-scope-type and cannot be expressed as a single index.
 *
 * currentAssignmentRef is a denormalized pointer to the live
 * TerritoryAssignment (null while vacant). Vacancy itself is NOT a
 * persisted status — it is derived as
 * (status === ACTIVE && currentAssignmentRef === null), a deliberate
 * single-source-of-truth choice (locked decision) that avoids a status
 * field ever desyncing from the actual assignment state.
 *
 * code is server-generated (CT-YYYYMMDD-XXXXXX), globally unique,
 * immutable after creation — never client-suppliable, see
 * commercialTerritory.service.js#generateTerritoryCode. No route ever
 * accepts a client-supplied code or scopeKey (both `.forbidden()` in
 * the validator).
 */

import mongoose from "mongoose";
import { TERRITORY_SCOPE_TYPE, TERRITORY_STATUS } from "../constants/commercialTerritory.constants.js";

const CommercialTerritorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    // Server-generated only — never client-suppliable, immutable after
    // creation (no update path ever writes this field).
    code: {
      type: String,
      required: true,
      unique: true,
    },

    scopeType: {
      type: String,
      enum: Object.values(TERRITORY_SCOPE_TYPE),
      required: true,
    },

    // Server-computed canonical composition key — see file header.
    scopeKey: {
      type: String,
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
      required: true,
    },

    // Required for CITY/AREA_SET, null for DISTRICT — enforced in the
    // service layer, not a Mongoose cross-field schema validator (the
    // AREA-2.4.1 lesson: `this.scopeType` is unreliable inside
    // findOneAndUpdate — every write here goes through the service's
    // own explicit checks instead).
    cityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
      default: null,
    },

    // Non-empty only for AREA_SET, [] otherwise.
    areaRefs: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Area",
      default: [],
    },

    status: {
      type: String,
      enum: Object.values(TERRITORY_STATUS),
      required: true,
      default: TERRITORY_STATUS.DRAFT,
    },

    currentAssignmentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TerritoryAssignment",
      default: null,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Unified duplicate-DRAFT prevention across all 3 scope types — the
// real concurrency authority (FA-5.2 hardened plan §B), not an
// application read-compare-write. Two concurrent inserts with the
// same scopeKey while both are DRAFT can never both succeed.
CommercialTerritorySchema.index(
  { scopeKey: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: TERRITORY_STATUS.DRAFT } }
);

// ACTIVE-territory overlap candidate lookups (FA-5.2 hardened plan §A)
CommercialTerritorySchema.index({ status: 1, scopeType: 1, districtRef: 1 });
CommercialTerritorySchema.index({ status: 1, scopeType: 1, cityRef: 1 });
CommercialTerritorySchema.index({ status: 1, scopeType: 1, areaRefs: 1 });

// STATE/DISTRICT admin scoped listing
CommercialTerritorySchema.index({ stateRef: 1, status: 1 });
CommercialTerritorySchema.index({ districtRef: 1, status: 1 });

export default mongoose.models.CommercialTerritory ||
  mongoose.model("CommercialTerritory", CommercialTerritorySchema);
