/**
 * ============================================================
 * ⏰ SLA SCANNER JOB (Help & Support — Phase G Step 6, extended by Step 7)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Periodically discovers SupportTicket records whose first-response
 * or resolution SLA has newly reached WARNING or BREACHED, and
 * persists each newly detected event exactly once — as an audit
 * event plus an idempotent flip on the ticket's own event-state
 * fields.
 *
 * PHASE G STEP 7 ADDITION — escalation hook only, nothing else in
 * this file changed: whenever a BREACHED flip (not WARNING) actually
 * succeeds — i.e. this dimension's breach was JUST newly detected,
 * exactly once — escalateSlaBreach() (modules/support/services/
 * slaEscalation.service.js) is also called. That existing atomic flip
 * is what makes the escalation call itself exactly-once too; no new
 * SupportTicket field, no change to the eligibility query, batching,
 * cadence, or the G.5 evaluator call. The only other Step 7 change
 * here is adding `currentAssignment` to the candidate `.select(...)`
 * projection below — escalateSlaBreach() needs currentAssignment.
 * teamRef to resolve the ticket's current team lead, and G.6 never
 * had a reason to select that field before now.
 *

 * ARCHITECTURAL TEMPLATE
 * ───────────────────────
 * Modeled on jobs/serviceOverdue.job.js's shape (isRunning
 * reentrancy guard, batch paging with a MAX_ITERATIONS_PER_RUN
 * safety valve, per-candidate try/catch so one failure never halts
 * the batch, run-once-on-startup + setInterval, an exported
 * { stop() } controller) — read in full before writing this file,
 * not copied blind. Two deliberate differences from that template:
 *   - No $expr-based in-query threshold: unlike a booking's overdue
 *     threshold (a single flat duration), SLA evaluation needs G.5's
 *     evaluateTicketSla() — pause-aware, per-priority, per-dimension
 *     — which cannot be expressed as a single Mongo query predicate.
 *     The query below is a coarse, index-friendly ELIGIBILITY filter
 *     only; the actual WARNING/BREACHED decision happens in JS via
 *     the unmodified G.5 evaluator.
 *   - No Socket.IO/io parameter: G.6 emits no realtime events (that
 *     is explicitly a later phase), so this job needs no `io`
 *     instance at all — same as jobs/reminder.job.js.
 *
 * WHAT THIS JOB DOES
 * ───────────────────
 *   1. Finds tickets that still have at least one SLA dimension not
 *      yet fully settled for events (see buildEligibleTicketQuery).
 *   2. For each candidate, fetches the exact SupportSlaPolicy this
 *      ticket was created under, via its own immutable
 *      `slaPolicyRef` — NOT a fresh category-based re-resolution.
 *      Re-resolving by category could return a DIFFERENT policy
 *      document than the one this ticket's deadlines were computed
 *      from (e.g. an admin added a category-specific policy after
 *      this ticket already existed under the global default) — that
 *      would silently reinterpret which policy governs this ticket's
 *      history, not just refresh a live value. `warningThresholdPercent`
 *      is intentionally NOT part of the immutable G.2 snapshot
 *      (confirmed: slaTargets only ever stored firstResponseDueAt/
 *      resolutionDueAt/pausedAt/totalPausedMs), so reading it live
 *      off the ticket's own bound policy is correct — only the
 *      *duration* targets are immutable, not the warning percentage.
 *   3. Calls the unmodified G.5 evaluateTicketSla({ ticket, policy,
 *      now }) — this job performs no timer math of its own.
 *   4. For each dimension (firstResponse/resolution) currently at
 *      WARNING or BREACHED, atomically flips the corresponding
 *      `slaTargets.<dimension><Kind>At` field from null to `now` —
 *      this atomic, filter-guarded update IS the idempotency/race
 *      guard, not a pre-check. Only the process whose update actually
 *      matched a document goes on to write the audit event; a
 *      concurrent duplicate matches zero documents and is a silent,
 *      correct no-op — the exact idiom already proven by G.3's
 *      firstRespondedAt and G.4's slaTargets.pausedAt/totalPausedMs.
 *   5. Reuses AUDIT_ACTION.SLA_WARNING/SLA_BREACHED (already reserved,
 *      never used before this) via the existing, unmodified
 *      recordSupportAuditEvent() — no new audit action name, no
 *      change to supportAudit.service.js or SupportAuditEvent.js.
 *      `newValue.dimension` ("FIRST_RESPONSE" | "RESOLUTION") is what
 *      keeps the two dimensions distinguishable in the audit trail,
 *      since both reuse the same action name.
 *
 * WHAT THIS JOB NEVER DOES
 * ─────────────────────────
 *   - Never mutates status, currentAssignment, or any message.
 *   - Never touches firstResponseDueAt/resolutionDueAt/pausedAt/
 *     totalPausedMs/slaPolicyRef/firstRespondedAt — only the four new
 *     event-state fields are ever written by this file.
 *   - Never escalates directly, reassigns, or changes priority (Step
 *     7's escalation, Step 8's notification, and Step 8's own
 *     Socket.IO emit are all delegated calls, gated by the exact same
 *     already-succeeded atomic flip — see the Step 7/8 addition notes
 *     below). This file itself contains no io.to()/emit() call of its
 *     own — it only ever passes its stored `io` through to
 *     notifySlaWarningOrBreach()/escalateSlaBreach(), which delegate
 *     to notifySlaEscalation() — the actual emitToRoom() calls live
 *     entirely in slaNotification.service.js.
 *   - No cron dependency — plain setInterval, matching every other
 *     job in this directory.
 *
 * PHASE G STEP 8 ADDITION — notification + Socket.IO hook only, same
 * shape as Step 7's: whenever a WARNING or BREACHED flip actually
 * succeeds, notifySlaWarningOrBreach() (modules/support/services/
 * slaNotification.service.js) is also called, notifying the ticket's
 * currently assigned agent (IN_APP) and emitting a support:sla:warning/
 * support:sla:breached Socket.IO event to the ticket's staff rooms.
 * Gated by the identical already-atomic condition as the audit write
 * right above it, so it inherits the same exactly-once guarantee — no
 * new SupportTicket field, no change to eligibility/batching/cadence/
 * the G.5 evaluator call. This file also now accepts and stores an
 * `io` instance (module-level, set once in startSlaScannerJob(), read
 * directly by flipEventStateAndAudit() and the two escalateSlaBreach()
 * call sites — never threaded as an explicit function parameter,
 * matching serviceOverdue.job.js's own `io` convention exactly). The
 * other Step 8 change here is adding `ticketNumber` to the candidate
 * `.select(...)` projection — the notification message needs it, and
 * G.6/G.7 never had a reason to select it before now.
 *
 * ELIGIBILITY QUERY — KNOWN LIMITATION (disclosed, not silently
 * accepted): a RESOLVED/CLOSED ticket whose final frozen resolution
 * state turns out to be OK (never warned, never breached) has no
 * flag that ever becomes non-null, so it keeps matching the
 * "unevaluated RESOLVED/CLOSED" branch of the query on every future
 * tick — each such re-scan is cheap (one more G.5 call that again
 * decides "nothing to do") and never produces a duplicate write, but
 * it is not eliminated from the eligible set. A tighter fix (e.g. a
 * fifth "resolution dimension fully evaluated" marker) was not added
 * here — it was not proven necessary for correctness or idempotency,
 * only for scan-set growth over time, and the locked spec calls for
 * the smallest additive mechanism actually necessary.
 *
 * INTEGRATION (NOT wired up in this phase — file only, matching
 * every other job's own documented convention, including
 * serviceOverdue.job.js which still says the same thing)
 * ───────────
 *   In server.js, alongside the existing jobs (after initSocket, same
 *   as serviceOverdue.job.js/holdExpiryJob — needs `io` for its
 *   Phase G Step 8 Socket.IO emits):
 *
 *     import { startSlaScannerJob } from "./jobs/slaScanner.job.js";
 *     const slaScannerJob = startSlaScannerJob(io);
 *
 *   In shutdown():
 *     slaScannerJob.stop();
 * ============================================================
 */

import SupportTicket from "../modules/support/models/SupportTicket.js";
import SupportSlaPolicy from "../modules/support/models/SupportSlaPolicy.js";
import { evaluateTicketSla, SLA_STATE } from "../modules/support/services/slaEvaluation.service.js";
import { recordSupportAuditEvent } from "../modules/support/services/supportAudit.service.js";
import { escalateSlaBreach } from "../modules/support/services/slaEscalation.service.js";
import { notifySlaWarningOrBreach } from "../modules/support/services/slaNotification.service.js";
import { ACTOR_TYPE, AUDIT_ACTION, TICKET_STATUS } from "../modules/support/constants/support.constants.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

// 60 seconds — the established default across this codebase's job
// architecture (reminder/customerArrival/autoStart/serviceOverdue/
// autoComplete all use 60s; only holdExpiry uses a tighter 30s, for
// a distinctly time-critical HOLD-expiry reason that does not apply
// here). SLA windows are configured in whole minutes at minimum (G.1
// validator: min 1), so 60s resolution is well within the precision
// the feature itself promises — not invented, the codebase's own
// existing majority convention.
const INTERVAL_MS = 60 * 1000;
const BATCH_SIZE = 50;
const MAX_ITERATIONS_PER_RUN = 20; // safety valve: max 20 pages (1000 tickets) per tick
const JOB_NAME = "[SlaScannerJob]";

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false; // prevents overlapping executions (single process)
let io = null; // Socket.IO instance — injected at startup (Phase G Step 8), same convention as serviceOverdue.job.js/holdExpiry.job.js

//////////////////////////////////////////////////////////////
// 🔎 CANDIDATE QUERY BUILDER — coarse eligibility only
//
// The actual WARNING/BREACHED decision is G.5's job, done in JS
// per-candidate; this query only narrows to tickets that could still
// possibly produce a new event on at least one dimension.
//////////////////////////////////////////////////////////////

const buildEligibleTicketQuery = () => ({
  isDeleted: false,
  $or: [
    // First-response dimension still open: no reply yet, and it has
    // never already reached BREACHED (the maximum severity — nothing
    // further can happen on this dimension once breached).
    { firstRespondedAt: null, "slaTargets.firstResponseBreachedAt": null },
    // Resolution dimension still open: ticket not yet RESOLVED/CLOSED,
    // and resolution has never already reached BREACHED.
    {
      status: { $nin: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
      "slaTargets.resolutionBreachedAt": null,
    },
    // Resolution dimension never evaluated even once for a ticket
    // that is already RESOLVED/CLOSED — needed to catch a breach/
    // warning that occurred exactly at (or just before) resolution.
    // See the file-level comment for the known, disclosed limitation
    // this branch implies when the final frozen state is OK.
    {
      status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
      "slaTargets.resolutionWarningAt": null,
      "slaTargets.resolutionBreachedAt": null,
    },
  ],
});

//////////////////////////////////////////////////////////////
// 🔐 ATOMIC FLIP + AUDIT WRITE — the idempotency/race guard
//
// The filter-guarded updateOne is what actually prevents duplicate
// processing, exactly like G.3's firstRespondedAt and G.4's
// slaTargets.pausedAt/totalPausedMs use elsewhere in this module —
// not a "check then insert": a concurrent duplicate call's filter
// simply no longer matches once the first call has already flipped
// the field, so it modifies zero documents and is a clean no-op.
// Only the caller that actually flipped the field goes on to write
// the audit event, so the audit event can never be duplicated either.
//////////////////////////////////////////////////////////////

async function flipEventStateAndAudit({ ticket, fieldPath, kind, dimension, timerResult, now }) {
  const ticketId = ticket._id;
  const updateResult = await SupportTicket.updateOne(
    { _id: ticketId, [fieldPath]: null },
    { $set: { [fieldPath]: now } }
  );

  if (updateResult.modifiedCount !== 1) {
    // Lost the race (another process/tick already flipped it) or the
    // field was already non-null for any other reason — no event.
    return false;
  }

  await recordSupportAuditEvent({
    ticketRef: ticketId,
    actorRef: null,
    actorType: ACTOR_TYPE.SYSTEM,
    action: kind === "WARNING" ? AUDIT_ACTION.SLA_WARNING : AUDIT_ACTION.SLA_BREACHED,
    entityId: ticketId,
    newValue: {
      dimension, // "FIRST_RESPONSE" | "RESOLUTION" — keeps the two dimensions distinguishable without a new audit action name
      percentConsumed: timerResult.percentConsumed,
      effectiveElapsedMs: timerResult.effectiveElapsedMs,
      dueAt: timerResult.dueAt,
    },
    reason: `Automated SLA ${kind.toLowerCase()} detected by the SLA scanner (${dimension === "FIRST_RESPONSE" ? "first response" : "resolution"})`,
  });

  // Phase G Step 8 — notify, gated by the exact same atomic flip that
  // just succeeded above (see the file-level Step 8 comment).
  await notifySlaWarningOrBreach({ ticket, kind, dimension, timerResult, io });

  return true;
}

//////////////////////////////////////////////////////////////
// 🔐 PROCESS ONE TICKET
//
// Separated from the batch loop so a single ticket's failure is
// caught and logged without halting the rest of the batch — same
// convention as serviceOverdue.job.js's processOneBooking().
//////////////////////////////////////////////////////////////

async function processOneTicket(candidate, now) {
  const policy = candidate.slaPolicyRef
    ? await SupportSlaPolicy.findById(candidate.slaPolicyRef).lean()
    : null;

  const evaluation = evaluateTicketSla({ ticket: candidate, policy, now });

  let eventsRecorded = 0;
  let escalationsRecorded = 0;

  if (evaluation.firstResponse.status === SLA_STATE.WARNING || evaluation.firstResponse.status === SLA_STATE.BREACHED) {
    const flipped = await flipEventStateAndAudit({
      ticket: candidate,
      fieldPath: "slaTargets.firstResponseWarningAt",
      kind: "WARNING",
      dimension: "FIRST_RESPONSE",
      timerResult: evaluation.firstResponse,
      now,
    });
    if (flipped) eventsRecorded++;
  }
  if (evaluation.firstResponse.status === SLA_STATE.BREACHED) {
    const flipped = await flipEventStateAndAudit({
      ticket: candidate,
      fieldPath: "slaTargets.firstResponseBreachedAt",
      kind: "BREACHED",
      dimension: "FIRST_RESPONSE",
      timerResult: evaluation.firstResponse,
      now,
    });
    if (flipped) {
      eventsRecorded++;
      // Phase G Step 7 — escalate exactly once, gated by the same
      // atomic flip that just succeeded above.
      await escalateSlaBreach({ ticket: candidate, dimension: "FIRST_RESPONSE", timerResult: evaluation.firstResponse, io });
      escalationsRecorded++;
    }
  }

  if (evaluation.resolution.status === SLA_STATE.WARNING || evaluation.resolution.status === SLA_STATE.BREACHED) {
    const flipped = await flipEventStateAndAudit({
      ticket: candidate,
      fieldPath: "slaTargets.resolutionWarningAt",
      kind: "WARNING",
      dimension: "RESOLUTION",
      timerResult: evaluation.resolution,
      now,
    });
    if (flipped) eventsRecorded++;
  }
  if (evaluation.resolution.status === SLA_STATE.BREACHED) {
    const flipped = await flipEventStateAndAudit({
      ticket: candidate,
      fieldPath: "slaTargets.resolutionBreachedAt",
      kind: "BREACHED",
      dimension: "RESOLUTION",
      timerResult: evaluation.resolution,
      now,
    });
    if (flipped) {
      eventsRecorded++;
      await escalateSlaBreach({ ticket: candidate, dimension: "RESOLUTION", timerResult: evaluation.resolution, io });
      escalationsRecorded++;
    }
  }

  return { eventsRecorded, escalationsRecorded };
}

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER — pages through candidates until none remain
//////////////////////////////////////////////////////////////

const runSlaScannerJob = async () => {
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  let totalEvents = 0;
  let totalEscalations = 0;
  let totalTicketsScanned = 0;
  let totalErrors = 0;
  let iterations = 0;

  try {
    const now = new Date();
    const query = buildEligibleTicketQuery();

    while (iterations < MAX_ITERATIONS_PER_RUN) {
      const candidates = await SupportTicket.find(query)
        .select("_id ticketNumber createdAt status firstRespondedAt resolvedAt slaTargets slaPolicyRef currentAssignment")
        .sort({ createdAt: 1 })
        .limit(BATCH_SIZE)
        .lean();

      if (candidates.length === 0) {
        break;
      }

      iterations++;

      for (const candidate of candidates) {
        try {
          const { eventsRecorded, escalationsRecorded } = await processOneTicket(candidate, now);
          totalTicketsScanned++;
          totalEvents += eventsRecorded;
          totalEscalations += escalationsRecorded;
        } catch (err) {
          totalErrors++;
          console.error(`${JOB_NAME} Failed to evaluate ticket ${candidate._id}:`, err.message);
          // Continue — don't let one failure stop the rest of the batch
        }
      }

      if (candidates.length < BATCH_SIZE) {
        break; // last page
      }
    }

    if (iterations >= MAX_ITERATIONS_PER_RUN) {
      console.warn(
        `${JOB_NAME} Hit MAX_ITERATIONS_PER_RUN (${MAX_ITERATIONS_PER_RUN}) — remaining tickets will be picked up on the next tick`
      );
    }

    if (totalEvents > 0 || totalErrors > 0) {
      console.info(
        `${JOB_NAME} Run complete — scanned: ${totalTicketsScanned} | events recorded: ${totalEvents} | escalations: ${totalEscalations} | errors: ${totalErrors}`
      );
    }
  } catch (err) {
    console.error(`${JOB_NAME} Query failed:`, err.message);
  } finally {
    isRunning = false;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORTED STARTER
//////////////////////////////////////////////////////////////

/**
 * Start the SLA scanner background job.
 *
 * @param {import("socket.io").Server|null} [ioInstance] - Phase G
 *   Step 8 addition, same convention as startServiceOverdueJob(io)/
 *   startHoldExpiryJob(io) — stored once here, then read directly
 *   (not threaded as a parameter) by every internal function that
 *   needs it, exactly like this file's own `isRunning` module state.
 *   Optional and defaults to null: emitToRoom's own internal
 *   `if (!io) return` guard makes omitting it a safe no-op for the
 *   Socket.IO side only — notifications and audit/state writes are
 *   entirely unaffected either way.
 * @returns {{ stop: () => void }}
 */
export const startSlaScannerJob = (ioInstance = null) => {
  io = ioInstance;
  runSlaScannerJob();

  const intervalHandle = setInterval(runSlaScannerJob, INTERVAL_MS);

  console.info(`${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE}`);

  return {
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};

// Exported for focused testing only (mirrors no existing job's own
// convention exactly, since none of the prior jobs needed to expose
// internals for direct unit testing before now) — the internal
// runner/query/flip functions are the actual units this test suite
// exercises without needing setInterval or a live Mongo connection.
// setIoForTesting() (Phase G Step 8's Socket.IO addition) is a thin
// test-only setter for the module-level `io` variable — lets tests
// exercise processOneTicket()'s socket-emitting paths directly
// without going through startSlaScannerJob() (which would also
// trigger an immediate real scan and a setInterval, neither wanted
// in a focused unit test).
export const __internal = {
  runSlaScannerJob,
  buildEligibleTicketQuery,
  processOneTicket,
  flipEventStateAndAudit,
  setIoForTesting: (ioInstance) => {
    io = ioInstance;
  },
};
