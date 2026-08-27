/**
 * BARBER ENGINE V1
 * backend/modules/support/services/ticketLifecycle.service.js
 *
 * Phase C — the ticket state-machine foundation. Frozen per Phase B
 * §6 / Phase C §E: "Phase C should provide the domain/state-transition
 * foundation that later phases can consume." No Routing/Queue/Agent
 * logic lives here — only transition validity + the audited write.
 */

import { Errors } from "../../../utils/response.js";
import { VALID_TRANSITIONS, AUDIT_ACTION } from "../constants/support.constants.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";

export function canTransition(fromStatus, toStatus) {
  const allowed = VALID_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

/**
 * Validates + applies a status transition on an already-loaded
 * SupportTicket document, saves it, and writes the matching audit
 * event — all callers (Phase C's reopen/customer-reply flows today;
 * later phases' routing/assignment/SLA engines) go through this single
 * function so "no arbitrary direct status mutation" (Phase C §E) is
 * enforced in one place, not re-checked ad hoc per caller.
 *
 * auditAction defaults to the generic STATUS_CHANGED, but callers
 * with a more specific action (e.g. REOPENED) can override it so the
 * audit trail records intent, not just the raw before/after status.
 */
export async function transitionTicketStatus(
  { ticket, toStatus, actorRef, actorType, reason = null, extraFields = {}, auditAction = AUDIT_ACTION.STATUS_CHANGED },
  session = null
) {
  const fromStatus = ticket.status;

  if (!canTransition(fromStatus, toStatus)) {
    throw Errors.conflict(`Cannot move ticket from ${fromStatus} to ${toStatus}`);
  }

  ticket.status = toStatus;
  Object.assign(ticket, extraFields);
  await ticket.save(session ? { session } : undefined);

  await recordSupportAuditEvent(
    {
      ticketRef: ticket._id,
      actorRef,
      actorType,
      action: auditAction,
      entityId: ticket._id,
      oldValue: { status: fromStatus },
      newValue: { status: toStatus },
      reason,
    },
    session
  );

  return ticket;
}
