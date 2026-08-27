/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportAudit.service.js
 *
 * Phase C — centralized SupportAuditEvent writer. Every Support
 * action that modifies ticket state must go through this, never
 * `SupportAuditEvent.create(...)` directly, so the audit trail's
 * shape stays consistent (Phase B §F).
 *
 * Unlike utils/auditLog.js's logAdminAction() (fire-and-forget, never
 * participates in the caller's transaction), this DOES accept an
 * optional `session` and writes inside it when passed — Phase C §L
 * explicitly requires ticket-creation's audit event to be part of the
 * same transaction as the ticket/conversation/message writes, since a
 * created-but-unaudited ticket would violate the mandatory immutable-
 * audit-trail requirement. Callers outside a transaction simply omit
 * `session`.
 */

import SupportAuditEvent from "../models/SupportAuditEvent.js";

export async function recordSupportAuditEvent(
  { ticketRef, actorRef = null, actorType, action, entityType = "SupportTicket", entityId = null, oldValue = null, newValue = null, reason = null },
  session = null
) {
  const [event] = await SupportAuditEvent.create(
    [{ ticketRef, actorRef, actorType, action, entityType, entityId, oldValue, newValue, reason }],
    session ? { session } : undefined
  );
  return event;
}
