/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportAuditEvent.js
 *
 * Phase C — Support Core. Frozen per Phase B §3 Decision 1 / §5.
 *
 * Deliberately a SEPARATE collection from AdminAuditLog, not a reuse
 * or extension of it — same {actor,timestamp,action,entity,oldValue,
 * newValue,reason} shape, but a different bounded context (customer-
 * interaction operational record vs. admin-geography governance
 * record), a materially different actor set (customer/agent/admin/
 * system vs. admin-only), and a much higher expected volume. Mixing
 * the two would degrade both. Append-only — nothing in this module
 * ever updates a written event.
 */

import mongoose from "mongoose";
import { ACTOR_TYPE, AUDIT_ACTION } from "../constants/support.constants.js";

const supportAuditEventSchema = new mongoose.Schema(
  {
    ticketRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },

    actorRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorType: {
      type: String,
      enum: Object.values(ACTOR_TYPE),
      required: true,
    },

    action: {
      type: String,
      enum: Object.values(AUDIT_ACTION),
      required: true,
    },

    // Phase C only ever writes entityType:"SupportTicket" — kept
    // generalized per the frozen spec so later phases (e.g. an audit
    // event scoped to a SupportTeam config change) don't need a new
    // collection.
    entityType: { type: String, default: "SupportTicket" },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    reason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

// Approved Phase-C index only — {action,createdAt} cross-ticket
// analytics index explicitly deferred until a real reporting consumer exists.
supportAuditEventSchema.index({ ticketRef: 1, createdAt: 1 });

export default mongoose.models.SupportAuditEvent || mongoose.model("SupportAuditEvent", supportAuditEventSchema);
