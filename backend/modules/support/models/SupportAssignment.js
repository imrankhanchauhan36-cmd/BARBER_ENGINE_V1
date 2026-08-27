/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportAssignment.js
 *
 * Phase F.1 — schema only. The backing source of truth for
 * SupportTicket.currentAssignment (Phase C's denormalized read
 * pointer) — gives it real history, uniqueness, and reassignment
 * tracking, the same way SupportAuditEvent already backs a ticket's
 * event history instead of a single field.
 *
 * Append-only in spirit, like SupportAuditEvent — no isDeleted/
 * createdBy/updatedBy: a row transitions `status` rather than being
 * edited or removed, and `assignedBy` already records the acting
 * actor for each row.
 */

import mongoose from "mongoose";
import { ASSIGNMENT_STATUS, ASSIGNMENT_REASON } from "../constants/support.constants.js";

const supportAssignmentSchema = new mongoose.Schema(
  {
    ticketRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", required: true },
    queueRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportQueue", default: null },
    teamRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTeam", default: null },
    agentRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    status: {
      type: String,
      enum: Object.values(ASSIGNMENT_STATUS),
      required: true,
      default: ASSIGNMENT_STATUS.ACTIVE,
    },

    assignedAt: { type: Date, default: null },
    unassignedAt: { type: Date, default: null },

    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    assignmentReason: {
      type: String,
      enum: Object.values(ASSIGNMENT_REASON),
      default: null,
    },

    // Self-ref chain for reassignment history — the prior
    // SupportAssignment row this one supersedes, if any.
    previousAssignmentRef: { type: mongoose.Schema.Types.ObjectId, ref: "SupportAssignment", default: null },
  },
  { timestamps: true }
);

// Approved Phase F.1 index set only — no extra indexes invented.
supportAssignmentSchema.index(
  { ticketRef: 1 },
  { unique: true, partialFilterExpression: { status: ASSIGNMENT_STATUS.ACTIVE } }
);
supportAssignmentSchema.index({ agentRef: 1, status: 1 });
supportAssignmentSchema.index({ queueRef: 1, status: 1, createdAt: 1 });

export default mongoose.models.SupportAssignment || mongoose.model("SupportAssignment", supportAssignmentSchema);
