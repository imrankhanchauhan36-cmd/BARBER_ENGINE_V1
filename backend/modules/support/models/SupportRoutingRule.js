/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportRoutingRule.js
 *
 * Phase E.1 — Geographic Routing + Coverage. Schema foundation only —
 * no rule-evaluation service logic ships until Phase E.2.
 *
 * Every match dimension (geography, category, priority, language,
 * requester type) is independently optional — empty/null means
 * wildcard, per the approved Phase E specification. Geography reuses
 * the same Country/State/District/City/Area ObjectId refs as
 * SupportCoverage; no second geography model, no per-rule
 * geographic-consistency constraint (unlike Coverage, a rule's geo
 * fields are independent wildcard matchers, not a single scoped
 * assignment). No fallbackRuleRef — fallback is the structural
 * geography walk-up Coverage performs (Phase E §6), not a
 * rule-to-rule chain.
 */

import mongoose from "mongoose";
import { PRIORITY, SUPPORTED_LANGUAGES, REQUESTER_TYPE } from "../constants/support.constants.js";

const supportRoutingRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: null, maxlength: 1000 },

    isActive: { type: Boolean, default: true },
    // Lower evaluates first (Phase E §5) — required so evaluation
    // ordering is never left to insertion order.
    rulePriority: { type: Number, required: true, default: 0 },

    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },

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
    languages: {
      type: [{ type: String, enum: SUPPORTED_LANGUAGES }],
      default: [],
    },
    requesterTypes: {
      type: [{ type: String, enum: Object.values(REQUESTER_TYPE) }],
      default: [],
    },

    // SupportQueue/SupportTeam now exist (Phase F.1) — `ref:` added
    // here is metadata only (enables .populate()), no behavior change.
    targetQueueRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportQueue", default: null },
    targetTeamRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTeam", default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

supportRoutingRuleSchema.pre("validate", function (next) {
  if (this.effectiveFrom && this.effectiveTo && this.effectiveTo <= this.effectiveFrom) {
    return next(new Error("effectiveTo must be after effectiveFrom"));
  }
  next();
});

// Approved Phase E.1 index only — no wide optional-dimension compound
// index (Phase E §11: an anti-pattern when every match dimension is
// independently nullable). Application code filters the remaining
// dimensions after this indexed, priority-ordered active-rule scan.
supportRoutingRuleSchema.index({ isActive: 1, rulePriority: 1 });

export default mongoose.models.SupportRoutingRule || mongoose.model("SupportRoutingRule", supportRoutingRuleSchema);
