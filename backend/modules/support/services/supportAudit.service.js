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

/**
 * Phase H Step 8 (follow-up) — read-only audit trail for one ticket.
 * Every Support action already writes here via recordSupportAuditEvent
 * above (confirmed extensively — CREATED/ASSIGNED/REASSIGNED/
 * STATUS_CHANGED/INTERNAL_NOTE/CUSTOMER_REPLY/SLA_WARNING/SLA_BREACHED/
 * ESCALATED/RESOLVED/REOPENED/CLOSED/REFUND_ISSUED/REFUND_DENIED etc.),
 * but no endpoint anywhere ever read it back — this is the first
 * reader. Deliberately admin/SUPPORT_ADMIN-only at the route level
 * (not exposed to AGENT) — some recorded events (e.g. REFUND_ISSUED,
 * ESCALATED's recipient list) are administrative in nature, and an
 * agent's own action history is already visible to them via the
 * message thread and assignment history, so exposing the full event
 * log to every agent would be more than their case actually requires
 * (least-privilege, per the approved design).
 */
export async function listAuditEvents({ ticketId }) {
  return SupportAuditEvent.find({ ticketRef: ticketId })
    .sort({ createdAt: 1 })
    .lean();
}
