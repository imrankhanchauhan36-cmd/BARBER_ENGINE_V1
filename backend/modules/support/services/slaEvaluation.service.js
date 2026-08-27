/**
 * BARBER ENGINE V1
 * backend/modules/support/services/slaEvaluation.service.js
 *
 * Phase G Step 5 — pure SLA evaluation engine. Deliberately has NO
 * side effects and performs NO database access: given an
 * already-fetched ticket and its resolved policy, it computes the
 * current first-response and resolution SLA state. Safe to call any
 * number of times for the same inputs — it always returns the same
 * result (a pure function of its arguments, `now` included), so
 * there is nothing here to duplicate: no audit event, no
 * notification, no state mutation is ever written by this function.
 * Persisting a warning/breach as a one-time fact — and periodically
 * calling this evaluator against open tickets to discover one —  is
 * Phase G Step 6's job, not this one's; this file has no setInterval,
 * no cron, no scanner.
 *
 * Takes `policy.warningThresholdPercent` rather than the full
 * SupportSlaPolicy shape — that is the only policy field this
 * evaluator needs. The original target durations are NOT re-derived
 * from the policy; they are read directly from the ticket's own
 * immutable G.2 snapshot (`slaTargets.firstResponseDueAt` /
 * `resolutionDueAt`), the actual approved source of truth — this
 * function never recomputes or overwrites that snapshot, matching
 * the locked "do not change the original SLA deadline merely because
 * the ticket is being evaluated" requirement. Callers MUST pass the
 * policy resolved via the ticket's own `slaPolicyRef` (the exact
 * policy in force at creation time), not a freshly re-resolved
 * category policy — the two can differ if an admin edited/replaced
 * the effective policy after this ticket was created, and using a
 * different policy's warningThresholdPercent here would silently
 * reinterpret history.
 *
 * CLOSED/RESOLVED handling: confirmed by direct inspection of
 * assignmentResolution.service.js's resolveTicketAssignment()/
 * closeTicket() that `resolvedAt` is set exactly once, on the
 * RESOLVED transition, and is NEVER cleared afterward — including
 * through a later REOPENED status. Because of that, "resolvedAt is
 * non-null" is NOT a safe signal that a ticket's timers are
 * currently frozen (a REOPENED ticket carries a non-null resolvedAt
 * left over from its earlier resolution while being fully active
 * again). The ticket's own `status` is the correct, authoritative
 * freeze signal instead: elapsed-time calculation freezes at
 * `resolvedAt` only while `status` is RESOLVED or CLOSED, and
 * evaluates against `now` for every other status, including
 * REOPENED — deliberately not inventing reopen-specific
 * recalculation, which remains an explicit later phase, not part of
 * G.5.
 */

import { TICKET_STATUS } from "../constants/support.constants.js";

export const SLA_STATE = Object.freeze({
  // No usable SLA snapshot exists for this timer (e.g. a legacy or
  // malformed ticket missing slaTargets) — never fabricated, always
  // reported explicitly rather than silently defaulting to OK.
  NOT_APPLICABLE: "NOT_APPLICABLE",
  // First-response only: firstRespondedAt already exists, so this
  // timer is no longer pending or breachable, per the locked spec.
  SATISFIED: "SATISFIED",
  OK: "OK",
  WARNING: "WARNING",
  BREACHED: "BREACHED",
});

// The only two statuses whose VALID_TRANSITIONS entries are reachable
// exclusively via resolveTicketAssignment()/closeTicket() — the sole
// writers of resolvedAt/closedAt (support.constants.js, unmodified).
const TERMINAL_STATUSES = new Set([TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED]);

// Effective elapsed time = calendar time since creation, minus every
// paused interval: both already-accumulated ones (totalPausedMs) and,
// if the ticket is currently paused as of the evaluation instant, the
// still-open interval from pausedAt up to that same instant. Using
// the SAME evaluationInstant for the open-pause calculation as for
// the calendar-elapsed calculation is what correctly handles a ticket
// resolved directly out of WAITING_FOR_USER (VALID_TRANSITIONS
// permits WAITING_FOR_USER -> RESOLVED without ever resuming) — the
// open pause is excluded only up to the moment of resolution, not
// beyond it.
function calculateEffectiveElapsedMs({ createdAt, evaluationInstant, pausedAt, totalPausedMs }) {
  const calendarElapsedMs = evaluationInstant.getTime() - createdAt.getTime();
  const openPauseMs =
    pausedAt && pausedAt.getTime() < evaluationInstant.getTime()
      ? evaluationInstant.getTime() - pausedAt.getTime()
      : 0;
  const effectiveElapsedMs = calendarElapsedMs - (totalPausedMs || 0) - openPauseMs;
  // Never negative — a same-millisecond edge or clock artifact should
  // read as "just started", not a fabricated negative duration.
  return Math.max(0, effectiveElapsedMs);
}

// Shared by both the first-response and resolution dimensions — the
// only difference between them is which dueAt/effectiveElapsedMs they
// are called with (first-response additionally short-circuits to
// SATISFIED before ever calling this, see evaluateTicketSla below).
function evaluateTimer({ dueAt, createdAt, effectiveElapsedMs, warningThresholdPercent }) {
  if (!dueAt) {
    return {
      status: SLA_STATE.NOT_APPLICABLE,
      dueAt: null,
      targetDurationMs: null,
      effectiveElapsedMs: null,
      percentConsumed: null,
    };
  }

  const targetDurationMs = dueAt.getTime() - createdAt.getTime();
  if (!(targetDurationMs > 0)) {
    // Defensive only — G.1's validator requires positive minutes for
    // every priority target, so a non-positive duration should be
    // unreachable in practice. Reported as an immediate breach rather
    // than dividing by zero or fabricating a duration.
    return {
      status: SLA_STATE.BREACHED,
      dueAt,
      targetDurationMs,
      effectiveElapsedMs,
      percentConsumed: 100,
    };
  }

  const percentConsumed = (effectiveElapsedMs / targetDurationMs) * 100;

  if (effectiveElapsedMs >= targetDurationMs) {
    return { status: SLA_STATE.BREACHED, dueAt, targetDurationMs, effectiveElapsedMs, percentConsumed };
  }
  if (
    typeof warningThresholdPercent === "number" &&
    !Number.isNaN(warningThresholdPercent) &&
    percentConsumed >= warningThresholdPercent
  ) {
    return { status: SLA_STATE.WARNING, dueAt, targetDurationMs, effectiveElapsedMs, percentConsumed };
  }
  return { status: SLA_STATE.OK, dueAt, targetDurationMs, effectiveElapsedMs, percentConsumed };
}

/**
 * Pure SLA evaluator. No DB access, no writes, no audit events, no
 * notifications, no Socket.IO — safe to call any number of times for
 * the same (ticket, policy, now) with no observable side effects and
 * an identical result every time.
 *
 * @param {object} params
 * @param {object} params.ticket - an already-fetched SupportTicket
 *   (Mongoose document or plain object) with at least: createdAt,
 *   status, firstRespondedAt, resolvedAt, slaTargets.
 * @param {object|null} [params.policy] - the SupportSlaPolicy
 *   resolved via this exact ticket's own slaPolicyRef (not a freshly
 *   re-resolved category policy). Only `.warningThresholdPercent` is
 *   read; may be omitted/null, in which case warning is never
 *   reported for either timer (only OK/BREACHED) — never fabricated.
 * @param {Date} [params.now] - evaluation time; defaults to `new
 *   Date()`. Exposed as a parameter specifically so callers/tests get
 *   a deterministic result.
 * @returns {{
 *   firstResponse: { status: string, dueAt: Date|null, targetDurationMs: number|null, effectiveElapsedMs: number|null, percentConsumed: number|null },
 *   resolution: { status: string, dueAt: Date|null, targetDurationMs: number|null, effectiveElapsedMs: number|null, percentConsumed: number|null },
 *   evaluatedAt: Date,
 * }}
 */
export function evaluateTicketSla({ ticket, policy = null, now = new Date() }) {
  const createdAt = ticket?.createdAt;
  const slaTargets = ticket?.slaTargets || {};
  const status = ticket?.status;
  const warningThresholdPercent = policy?.warningThresholdPercent ?? null;

  if (!createdAt) {
    // No creation timestamp at all — cannot compute anything safely.
    // Unreachable for any real SupportTicket (timestamps:true
    // guarantees createdAt), but this stays a defensive,
    // non-fabricating response rather than a thrown error, matching
    // this function's pure/never-throws contract.
    const notApplicable = {
      status: SLA_STATE.NOT_APPLICABLE,
      dueAt: null,
      targetDurationMs: null,
      effectiveElapsedMs: null,
      percentConsumed: null,
    };
    return { firstResponse: notApplicable, resolution: { ...notApplicable }, evaluatedAt: now };
  }

  const isFrozen = TERMINAL_STATUSES.has(status);
  const evaluationInstant = isFrozen && ticket.resolvedAt ? ticket.resolvedAt : now;

  const effectiveElapsedMs = calculateEffectiveElapsedMs({
    createdAt,
    evaluationInstant,
    pausedAt: slaTargets.pausedAt || null,
    totalPausedMs: slaTargets.totalPausedMs || 0,
  });

  const firstResponse = ticket.firstRespondedAt
    ? {
        status: SLA_STATE.SATISFIED,
        dueAt: slaTargets.firstResponseDueAt || null,
        targetDurationMs: null,
        effectiveElapsedMs: null,
        percentConsumed: null,
      }
    : evaluateTimer({
        dueAt: slaTargets.firstResponseDueAt || null,
        createdAt,
        effectiveElapsedMs,
        warningThresholdPercent,
      });

  const resolution = evaluateTimer({
    dueAt: slaTargets.resolutionDueAt || null,
    createdAt,
    effectiveElapsedMs,
    warningThresholdPercent,
  });

  return { firstResponse, resolution, evaluatedAt: now };
}
