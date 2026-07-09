// BARBER ENGINE V1
// backend/utils/auditLog.js
//
// Best-effort audit writer. Deliberately swallows its own errors —
// a failed audit write must NEVER fail the business operation it's
// describing (e.g. a District update should still succeed even if
// Mongo hiccups on the audit insert). Callers fire-and-forget this;
// it does not participate in the caller's transaction.

import AdminAuditLog from "../models/AdminAuditLog.js";

export async function logAdminAction({
  adminId, action, targetType, targetId, meta = {}, req = null,
}) {
  try {
    await AdminAuditLog.create({
      adminId,
      action,
      targetType,
      targetId,
      meta,
      ip:        req?.ip || req?.headers?.["x-forwarded-for"] || null,
      userAgent: req?.headers?.["user-agent"] || null,
      requestId: req?.requestId || req?.id || null,
    });
  } catch (err) {
    // Intentionally silent beyond a log line — see note above.
    console.error("[auditLog] failed to write audit entry:", err.message);
  }
}