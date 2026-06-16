/**
 * ============================================================
 * 🚗 CUSTOMER ARRIVAL JOB
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Monitors CONFIRMED bookings where the customer has not
 * arrived within their grace window and flags them as delayed.
 *
 * Without this job:
 *   A customer misses their 10:00 slot. The salon dashboard
 *   shows the booking as CONFIRMED with no indication the
 *   customer is late. The chair stays occupied with no action.
 *
 * With this job:
 *   At 10:15 (arrivalGraceUntil), the job flags the booking
 *   with customerDelayedAt and emits a realtime alert. The
 *   salon owner sees a "Customer Delayed" badge and can choose:
 *     OPTION-A  Wait +10 min  (extendArrivalGrace)
 *     OPTION-B  Release chair (releaseChairForNoShow)
 *     OPTION-C  Customer arrived (normal check-in flow)
 *
 * HOW IT WORKS
 * ────────────
 *   Every 60 seconds:
 *     1. Query: { status: CONFIRMED, arrivalGraceUntil: { $lt: now },
 *                 customerDelayedAt: null }
 *        (hits the partial compound index in Booking.model.js —
 *         O(1) even with millions of completed bookings)
 *     2. For each match: set customerDelayedAt = now, save
 *     3. Emit booking:customerDelayed to salon + user rooms
 *     4. Log summary
 *
 * DESIGN DECISIONS
 * ────────────────
 *   - Does NOT auto-transition to NO_SHOW — that is a human
 *     decision made by the salon owner. Fully rigid automation
 *     breaks real salon operations (customer may be 2 mins late
 *     and calling ahead). This job only flags; humans decide.
 *   - Each booking saved individually (not bulkWrite) so a
 *     single DB failure doesn't silently skip the rest.
 *   - isRunning flag prevents overlapping executions on slow
 *     DB responses or large batches.
 *   - Socket emit is best-effort — a failed emit never blocks
 *     the DB write or crashes the worker.
 *   - Runs once immediately on startup to catch any bookings
 *     that accumulated during server downtime.
 *
 * INTEGRATION
 * ───────────
 *   In server.js, after startHoldExpiryJob():
 *
 *     import { startCustomerArrivalJob } from "./jobs/customerArrival.job.js";
 *     const customerArrivalJob = startCustomerArrivalJob(io);
 *
 *   In shutdown():
 *     customerArrivalJob.stop();
 *
 * ============================================================
 */

import Booking          from "../models/Booking.js";
import { BOOKING_STATUS } from "../utils/bookingState.machine.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS = 60 * 1000; // run every 60 seconds
const BATCH_SIZE  = 50;         // max bookings to process per run
const JOB_NAME    = "[CustomerArrivalJob]";

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false; // prevents overlapping executions
let io        = null;  // Socket.IO instance — injected at startup

//////////////////////////////////////////////////////////////
// 📡 SAFE SOCKET EMIT
//
// Best-effort — a socket failure never crashes the worker
// or rolls back the DB write that already completed.
//////////////////////////////////////////////////////////////

const safeEmit = (room, event, payload) => {
  try {
    if (io) io.to(room).emit(event, payload);
  } catch (err) {
    console.warn(`${JOB_NAME} Socket emit failed [${event}] → ${room}:`, err.message);
  }
};

//////////////////////////////////////////////////////////////
// 🔐 PROCESS ONE BOOKING
//
// Separated from the batch loop so a single booking failure
// is caught and logged without halting the rest of the batch.
//////////////////////////////////////////////////////////////

const processOneBooking = async (booking, now) => {
  booking.customerDelayedAt = now;

  await booking.save();

  // Emit after save — consistent with the booking controller pattern
  // of never emitting uncommitted state.
  const payload = {
    bookingId:         booking._id,
    customerDelayedAt: now,
    message:           "Customer has not arrived within the grace window.",
  };

  safeEmit(`salon:${booking.salonRef}`, "booking:customerDelayed", {
    ...payload,
    // Salon gets extra context for the dashboard action buttons
    arrivalGraceUntil: booking.arrivalGraceUntil,
  });

  safeEmit(`user:${booking.userRef}`, "booking:customerDelayed", {
    ...payload,
    message: "Your booking grace period has ended. Please contact the salon.",
  });
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER
//////////////////////////////////////////////////////////////

const runArrivalJob = async () => {
  // Skip if previous run hasn't finished
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  try {
    const now = new Date();

    // Hits the compound partial index:
    //   { status: 1, arrivalGraceUntil: 1, customerDelayedAt: 1 }
    //   partialFilter: { status: CONFIRMED }
    // Defined in Booking.model.js — O(1) regardless of total booking volume.
    const overdueBookings = await Booking
      .find({
        status:            BOOKING_STATUS.CONFIRMED,
        arrivalGraceUntil: { $ne: null, $lt: now },
        customerDelayedAt: null,
      })
      .select("_id salonRef userRef arrivalGraceUntil")
      .limit(BATCH_SIZE);

    if (overdueBookings.length === 0) {
      // Nothing to process — no log noise in steady state
      isRunning = false;
      return;
    }

    console.info(`${JOB_NAME} Found ${overdueBookings.length} overdue booking(s) — processing...`);

    let flaggedCount = 0;
    let errorCount   = 0;

    for (const booking of overdueBookings) {
      try {
        await processOneBooking(booking, now);
        flaggedCount++;
        console.info(`${JOB_NAME} Flagged delayed: ${booking._id}`);
      } catch (err) {
        errorCount++;
        console.error(
          `${JOB_NAME} Failed to flag booking ${booking._id}:`,
          err.message
        );
        // Continue — don't let one failure stop the rest of the batch
      }
    }

    console.info(
      `${JOB_NAME} Run complete — ` +
      `flagged: ${flaggedCount} | errors: ${errorCount}`
    );

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
 * Start the customer arrival background job.
 *
 * @param {import("socket.io").Server} ioInstance
 *   The Socket.IO server instance from initSocket().
 *   Required so the worker can emit realtime events without
 *   needing access to req.app.
 *
 * @returns {{ stop: () => void }}
 *   Returns a controller object with a stop() method for use
 *   in graceful shutdown — cleaner than exposing the raw interval
 *   handle.
 *
 * Call once in server.js after startHoldExpiryJob():
 *
 *   const customerArrivalJob = startCustomerArrivalJob(io);
 *
 * In shutdown():
 *   customerArrivalJob.stop();
 */
export const startCustomerArrivalJob = (ioInstance) => {
  io = ioInstance;

  // Run once immediately on startup — catches any bookings that
  // accumulated while the server was down (restart recovery).
  runArrivalJob();

  const intervalHandle = setInterval(runArrivalJob, INTERVAL_MS);

  console.info(
    `${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE}`
  );

  return {
    /**
     * Stop the job cleanly. Call during graceful shutdown before
     * closing the MongoDB connection — prevents a mid-batch save
     * from hitting a closed connection.
     */
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};