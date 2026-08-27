/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportQueue.js
 *
 * Phase F.1 — Queue + Team + Agent schema foundation. Schema only —
 * no assignment/matching logic ships this phase.
 *
 * Deliberately carries no geography (Phase F §3): SupportCoverage
 * (Phase E) remains the sole geographic authority — a Queue is
 * reached via Coverage/RoutingRule's targetQueueRef, it never
 * re-declares its own territory. categoryRefs IS present here
 * (applicability, same idiom as Coverage/RoutingRule).
 */

import mongoose from "mongoose";

const supportQueueSchema = new mongoose.Schema(
  {
    queueCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: null, maxlength: 1000 },

    categoryRefs: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SupportCategory" }],
      default: [],
    },

    // One queue -> exactly one team (Phase F §7: deterministic
    // ownership) — a queue is never shared by multiple teams.
    ownerTeamRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTeam",
      required: true,
    },

    isActive: { type: Boolean, default: true },

    // A config ceiling only — enforcement is deferred to a future
    // assignment-logic phase, not this schema.
    maxConcurrentTickets: { type: Number, default: null },

    // No BusinessHours collection exists yet — plain ObjectId, no
    // `ref:`, same forward-compatibility idiom as SupportTicket.
    // slaPolicyRef / SupportMessage.deliveryLogRef.
    businessHoursRef: { type: mongoose.Schema.Types.ObjectId, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Approved Phase F.1 index set only.
supportQueueSchema.index(
  { queueCode: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
supportQueueSchema.index({ ownerTeamRef: 1, isActive: 1 });

export default mongoose.models.SupportQueue || mongoose.model("SupportQueue", supportQueueSchema);
