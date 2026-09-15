/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentComplianceAuditEvent.js
 *
 * FA-12.1 — dedicated, immutable audit trail for the FA-12 compliance
 * domain. Mirrors FieldAgentAuditEvent's own {actorRef, actorType,
 * action, entityType, entityId, oldValue, newValue, reason, timestamp}
 * FIELD SHAPE and naming convention exactly — but deliberately does
 * NOT reuse AdminAuditLog (locked decision; the fieldAgent module's own
 * established practice is always a dedicated per-domain collection —
 * see FieldAgentAuditEvent.js's and TrainingAuditEvent.js's own headers
 * for the identical precedent).
 *
 * IMMUTABILITY — deliberately STRICTER than FieldAgentAuditEvent's own
 * (which is append-only by convention only, no blocking hook, per its
 * own header comment). This collection uses the hard blockMutation
 * pattern instead, because it is the audit trail for disciplinary
 * actions specifically — an authoritative record of exactly what
 * happened and when must never be alterable, even by the convention
 * that governs lower-stakes module audit trails elsewhere. This is an
 * explicit FA-12 design choice, not an oversight.
 *
 * actorType is always ADMIN in FA-12 — unlike the broader
 * FieldAgentAuditEvent.AUDIT_ACTOR_TYPE enum it mirrors the shape of,
 * this domain has no AGENT/APPLICANT/SYSTEM actor: every FA-12 action
 * is an admin filing evidence or making a case decision.
 */

import mongoose from "mongoose";
import { FA12_AUDIT_ENTITY_TYPE, FA12_AUDIT_ACTOR_TYPE, FA12_AUDIT_ACTION, AUDIT_REASON_MAX_LENGTH } from "../constants/compliance.constants.js";

const fieldAgentComplianceAuditEventSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: Object.values(FA12_AUDIT_ENTITY_TYPE),
      required: true,
      immutable: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },

    actorRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    actorType: {
      type: String,
      enum: Object.values(FA12_AUDIT_ACTOR_TYPE),
      required: true,
      immutable: true,
    },

    action: {
      type: String,
      enum: Object.values(FA12_AUDIT_ACTION),
      required: true,
      immutable: true,
    },

    // Small, structured snapshots (e.g. {status: "OPEN"}) — never a
    // raw Mixed dump of an entire source/case document.
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },

    reason: { type: String, default: null, maxlength: AUDIT_REASON_MAX_LENGTH, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

fieldAgentComplianceAuditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

//////////////////////////////////////////////////////////////
// Immutable — see file header for why this is stricter than
// FieldAgentAuditEvent's own convention-only immutability.
//////////////////////////////////////////////////////////////
const blockMutation = function () {
  throw new Error("FieldAgentComplianceAuditEvent entries are immutable — they cannot be updated or deleted.");
};
fieldAgentComplianceAuditEventSchema.pre("save", function (next) {
  if (!this.isNew) return next(blockMutation());
  next();
});
fieldAgentComplianceAuditEventSchema.pre("updateOne", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("updateMany", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("findOneAndUpdate", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("deleteOne", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("deleteMany", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("findOneAndDelete", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("replaceOne", blockMutation);
fieldAgentComplianceAuditEventSchema.pre("findOneAndReplace", blockMutation);

export default mongoose.models.FieldAgentComplianceAuditEvent ||
  mongoose.model("FieldAgentComplianceAuditEvent", fieldAgentComplianceAuditEventSchema);
