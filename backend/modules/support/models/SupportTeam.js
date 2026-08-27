/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportTeam.js
 *
 * Phase F.1 — schema only. Deliberately carries no categoryRefs and
 * no geography (Phase F §4): both are derivable from the team's
 * owned SupportQueue rows and SupportCoverage respectively — storing
 * either here would create a second, driftable source of truth.
 */

import mongoose from "mongoose";

const supportTeamSchema = new mongoose.Schema(
  {
    teamCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: null, maxlength: 1000 },

    // The RBAC anchor for TEAM_LEAD (Phase F §18) — a derived
    // permission ("is this user this team's lead"), not a
    // User.role value.
    teamLeadRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isActive: { type: Boolean, default: true },

    // No BusinessHours collection exists yet — plain ObjectId, no
    // `ref:`, same forward-compatibility idiom used across Support.
    businessHoursRef: { type: mongoose.Schema.Types.ObjectId, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Approved Phase F.1 index — unique active teamCode only.
supportTeamSchema.index(
  { teamCode: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.models.SupportTeam || mongoose.model("SupportTeam", supportTeamSchema);
