/**
 * BARBER ENGINE V1
 * backend/modules/support/services/slaEscalation.service.js
 *
 * Phase G Step 7 — SLA breach escalation: decision + state + audit.
 * No Socket.IO (Step 9), no auto-reassignment, no priority change —
 * none of those exist in this file.
 *
 * PHASE G STEP 8 ADDITION — one call only, at the very end of
 * escalateSlaBreach(), after its audit write: notifySlaEscalation()
 * (./slaNotification.service.js), passing through the exact
 * teamLeadRef this function already resolved. Nothing else in this
 * file changed — the idempotency reasoning below, the recipient
 * resolution, and the ESCALATED audit event are all untouched.
 *
 * IDEMPOTENCY: this function is called from exactly one place —
 * jobs/slaScanner.job.js's flipEventStateAndAudit(), and only on the
 * branch where a BREACHED event's atomic flip has JUST succeeded
 * (kind === "BREACHED" && the updateOne actually matched). That
 * atomic flip is an unmodified Phase G Step 6 mechanism
 * (SupportTicket.updateOne with a `field: null` filter guard) which
 * already guarantees "this dimension's breach was newly detected,
 * exactly once, ever" — escalation inherits that same exactly-once
 * guarantee for free. No new SupportTicket field was added for
 * escalation state: the existing G.6 firstResponseBreachedAt/
 * resolutionBreachedAt flags ARE the escalation idempotency
 * mechanism, proven sufficient by this reasoning rather than assumed.
 *
 * RECIPIENT RESOLUTION — grounded in direct inspection, not invented:
 *   - "Team Lead" is never a User.role. Confirmed by socket/index.js's
 *     own comment ("Team Lead is derived, never a role... the only
 *     role that can ever lead a SupportTeam is AGENT") — it is
 *     SupportTeam.teamLeadRef, resolved here from the ticket's own
 *     currentAssignment.teamRef. Resolved LIVE (read at escalation
 *     time), not snapshotted — a team's lead can change after a
 *     ticket is routed there, and using the current lead is correct:
 *     unlike the immutable SLA deadline, who currently leads the team
 *     is a live routing fact, not part of ticket history.
 *   - SUPPORT_ADMIN is a User.role (models/User.js's role enum) with
 *     no fixed member list — recorded here as a role marker only.
 *     This file never queries User by role and never sends anything
 *     to anyone; resolving that role into actual recipients (or
 *     reusing the existing "supportAdmin" Socket.IO room, confirmed
 *     in socket/index.js) is explicitly Phase G Step 8/9's job.
 */

import SupportTeam from "../models/SupportTeam.js";
import { ACTOR_TYPE, AUDIT_ACTION } from "../constants/support.constants.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { notifySlaEscalation } from "./slaNotification.service.js";

/**
 * Records an ESCALATED audit event for a newly-detected SLA breach.
 * Pure orchestration: one read (the ticket's current team lead, if
 * any) plus one audit write (plus, as of Step 8, one delegated
 * notification/socket call — see below). Never touches SupportTicket
 * itself, never reassigns, never changes priority.
 *
 * @param {object} params
 * @param {object} params.ticket - the ticket being escalated; needs
 *   at least `_id` and `currentAssignment.teamRef`.
 * @param {"FIRST_RESPONSE"|"RESOLUTION"} params.dimension
 * @param {object} params.timerResult - the G.5 evaluateTicketSla()
 *   timer result for this dimension (dueAt/percentConsumed/
 *   effectiveElapsedMs) — carried through for audit-trail context
 *   only, never recomputed here.
 * @param {import("socket.io").Server|null} [params.io] - passed
 *   straight through to notifySlaEscalation(); this function performs
 *   no socket logic of its own.
 * @returns {{ escalated: true, teamLeadRef: string|null }}
 */
export async function escalateSlaBreach({ ticket, dimension, timerResult, io = null }) {
  const teamRef = ticket?.currentAssignment?.teamRef || null;

  let teamLeadRef = null;
  if (teamRef) {
    const team = await SupportTeam.findById(teamRef).select("teamLeadRef").lean();
    teamLeadRef = team?.teamLeadRef || null;
  }

  await recordSupportAuditEvent({
    ticketRef: ticket._id,
    actorRef: null,
    actorType: ACTOR_TYPE.SYSTEM,
    action: AUDIT_ACTION.ESCALATED,
    entityId: ticket._id,
    newValue: {
      dimension, // "FIRST_RESPONSE" | "RESOLUTION" — keeps the two dimensions distinguishable, same convention as G.6's SLA_BREACHED event
      percentConsumed: timerResult?.percentConsumed ?? null,
      effectiveElapsedMs: timerResult?.effectiveElapsedMs ?? null,
      dueAt: timerResult?.dueAt ?? null,
      recipients: {
        teamLeadRef,
        roles: ["SUPPORT_ADMIN"],
      },
    },
    reason: `Automated SLA escalation — ${dimension === "FIRST_RESPONSE" ? "first response" : "resolution"} breach detected by the SLA scanner`,
  });

  // Phase G Step 8 — notify, gated by the same already-exactly-once
  // condition this whole function only ever runs under (see the
  // file-level Step 8 addition note above).
  await notifySlaEscalation({ ticket, dimension, timerResult, teamLeadRef, io });

  return { escalated: true, teamLeadRef };
}
