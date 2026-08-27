/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportAgentProfile.js
 *
 * Phase F.1 — schema only. Kept separate from User by design
 * (Phase F §5): Support-specific configuration stays off the shared,
 * cross-domain User document, mirroring how SupportAuditEvent stays
 * separate from AdminAuditLog. userRef is the 1:1 link to an
 * authenticated User (role: AGENT) — no second authentication system.
 *
 * Deliberately has NO currentActiveTicketCount field — live workload
 * is meant to be computed against SupportAssignment at decision time,
 * never denormalized here (District.js's own header comment already
 * warns against trusting a denormalized counter as source of truth).
 */

import mongoose from "mongoose";
import { SUPPORTED_LANGUAGES, AGENT_AVAILABILITY_STATUS } from "../constants/support.constants.js";

const supportAgentProfileSchema = new mongoose.Schema(
  {
    userRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Agent -> Team references (Phase F §6) — never Team -> Agent
    // arrays, to avoid an unbounded array on Team as agent counts
    // scale Pan-India.
    teamRefs: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SupportTeam" }],
      default: [],
    },
    primaryTeamRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTeam", default: null },

    categoryRefs: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SupportCategory" }],
      default: [],
    },
    languages: {
      type: [{ type: String, enum: SUPPORTED_LANGUAGES }],
      default: [],
    },

    isActive: { type: Boolean, default: true },

    // A config ceiling only — enforcement is deferred to a future
    // assignment-logic phase, not this schema.
    maxActiveTickets: { type: Number, default: null },

    // Durable, admin/agent-controlled state, persisted here. The
    // fast-changing AVAILABLE/BUSY presence signal is designed
    // (Phase F §11) to live in Redis, not this field — no Redis
    // logic is implemented this phase.
    availabilityStatus: {
      type: String,
      enum: Object.values(AGENT_AVAILABILITY_STATUS),
      default: AGENT_AVAILABILITY_STATUS.OFFLINE,
    },

    // No BusinessHours collection exists yet — plain ObjectId, no
    // `ref:`, same forward-compatibility idiom used across Support.
    businessHoursRef: { type: mongoose.Schema.Types.ObjectId, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Approved Phase F.1 index set only.
supportAgentProfileSchema.index(
  { userRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
supportAgentProfileSchema.index({ teamRefs: 1, isActive: 1 });

export default mongoose.models.SupportAgentProfile || mongoose.model("SupportAgentProfile", supportAgentProfileSchema);
