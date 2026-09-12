/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentAuditEvent.js
 *
 * FA-2 — module-scoped audit trail, deliberately a SEPARATE collection
 * from AdminAuditLog, mirroring modules/support/models/SupportAuditEvent.js's
 * own documented rationale exactly: same {actor, action, entity,
 * oldValue, newValue, reason, timestamp} shape, but a different
 * bounded context and a materially different (and eventually much
 * higher-volume) actor set than admin-geography governance events.
 *
 * Append-only by convention (same as SupportAuditEvent — no code path
 * in this module ever updates a written event; not schema-enforced via
 * a blocking pre-hook, matching the exact precedent being mirrored
 * rather than introducing a stricter mechanism only the financial
 * ledger models use).
 */

import mongoose from "mongoose";
import { AUDIT_ACTOR_TYPE, AUDIT_ACTION } from "../constants/fieldAgent.constants.js";

const fieldAgentAuditEventSchema = new mongoose.Schema(
  {
    // Kept as a free-form string default (not a strict closed enum),
    // matching SupportAuditEvent's own generalization rationale — FA-2
    // only ever writes "APPLICATION", later phases add more entity
    // types without ever needing to touch this field's definition.
    entityType: { type: String, default: "APPLICATION" },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },

    actorRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorType: {
      type: String,
      enum: Object.values(AUDIT_ACTOR_TYPE),
      required: true,
    },

    action: {
      type: String,
      enum: Object.values(AUDIT_ACTION),
      required: true,
    },

    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    reason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

fieldAgentAuditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
fieldAgentAuditEventSchema.index({ actorRef: 1, createdAt: -1 });

export default mongoose.models.FieldAgentAuditEvent ||
  mongoose.model("FieldAgentAuditEvent", fieldAgentAuditEventSchema);
