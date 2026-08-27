/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportCoverage.js
 *
 * Phase E.1 — Geographic Routing + Coverage. Schema foundation only —
 * no resolution/walk-up service logic ships until Phase E.2.
 *
 * Reuses the exact same 5-field geography shape SupportTicket.
 * routingSnapshot and Salon.location.territory already use
 * (countryRef/stateRef/districtRef/cityRef/areaRef against the
 * existing Country/State/District/City/Area models) — no scopeRef,
 * no second geography model. Only the fields at-and-above scopeLevel
 * are ever populated; enforced below, not just documented.
 */

import mongoose from "mongoose";
import { SCOPE_LEVEL, FALLBACK_BEHAVIOR, PRIORITY } from "../constants/support.constants.js";

const supportCoverageSchema = new mongoose.Schema(
  {
    scopeLevel: {
      type: String,
      enum: Object.values(SCOPE_LEVEL),
      required: true,
    },

    countryRef: { type: mongoose.Schema.Types.ObjectId, ref: "Country", default: null },
    stateRef: { type: mongoose.Schema.Types.ObjectId, ref: "State", default: null },
    districtRef: { type: mongoose.Schema.Types.ObjectId, ref: "District", default: null },
    cityRef: { type: mongoose.Schema.Types.ObjectId, ref: "City", default: null },
    areaRef: { type: mongoose.Schema.Types.ObjectId, ref: "Area", default: null },

    categoryRefs: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SupportCategory" }],
      default: [],
    },
    priorities: {
      type: [{ type: String, enum: Object.values(PRIORITY) }],
      default: [],
    },

    isActive: { type: Boolean, default: true },

    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },

    // SupportQueue/SupportTeam now exist (Phase F.1) — `ref:` added
    // here is metadata only (enables .populate()), no behavior change.
    targetQueueRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportQueue", default: null },
    targetTeamRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTeam", default: null },

    selectionPriority: { type: Number, default: 0 },

    fallbackBehavior: {
      type: String,
      enum: Object.values(FALLBACK_BEHAVIOR),
      default: FALLBACK_BEHAVIOR.CONTINUE_TO_PARENT,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── Geographic consistency (Phase E §3) ─────────────────────────────
// Exactly the refs at-and-above scopeLevel must be set; every ref
// below scopeLevel must stay null. A COUNTRY-scoped row is not itself
// guaranteed to exist by this schema (that "at least one Central
// Support row" guarantee is a service/configuration-layer concern,
// per the approved spec) — this hook only validates structure.
const SCOPE_LEVEL_ORDER = [
  SCOPE_LEVEL.COUNTRY,
  SCOPE_LEVEL.STATE,
  SCOPE_LEVEL.DISTRICT,
  SCOPE_LEVEL.CITY,
  SCOPE_LEVEL.AREA,
];

const SCOPE_LEVEL_FIELD = {
  [SCOPE_LEVEL.COUNTRY]: "countryRef",
  [SCOPE_LEVEL.STATE]: "stateRef",
  [SCOPE_LEVEL.DISTRICT]: "districtRef",
  [SCOPE_LEVEL.CITY]: "cityRef",
  [SCOPE_LEVEL.AREA]: "areaRef",
};

supportCoverageSchema.pre("validate", function (next) {
  const levelIndex = SCOPE_LEVEL_ORDER.indexOf(this.scopeLevel);
  if (levelIndex === -1) return next(); // invalid enum value — the enum validator reports it

  for (let i = 0; i < SCOPE_LEVEL_ORDER.length; i++) {
    const field = SCOPE_LEVEL_FIELD[SCOPE_LEVEL_ORDER[i]];
    const isRequiredAtThisLevel = i <= levelIndex;

    if (isRequiredAtThisLevel && !this[field]) {
      return next(new Error(`${field} is required for scopeLevel ${this.scopeLevel}`));
    }
    if (!isRequiredAtThisLevel && this[field]) {
      return next(new Error(`${field} must be null for scopeLevel ${this.scopeLevel}`));
    }
  }

  next();
});

supportCoverageSchema.pre("validate", function (next) {
  if (this.effectiveFrom && this.effectiveTo && this.effectiveTo <= this.effectiveFrom) {
    return next(new Error("effectiveTo must be after effectiveFrom"));
  }
  next();
});

// Approved Phase E.1 index set only — one sparse compound index per
// geography level the future walk-up algorithm (Phase E §6/§11)
// queries against. No wide multi-field compound index.
supportCoverageSchema.index({ areaRef: 1, isActive: 1 }, { sparse: true });
supportCoverageSchema.index({ cityRef: 1, isActive: 1 }, { sparse: true });
supportCoverageSchema.index({ districtRef: 1, isActive: 1 }, { sparse: true });
supportCoverageSchema.index({ stateRef: 1, isActive: 1 }, { sparse: true });
supportCoverageSchema.index({ countryRef: 1, isActive: 1 }, { sparse: true });

export default mongoose.models.SupportCoverage || mongoose.model("SupportCoverage", supportCoverageSchema);
