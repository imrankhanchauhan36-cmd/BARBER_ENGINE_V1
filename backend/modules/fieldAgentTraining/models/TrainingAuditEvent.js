/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/models/TrainingAuditEvent.js
 *
 * FA-3.3 — module-scoped, append-only audit trail. Deliberately a
 * SEPARATE collection from FieldAgentAuditEvent (FA-2) and
 * AdminAuditLog, mirroring the exact same rationale FA-2 itself used
 * for splitting off from AdminAuditLog: same {actor, action, entity,
 * oldValue, newValue, reason, timestamp} shape
 * (modules/fieldAgent/models/FieldAgentAuditEvent.js), different
 * bounded context.
 *
 * Also carries every MEDIA_ACCESS_GRANTED event (see
 * mediaDelivery.service.js) — the approved plan's required
 * "auditability/access history" control for proprietary training
 * media, given that authorized screenshotting/recording can't be
 * technically prevented.
 */

import mongoose from "mongoose";
import { TRAINING_AUDIT_ACTOR_TYPE, TRAINING_AUDIT_ACTION, TRAINING_AUDIT_ENTITY_TYPE } from "../constants/fieldAgentTraining.constants.js";

const trainingAuditEventSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: Object.values(TRAINING_AUDIT_ENTITY_TYPE),
      required: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },

    actorRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorType: {
      type: String,
      enum: Object.values(TRAINING_AUDIT_ACTOR_TYPE),
      required: true,
    },

    action: {
      type: String,
      enum: Object.values(TRAINING_AUDIT_ACTION),
      required: true,
    },

    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    reason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

trainingAuditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
trainingAuditEventSchema.index({ actorRef: 1, createdAt: -1 });

// FA-3.3.2.4 — listAuditEvents (trainingContent.service.js), called
// with no entityType/entityId filter (the "recent activity" admin
// view), sorts by createdAt with neither compound index above able to
// serve it — both require a filter prefix this query doesn't supply.
// Index-only addition, no field change.
trainingAuditEventSchema.index({ createdAt: -1 });

export default mongoose.models.TrainingAuditEvent ||
  mongoose.model("TrainingAuditEvent", trainingAuditEventSchema);
