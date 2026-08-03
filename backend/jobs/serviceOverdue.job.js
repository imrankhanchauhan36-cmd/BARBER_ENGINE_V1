/**
 * ============================================================
 * ⏰ SERVICE OVERDUE JOB (Booking Engine V2 — Phase 2)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Flags ONGOING bookings that are running past their expected
 * service duration (+ grace), so the salon dashboard can show
 * an "Overdue" indicator in realtime.
 *
 * Without this job:
 *   A haircut expected to take 20 minutes is still ONGOING at
 *   minute 40. Nothing on the salon dashboard indicates this —
 *   the chair just looks normally occupied.
 *
 * With this job:
 *   At (serviceStartedAt + serviceDuration + grace), the job
 *   flags the booking with serviceOverdueAt, records an
 *   OVERDUE_FLAGGED timeline event, and emits a realtime alert
 *   to the salon dashboard.
 *
 * HOW IT WORKS
 * ────────────
 *   Every 60 seconds, in batches until none remain:
 *     1. Query ONGOING bookings that are unflagged AND already
 *        past (serviceStartedAt + serviceDuration + grace) —
 *        the threshold is evaluated IN THE QUERY via $expr, not
 *        in JS, so every page returned is genuinely actionable
 *        (a not-yet-due booking never reappears mid-run and can
 *        never cause the batch loop to spin).
 *     2. For each candidate: atomically flip serviceOverdueAt
 *        from null → now AND push an OVERDUE_FLAGGED timeline
 *        event, in one findOneAndUpdate.
 *     3. Emit booking:serviceOverdue to the salon room only.
 *     4. Repeat until a page returns fewer than BATCH_SIZE rows
 *        (or MAX_ITERATIONS_PER_RUN is hit, as a safety valve).
 *
 * DESIGN DECISIONS
 * ────────────────
 *   - THIS JOB NEVER CHANGES status, NEVER completes the booking,
 *     NEVER releases the wallet, NEVER releases the chair. It is
 *     a flag-only worker, exactly like customerArrival.job.js —
 *     the actual auto-complete decision is a later, separate phase.
 *   - No new BOOKING_STATUS value — ONGOING stays ONGOING.
 *   - Grace is a flat global default (no per-service override yet —
 *     that is a later phase). Kept as a single named constant so
 *     it's the one place to change until per-service config exists.
 *   - ATOMIC WRITE: uses findOneAndUpdate with a
 *     { status: ONGOING, serviceOverdueAt: null } filter instead
 *     of mutate-then-save. This makes the flag-set itself the
 *     race guard — if two job instances (multi-server deployment)
 *     race on the same booking, only the first update matches and
 *     writes; the second matches zero documents and is a clean,
 *     silent no-op. It also means an unrelated concurrent edit
 *     (e.g. rating, notes) can never be clobbered by this job,
 *     since only serviceOverdueAt/timelineEvents are touched.
 *   - $push on timelineEvents needs no defensive `?? []` guard —
 *     MongoDB's $push operator creates the array field itself if
 *     it's absent on the document, at the database level.
 *   - Candidate reads use .lean() — the job never mutates the
 *     fetched documents in JS anymore (the atomic update is a
 *     separate, targeted write), so a plain object is sufficient
 *     and cheaper than hydrating a full Mongoose document per row.
 *   - isRunning flag prevents overlapping executions of the job
 *     itself (single Node process); the atomic update above is
 *     the separate guard for overlap ACROSS processes/servers.
 *   - Socket emit is best-effort, explicitly guarded by `if (io)`
 *     (matching holdExpiry.job.js's convention) on top of
 *     emitToRoom's own internal guard — belt and suspenders.
 *   - Runs once immediately on startup to catch bookings that
 *     became overdue while the server was down.
 *
 * INTEGRATION (NOT wired up in this phase — file only)
 * ───────────
 *   In server.js, alongside the existing jobs:
 *
 *     import { startServiceOverdueJob } from "./jobs/serviceOverdue.job.js";
 *     const serviceOverdueJob = startServiceOverdueJob(io);
 *
 *   In shutdown():
 *     serviceOverdueJob.stop();
 *
 * ============================================================
 */

import Booking           from "../models/Booking.js";
import { BOOKING_STATUS } from "../utils/bookingState.machine.js";
import { emitToRoom }     from "../socket/index.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS            = 60 * 1000; // run every 60 seconds
const BATCH_SIZE             = 50;         // rows fetched per page
const MAX_ITERATIONS_PER_RUN = 20;         // safety valve: max 20 pages (1000 bookings) per tick
const JOB_NAME                = "[ServiceOverdueJob]";

// Flat global grace, in minutes, added on top of serviceDuration
// before a still-ONGOING booking is flagged overdue. Per-service
// override (e.g. Haircut +5, Massage +15, Spa +20) is a later
// phase — this is the fallback used until that exists.
const SERVICE_OVERDUE_GRACE_MINUTES = 10;

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false; // prevents overlapping executions (single process)
let io        = null;  // Socket.IO instance — injected at startup

//////////////////////////////////////////////////////////////
// 🔎 CANDIDATE QUERY BUILDER
//
// $expr evaluates the overdue threshold IN THE DATABASE:
//   serviceStartedAt + (serviceDuration + grace) minutes <= now
// so every row returned is already genuinely overdue — a booking
// that hasn't reached its threshold yet is never returned, and
// therefore can never cause the batch loop below to spin on
// the same unflagged-but-not-yet-due row.
//////////////////////////////////////////////////////////////

const buildOverdueQuery = (now) => ({
  status:           BOOKING_STATUS.ONGOING,
  serviceStartedAt: { $ne: null },
  serviceOverdueAt: null,
  $expr: {
    $lte: [
      {
        $add: [
          "$serviceStartedAt",
          { $multiply: [{ $add: ["$serviceDuration", SERVICE_OVERDUE_GRACE_MINUTES] }, 60 * 1000] },
        ],
      },
      now,
    ],
  },
});

//////////////////////////////////////////////////////////////
// 🔐 PROCESS ONE BOOKING — ATOMIC FLAG + TIMELINE EVENT
//
// Separated from the batch loop so a single booking failure is
// caught and logged without halting the rest of the batch.
//////////////////////////////////////////////////////////////

const processOneBooking = async (candidate, now) => {
  const expectedOverdueAt = new Date(
    candidate.serviceStartedAt.getTime() +
    (candidate.serviceDuration + SERVICE_OVERDUE_GRACE_MINUTES) * 60 * 1000
  );

  // Atomic: only succeeds if this booking is STILL ONGOING and
  // STILL unflagged at write time. If another job instance (or
  // this same job, on a slow tick) already flagged it, or its
  // status moved on, this matches zero documents and returns null —
  // a clean, silent skip, not an error.
  const updated = await Booking.findOneAndUpdate(
    {
      _id:              candidate._id,
      status:           BOOKING_STATUS.ONGOING,
      serviceOverdueAt: null,
    },
    {
      $set: {
        serviceOverdueAt: now,
      },
      $push: {
        timelineEvents: {
          eventType:  "OVERDUE_FLAGGED",
          occurredAt: now,
          actor:      "SYSTEM",
          meta: {
            expectedOverdueAt,
            graceMinutes: SERVICE_OVERDUE_GRACE_MINUTES,
          },
        },
      },
    },
    { new: true, select: "_id salonRef chairRef" }
  );

  if (!updated) {
    return { skipped: true };
  }

  // Emit after write — consistent with the pattern used across
  // every other booking job/controller (never emit uncommitted
  // state). Salon-only: this is an operational alert for the
  // dashboard, not a customer-facing event (later phase).
  if (io) {
    emitToRoom(io, `salon:${updated.salonRef}`, "booking:serviceOverdue", {
      bookingId:        updated._id,
      chairId:          updated.chairRef,
      serviceOverdueAt: now,
      message:          "This service is running past its expected duration.",
    });
  }

  return { flagged: true };
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER — pages through candidates until none remain
//////////////////////////////////////////////////////////////

const runServiceOverdueJob = async () => {
  // Skip if previous run hasn't finished
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  let totalFlagged = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;
  let iterations   = 0;

  try {
    const now = new Date();
    const query = buildOverdueQuery(now);

    // Page through in batches of BATCH_SIZE. Each page only ever
    // contains still-unflagged, already-overdue rows (see
    // buildOverdueQuery), so once a page is processed those rows
    // drop out of the next page's result set automatically —
    // this loop always terminates, it does not need an offset.
    while (iterations < MAX_ITERATIONS_PER_RUN) {
      const candidates = await Booking
        .find(query)
        .select("_id serviceStartedAt serviceDuration")
        .sort({ serviceStartedAt: 1 }) // oldest overdue booking first
        .limit(BATCH_SIZE)
        .lean();

      if (candidates.length === 0) {
        break;
      }

      iterations++;

      for (const candidate of candidates) {
        try {
          const result = await processOneBooking(candidate, now);
          if (result.flagged) {
            totalFlagged++;
            console.info(`${JOB_NAME} Flagged overdue: ${candidate._id}`);
          } else {
            totalSkipped++;
          }
        } catch (err) {
          totalErrors++;
          console.error(
            `${JOB_NAME} Failed to flag booking ${candidate._id}:`,
            err.message
          );
          // Continue — don't let one failure stop the rest of the batch
        }
      }

      if (candidates.length < BATCH_SIZE) {
        break; // last page
      }
    }

    if (iterations >= MAX_ITERATIONS_PER_RUN) {
      console.warn(
        `${JOB_NAME} Hit MAX_ITERATIONS_PER_RUN (${MAX_ITERATIONS_PER_RUN}) — ` +
        `remaining overdue bookings will be picked up on the next tick`
      );
    }

    if (totalFlagged > 0 || totalErrors > 0) {
      console.info(
        `${JOB_NAME} Run complete — ` +
        `flagged: ${totalFlagged} | skipped: ${totalSkipped} | errors: ${totalErrors}`
      );
    }

  } catch (err) {
    // Top-level query failure (e.g. DB connection lost)
    console.error(`${JOB_NAME} Query failed:`, err.message);
  } finally {
    isRunning = false;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORTED STARTER
//////////////////////////////////////////////////////////////

/**
 * Start the service overdue background job.
 *
 * @param {import("socket.io").Server} ioInstance
 *   The Socket.IO server instance from initSocket(). Required so
 *   the worker can emit realtime events without needing access
 *   to req.app.
 *
 * @returns {{ stop: () => void }}
 *   Returns a controller object with a stop() method for use in
 *   graceful shutdown.
 *
 * NOT called from server.js in this phase — this file only
 * declares the job; wiring it into startup is a later step.
 */
export const startServiceOverdueJob = (ioInstance) => {
  io = ioInstance;

  // Run once immediately on startup — catches any bookings that
  // became overdue while the server was down.
  runServiceOverdueJob();

  const intervalHandle = setInterval(runServiceOverdueJob, INTERVAL_MS);

  console.info(
    `${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE}`
  );

  return {
    /**
     * Stop the job cleanly. Call during graceful shutdown before
     * closing the MongoDB connection.
     */
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};
