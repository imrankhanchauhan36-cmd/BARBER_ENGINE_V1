import mongoose from "mongoose";

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Free-form String by design (no enum) — but application code must
    // only ever write values from AUDIT_ACTIONS (see auditActions.js)
    // so filtering/analytics stay reliable. The schema stays flexible
    // for future modules; discipline is enforced at the call site.
    action: {
      type: String,
      required: true,
    },
    targetType: {
      type: String, // SALON / ADMIN / DISTRICT / STATE / ...
      required: true,
    },
    // Required by design — this log is for ENTITY actions only (an
    // action taken on a specific State/District/Salon/User/etc.).
    // System-level events with no entity (login, logout, CSV export,
    // dashboard view) belong in a separate security/activity log, not
    // here — mixing the two would force targetId to be optional and
    // weaken every "history for this entity" query.
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    meta: {
      type: Object, // extra info (status, commission, etc.)
      default: {},
    },
    ip: {
      type: String,
      default: null,
    },
    // NEW — browser/client trace, standard alongside IP in production
    // audit trails.
    userAgent: {
      type: String,
      default: null,
    },
    // NEW — correlates every audit entry back to the API request that
    // caused it (matches the requestId already returned by every API
    // response). Lets support/ops trace "what else happened in this
    // exact request" across multiple audit rows.
    requestId: {
      type: String,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

adminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
adminAuditLogSchema.index({ adminId: 1, createdAt: -1 });

export default mongoose.model("AdminAuditLog", adminAuditLogSchema);