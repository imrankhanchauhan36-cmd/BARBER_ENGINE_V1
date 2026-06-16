/**
 * ============================================================
 * ⏱ HOLD EXPIRY JOB
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Automatically expire stale HOLD bookings where the user
 * started the booking flow but never completed payment.
 *
 * Without this job:
 *   A user holds a slot at 10:00, closes the app without paying.
 *   The chair stays blocked forever — nobody else can book it.
 *
 * With this job:
 *   At 10:05 (holdExpiresAt), the job finds the stale HOLD,
 *   transitions it to EXPIRED, and the chair is immediately free.
 *   The salon dashboard updates in realtime via Socket.IO.
 *
 * HOW IT WORKS
 * ────────────
 *   Every 30 seconds:
 *     1. Query: { status: HOLD, holdExpiresAt: { $lt: now } }
 *        (hits the partial index — extremely fast even at scale)
 *     2. For each expired HOLD: HOLD → EXPIRED (atomic session)
 *     3. Emit booking:expired to salon + user rooms via Socket.IO
 *     4. Log summary
 *
 * INTEGRATION
 * ───────────
 *   In server.js, after initSocket():
 *
 *     import { startHoldExpiryJob } from "./jobs/holdExpiry.job.js";
 *     startHoldExpiryJob(io);
 *
 * DESIGN DECISIONS
 * ────────────────
 *   - Uses setInterval (not node-cron) — no extra dependency,
 *     and 30-second precision is sufficient for this use case.
 *   - Processes bookings in batches of BATCH_SIZE to prevent
 *     a single large query from blocking the event loop.
 *   - Each expiry is its own atomic mongoose session — a failure
 *     on one booking does not affect others in the batch.
 *   - Socket emit happens AFTER commit — consistent with the
 *     pattern used across the entire booking controller.
 *   - isRunning flag prevents overlapping job executions if a
 *     run takes longer than the interval (e.g. DB slowness).
 *
 * ============================================================
 */

import mongoose          from "mongoose";
import Booking           from "../models/Booking.js";
import { BOOKING_STATUS } from "../utils/bookingState.machine.js";
import { emitToRoom }    from "../socket/index.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS  = 30 * 1000;  // run every 30 seconds
const BATCH_SIZE   = 50;          // max bookings to expire per run
const JOB_NAME     = "[HoldExpiryJob]";

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false; // prevents overlapping executions
let io        = null;  // Socket.IO instance — injected at startup

//////////////////////////////////////////////////////////////
// 🔐 EXPIRE ONE BOOKING — ATOMIC SESSION
//
// Each booking gets its own session so one failure doesn't
// roll back the others in the batch.
//////////////////////////////////////////////////////////////

const expireOneBooking = async (booking) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Re-fetch inside session for a consistent read snapshot.
    // The batch query ran outside a session — by the time we
    // process this booking, the user may have just confirmed it.
    // This re-fetch prevents expiring a booking that was just paid.
    const fresh = await Booking
      .findById(booking._id)
      .session(session);

    // Guard: only expire if STILL in HOLD and STILL expired
    if (
      !fresh ||
      fresh.status     !== BOOKING_STATUS.HOLD ||
      fresh.holdExpiresAt > new Date()
    ) {
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "Already processed or re-activated" };
    }

    // Transition HOLD → EXPIRED
    fresh.status      = BOOKING_STATUS.EXPIRED;
    fresh.expiredAt   = new Date();
    fresh.lockUntil   = null;

    // Append to audit trail (pre-save hook fires automatically)
    fresh.statusChangedAt = new Date();
    fresh.statusChangedBy = null; // SYSTEM-triggered

    await fresh.save({ session });

    await session.commitTransaction();
    session.endSession();

    // ── Realtime emit (after commit) ─────────────────────────
    // Tells the salon dashboard to remove the HOLD ghost from
    // the chair grid, and tells the user app to show "slot expired".
    if (io) {
      emitToRoom(io, `salon:${fresh.salonRef}`, "booking:expired", {
        bookingId: fresh._id,
        chairId:   fresh.chairRef,
        startTime: fresh.startTime,
        endTime:   fresh.endTime,
        status:    BOOKING_STATUS.EXPIRED,
      });

      emitToRoom(io, `user:${fresh.userRef}`, "booking:expired", {
        bookingId: fresh._id,
        status:    BOOKING_STATUS.EXPIRED,
        message:   "Your booking hold has expired. Please try again.",
      });
    }

    return { expired: true };

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err; // caller logs this
  }
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER
//////////////////////////////////////////////////////////////

const runExpiryJob = async () => {
  // Skip if previous run hasn't finished (DB slowness / large batch)
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  try {
    const now = new Date();

    // Find stale HOLD bookings — hits the partial index on
    // { status: "HOLD", holdExpiresAt } defined in Booking.model.js
    const expiredHolds = await Booking
      .find({
        status:        BOOKING_STATUS.HOLD,
        holdExpiresAt: { $lt: now },
      })
      .select("_id salonRef userRef chairRef startTime endTime holdExpiresAt")
      .limit(BATCH_SIZE)
      .lean();

    if (expiredHolds.length === 0) {
      // Nothing to process — no log noise in steady state
      isRunning = false;
      return;
    }

    console.info(`${JOB_NAME} Found ${expiredHolds.length} expired HOLD(s) — processing...`);

    let expiredCount = 0;
    let skippedCount = 0;
    let errorCount   = 0;

    // Process sequentially to avoid overwhelming the DB with
    // parallel sessions during a traffic spike recovery.
    for (const booking of expiredHolds) {
      try {
        const result = await expireOneBooking(booking);
        if (result.expired) expiredCount++;
        if (result.skipped) skippedCount++;
      } catch (err) {
        errorCount++;
        console.error(
          `${JOB_NAME} Failed to expire booking ${booking._id}:`,
          err.message
        );
        // Continue — don't let one failure stop the rest of the batch
      }
    }

    console.info(
      `${JOB_NAME} Run complete — ` +
      `expired: ${expiredCount} | skipped: ${skippedCount} | errors: ${errorCount}`
    );

  } catch (err) {
    // Catch top-level query failure (e.g. DB connection lost)
    console.error(`${JOB_NAME} Query failed:`, err.message);
  } finally {
    isRunning = false;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORTED STARTER
//////////////////////////////////////////////////////////////

/**
 * Start the hold expiry background job.
 *
 * @param {import("socket.io").Server} ioInstance
 *   The Socket.IO server instance from initSocket().
 *   Pass it so expired HOLDs can emit realtime events
 *   without needing access to req.app.
 *
 * Call once in server.js after initSocket():
 *
 *   import { startHoldExpiryJob } from "./jobs/holdExpiry.job.js";
 *   const holdExpiryJob = startHoldExpiryJob(io);
 *
 * In shutdown():
 *   holdExpiryJob.stop();
 */
export const startHoldExpiryJob = (ioInstance) => {
  io = ioInstance;

  // Run once immediately on startup to clear any stale HOLDs
  // that accumulated while the server was down (restart recovery).
  runExpiryJob();

  const intervalHandle = setInterval(runExpiryJob, INTERVAL_MS);

  console.info(
    `${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE}`
  );

  return {
    /**
     * Stop the job cleanly. Call during graceful shutdown before
     * closing the MongoDB connection — prevents a mid-batch write
     * from hitting a closed connection.
     */
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};