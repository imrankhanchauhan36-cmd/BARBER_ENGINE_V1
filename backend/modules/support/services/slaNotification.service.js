/**
 * BARBER ENGINE V1
 * backend/modules/support/services/slaNotification.service.js
 *
 * Phase G Step 8 — SLA notification wiring only. No new notification
 * engine, no NotificationService changes, no Socket.IO. This file's
 * only job is to translate an already-recorded SLA warning/breach/
 * escalation into calls against the existing, unmodified
 * NotificationService.send() — the same single public entry point
 * every other notification in this codebase already uses.
 *
 * PAYLOAD SHAPE — copied verbatim from the only two existing Support
 * notification call sites (notifyTicketStatusChanged() and
 * notifyAgentReplyReceived() in supportTicket.service.js): recipientId
 * / recipientType / templateKey / variables / title / message / type
 * / priority / actionType / actionUrl / meta. Nothing new introduced
 * to the payload contract.
 *
 * TEMPLATE FALLBACK — confirmed by reading templateRenderer.service.js:
 * a missing NotificationTemplate row for a templateKey is NOT an
 * error; renderTemplate() falls back to the caller-supplied
 * title/message (logging a harmless "using fallback" warning, the
 * same one already visible for every other Support notification in
 * this codebase's own test output). So SLA_WARNING/SLA_BREACHED/
 * SLA_ESCALATED work correctly with zero NotificationTemplate rows
 * pre-seeded — no operational dependency like G.2's SLA-policy
 * requirement.
 *
 * IDEMPOTENCY — deliberately NO new persistence/dedupe mechanism.
 * Confirmed by direct inspection of models/Notification.js: it has no
 * unique index, no dedupe key, nothing to reuse. Instead, every
 * function here is called from exactly one place, and only inside an
 * ALREADY atomically-gated branch:
 *   - notifySlaWarningOrBreach() is called from
 *     jobs/slaScanner.job.js's flipEventStateAndAudit(), only after
 *     its atomic SupportTicket.updateOne({field: null}, {$set:
 *     {field: now}}) has just succeeded — the exact same proven
 *     exactly-once guard G.3/G.4/G.6 already established.
 *   - notifySlaEscalation() is called from slaEscalation.service.js's
 *     escalateSlaBreach(), which is itself only ever invoked from
 *     that same already-exactly-once branch (Phase G Step 7).
 * A notification call therefore inherits exactly-once for free — no
 * new field was proven necessary, so none was added.
 *
 * FAILURE HANDLING — NotificationService.send() already wraps its
 * entire body in try/catch and NEVER throws (confirmed by reading
 * services/NotificationService.js); a failure there just logs a
 * warning and resolves to null. emitToRoom()/emitToRooms()
 * (socket/index.js) likewise already guard `if (!io) return` and wrap
 * their own body in try/catch — confirmed by reading them — so
 * neither the notification send nor the socket emit can ever throw
 * out of this file on their own. Both exported functions here still
 * wrap the NOTIFICATION portion specifically in its own try/catch
 * (notifySlaEscalation() genuinely needs it, for its own User.find()
 * read, which is not covered by NotificationService's contract at
 * all; notifySlaWarningOrBreach() adds it as a defensive
 * belt-and-suspenders measure even though its only async call there
 * is NotificationService.send() itself). Critically, the socket emit
 * in each function is placed OUTSIDE that try block — a deliberately
 * separate, sibling statement, not nested inside it — so a
 * notification-side failure (real or hypothetical) can never suppress
 * the socket broadcast, and vice versa (the socket call structurally
 * cannot throw, so it could never suppress anything either way). This
 * mirrors every existing paired notification+socket call site
 * elsewhere in this module (e.g. supportTicket.service.js's
 * waitForUserAgentOwnTicket(), which always calls emitToRooms() and
 * notify...() as two separate statements, never one wrapping the
 * other) — not a new pattern invented for SLA. Both functions are
 * called strictly AFTER the SLA state/audit write has already
 * committed, so a failure in either the notification or the socket
 * path cannot reverse or lose anything already recorded, and neither
 * can prevent unrelated LATER writes in the same scan from being
 * attempted (e.g. the BREACHED flip immediately following a WARNING
 * notification failure).
 *
 * RECIPIENTS:
 *   - Warning/breach: the ticket's currently assigned agent
 *     (currentAssignment.agentRef) — the existing, established
 *     "who currently owns this ticket" concept used throughout every
 *     prior Support phase. If no agent is currently assigned (ticket
 *     still QUEUED), there is no "currently responsible" individual
 *     to notify — no notification is sent and no fallback recipient
 *     is invented. This is a deliberate scope decision, disclosed in
 *     the Step 8 report, not a silent gap.
 *   - Escalation: exactly the recipient data Step 7 already produces
 *     — `teamLeadRef` (a specific user, when non-null) plus every
 *     current User with role "SUPPORT_ADMIN" (a live role query, the
 *     same "role is live membership, not a fixed list" principle
 *     already established by socket/index.js's own "supportAdmin"
 *     room and by resolveAdminScope()'s own live SupportTeam query —
 *     not a new recipient hierarchy).
 *   - recipientType: "STAFF" for all three recipient kinds (agent,
 *     team lead, SUPPORT_ADMIN) — the closest existing fit in
 *     Notification.js's recipientType enum (["USER","SALON","ADMIN",
 *     "STAFF"]) for an internal Support-side actor; "ADMIN" was ruled
 *     out because that value is already used for the distinct
 *     platform-wide ADMIN role, and SUPPORT_ADMIN is a materially
 *     different role from it (confirmed in models/User.js's own role
 *     enum, which lists them separately).
 *
 * SOCKET.IO — added alongside this same phase's notification wiring,
 * reusing the exact existing primitives, no new room/auth logic:
 *   - emitToRoom() (socket/index.js) — already has its own `if (!io)
 *     return` guard and its own try/catch (confirmed by reading it),
 *     so calling it is inherently crash-proof; no additional error
 *     handling was added on this side for the same reason
 *     NotificationService.send() needed none of its own.
 *   - staffRooms()/emitToRooms() (supportTicket.service.js) — the
 *     exact same room-fanout helpers every other Support socket event
 *     already uses (agent's own user:{id} room, supportTeam:{teamId},
 *     and unconditionally "supportAdmin"), now exported for reuse
 *     here rather than duplicated. Using this same helper for ALL
 *     THREE emit points (warning/breach/escalation) — including
 *     escalation — is a deliberate, disclosed choice: it means the
 *     escalated ticket's own agent room also receives the ambient
 *     socket broadcast, even though that same agent is deliberately
 *     EXCLUDED from the persisted IN_APP escalation notification
 *     above. This mirrors how every existing Support socket event
 *     already treats "who sees a live update" (staffRooms, broadcast)
 *     as a different concern from "who gets a persisted Notification
 *     record" (a specific, narrower recipient list) — not a new
 *     distinction invented for SLA.
 *   - Three new event names, following the exact existing
 *     `support:<category>:<eventName>` convention (confirmed against
 *     every existing Support event: support:ticket:statusChanged,
 *     support:ticket:assigned, support:message:new, etc.):
 *     support:sla:warning, support:sla:breached, support:sla:escalated.
 *   - `io` is threaded as a plain parameter through every function in
 *     this chain (slaScanner.job.js -> slaEscalation.service.js ->
 *     here), exactly like every existing job that emits sockets
 *     (startServiceOverdueJob(io), startHoldExpiryJob(io)) — never a
 *     module-level singleton.
 *   - No duplicate emits on repeated scans: both emit call sites sit
 *     inside the exact same already-atomically-gated branches as the
 *     notification calls above, so they inherit the identical
 *     exactly-once guarantee — no new mechanism.
 */

import User from "../../../models/User.js";
import NotificationService from "../../../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../../../modules/notifications/constants/notificationEvents.constants.js";
import { staffRooms, emitToRooms } from "./supportTicket.service.js";

const DIMENSION_LABEL = {
  FIRST_RESPONSE: "first response",
  RESOLUTION: "resolution",
};

/**
 * Notifies the ticket's currently assigned agent of a newly-detected
 * SLA warning or breach. No-op (returns without calling
 * NotificationService at all) when no agent is currently assigned —
 * see the file-level comment for why no fallback recipient is
 * invented here.
 *
 * @param {object} params
 * @param {object} params.ticket - needs _id, ticketNumber,
 *   currentAssignment.agentRef.
 * @param {"WARNING"|"BREACHED"} params.kind
 * @param {"FIRST_RESPONSE"|"RESOLUTION"} params.dimension
 * @param {object} params.timerResult - the G.5 timer result for this
 *   dimension, carried through for notification `meta` only.
 * @param {import("socket.io").Server|null} [params.io] - passed
 *   through unchanged from the scanner; emitToRoom's own internal
 *   `if (!io) return` guard makes a null io a safe, silent no-op.
 */
export async function notifySlaWarningOrBreach({ ticket, kind, dimension, timerResult, io = null }) {
  const agentRef = ticket?.currentAssignment?.agentRef || null;
  // Deliberately paired: no assigned agent means neither the IN_APP
  // notification NOR the socket broadcast fires for warning/breach —
  // kept symmetric with the notification's own "no fallback recipient
  // invented" scope decision rather than giving the socket event a
  // separate, broader trigger condition.
  if (!agentRef) return null;

  const dimensionLabel = DIMENSION_LABEL[dimension] || dimension;
  const isBreach = kind === "BREACHED";
  const eventPayload = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    dimension,
    percentConsumed: timerResult?.percentConsumed ?? null,
    effectiveElapsedMs: timerResult?.effectiveElapsedMs ?? null,
    dueAt: timerResult?.dueAt ?? null,
  };

  // Notification and socket emission are deliberately INDEPENDENT
  // sibling operations, not nested — matching every existing paired
  // notification+socket call site elsewhere in this module (e.g.
  // waitForUserAgentOwnTicket()'s emitToRooms()+notify...() pair),
  // which are always two separate statements, never one wrapping the
  // other. Wrapped in its own try/catch even though
  // NotificationService.send() is confirmed to never throw (its own
  // top-level try/catch) — this guards against a hypothetical
  // violation of that contract instead of merely assuming it holds,
  // AND ensures a notification failure can never suppress the
  // socket emit below it (nesting them would have let an exception
  // here skip that line entirely).
  let result = null;
  try {
    result = await NotificationService.send({
      recipientId: agentRef,
      recipientType: "STAFF",
      templateKey: isBreach ? NOTIFICATION_EVENTS.SLA_BREACHED : NOTIFICATION_EVENTS.SLA_WARNING,
      variables: { ticketNumber: ticket.ticketNumber, dimension, kind },
      title: isBreach ? "SLA breached" : "SLA warning",
      message: isBreach
        ? `Ticket ${ticket.ticketNumber} has breached its ${dimensionLabel} SLA deadline.`
        : `Ticket ${ticket.ticketNumber} is approaching its ${dimensionLabel} SLA deadline.`,
      type: "SYSTEM",
      priority: isBreach ? "CRITICAL" : "HIGH",
      actionType: null,
      actionUrl: null,
      meta: { ...eventPayload, kind },
    });
  } catch (err) {
    console.warn("[slaNotification] notifySlaWarningOrBreach (notification) failed (non-critical):", err.message);
  }

  // emitToRoom()/emitToRooms() already have their own internal
  // try/catch and `if (!io) return` guard (confirmed by reading
  // socket/index.js), so no additional wrapping is needed here — this
  // call structurally cannot throw.
  emitToRooms(
    io,
    staffRooms({ agentRefs: [agentRef], teamRef: ticket.currentAssignment?.teamRef || null }),
    isBreach ? "support:sla:breached" : "support:sla:warning",
    eventPayload
  );

  return result;
}

/**
 * Notifies a ticket's escalation recipients — its current team lead
 * (when one exists) and every current SUPPORT_ADMIN user. Consumes
 * exactly the recipient data Phase G Step 7 already produces; resolves
 * nothing new beyond querying User by the existing "SUPPORT_ADMIN"
 * role value.
 *
 * @param {object} params
 * @param {object} params.ticket - needs _id, ticketNumber.
 * @param {"FIRST_RESPONSE"|"RESOLUTION"} params.dimension
 * @param {object} params.timerResult - the G.5 timer result for this
 *   dimension, carried through for notification `meta` only.
 * @param {string|null} params.teamLeadRef - from Step 7's
 *   escalateSlaBreach() return value.
 * @param {import("socket.io").Server|null} [params.io] - passed
 *   through unchanged; emitToRoom's own internal guard makes a null
 *   io a safe, silent no-op.
 */
export async function notifySlaEscalation({ ticket, dimension, timerResult, teamLeadRef, io = null }) {
  const dimensionLabel = DIMENSION_LABEL[dimension] || dimension;
  const eventPayload = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    dimension,
    percentConsumed: timerResult?.percentConsumed ?? null,
    effectiveElapsedMs: timerResult?.effectiveElapsedMs ?? null,
    dueAt: timerResult?.dueAt ?? null,
    recipients: { teamLeadRef, roles: ["SUPPORT_ADMIN"] },
  };

  // Notification delivery (needs the User.find() read below) and
  // socket emission (needs no DB read at all — staffRooms() is pure)
  // are deliberately INDEPENDENT: the socket emit is placed OUTSIDE
  // this try block entirely, so a User.find() failure can never
  // suppress it — matching notifySlaWarningOrBreach()'s identical
  // sibling-operations structure above, not nested. Wrapped in its
  // own try/catch (unlike that function, which only needs one for
  // defensive belt-and-suspenders reasons) because this function's
  // own User.find() read is genuinely not covered by
  // NotificationService.send()'s own contract at all — this is what
  // makes THIS function never throw, matching the established
  // convention rather than depending on an outer caller's try/catch.
  // Escalation's audit write (slaEscalation.service.js) has already
  // committed by the time this runs, so a failure here can never
  // reverse or lose that already-recorded state.
  let results = null;
  try {
    const recipientIds = new Set();
    if (teamLeadRef) recipientIds.add(String(teamLeadRef));

    const supportAdmins = await User.find({ role: "SUPPORT_ADMIN" }).select("_id").lean();
    for (const admin of supportAdmins) recipientIds.add(String(admin._id));

    const payloadBase = {
      recipientType: "STAFF",
      templateKey: NOTIFICATION_EVENTS.SLA_ESCALATED,
      variables: { ticketNumber: ticket.ticketNumber, dimension },
      title: "SLA escalation",
      message: `Ticket ${ticket.ticketNumber}'s ${dimensionLabel} SLA breach has been escalated.`,
      type: "SYSTEM",
      priority: "CRITICAL",
      actionType: null,
      actionUrl: null,
      meta: {
        ticketId: ticket._id,
        dimension,
        percentConsumed: timerResult?.percentConsumed ?? null,
        effectiveElapsedMs: timerResult?.effectiveElapsedMs ?? null,
        dueAt: timerResult?.dueAt ?? null,
      },
    };

    results = await Promise.all(
      [...recipientIds].map((recipientId) => NotificationService.send({ ...payloadBase, recipientId }))
    );
  } catch (err) {
    console.warn("[slaNotification] notifySlaEscalation (notification) failed (non-critical):", err.message);
  }

  // Same staffRooms() fanout every other Support socket event uses
  // (always includes "supportAdmin" unconditionally — no fixed
  // SUPPORT_ADMIN user is ever named) — deliberately including the
  // ticket's own current agent room here even though that same agent
  // is excluded from the IN_APP recipient list above; see the
  // file-level comment for why that's an existing, established
  // distinction, not new for SLA. emitToRoom()/emitToRooms() already
  // have their own internal try/catch and `if (!io) return` guard, so
  // this call structurally cannot throw.
  emitToRooms(
    io,
    staffRooms({ agentRefs: [ticket.currentAssignment?.agentRef || null], teamRef: ticket.currentAssignment?.teamRef || null }),
    "support:sla:escalated",
    eventPayload
  );

  return results;
}
