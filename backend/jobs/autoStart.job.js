/**
 * ============================================================
 * ▶️  AUTO START JOB (Booking Engine V2 — Phase 6)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Automatically transitions a CHECKED_IN booking to ONGOING once
 * its scheduled startTime arrives, if the salon owner forgot to
 * tap "Start Service" — per the approved business flow ("jab
 * check in ho gaya user to aisa hi hona chahiye").
 *
 * THIS JOB DOES NOT CALL startService() DIRECTLY
 * ───────────────────────────────────────────────────
 * startService() is an Express handler with no meaning outside a
 * request (no req.app for the socket emit). Same precedent as
 * autoComplete.job.js: reuse the shared transitionBookingStatus()
 * primitive directly, don't call the HTTP handler.
 *
 * HOW IT WORKS
 * ────────────
 *   Every 60 seconds, in pages until none remain:
 *     1. Query CHECKED_IN bookings whose startTime has already
 *        passed and serviceStartedAt is still null.
 *     2. For each candidate: open a session, RE-FETCH inside it,
 *        re-verify every guard, abort+skip if stale — identical
 *        "re-fetch inside session, guard, abort if changed"
 *        pattern already proven by holdExpiry.job.js and
 *        autoComplete.job.js for this exact class of problem.
 *     3. transitionBookingStatus() → ONGOING (reused, unmodified —
 *        same transition startService() already uses).
 *     4. Commit. Post-commit: notification (same copy startService()
 *        already sends) + emit the EXISTING "booking:serviceStarted"
 *        event (not a new event — same one startService() emits).
 *
 * WHY A SESSION EVEN THOUGH NO WALLET IS TOUCHED
 * ───────────────────────────────────────────────
 * Booking.js has versionKey:false (no Mongoose optimistic
 * concurrency). A bare fetch→mutate→save() without a session has
 * no cross-write conflict protection at all here. A mongoose
 * session still gets MongoDB's own storage-engine write-conflict
 * detection regardless of wallet involvement — reusing the same
 * proven pattern is safer than inventing a lighter one.
 *
 * WHAT THIS JOB DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────
 *   - No new BOOKING_STATUS value.
 *   - No wallet interaction — startService() itself never touches
 *     the wallet either.
 *   - No new socket event — booking:serviceStarted is reused as-is.
 *
 * INTEGRATION
 * ───────────
 *   In server.js, alongside the existing jobs:
 *     import { startAutoStartJob } from "./jobs/autoStart.job.js";
 *     const autoStartJob = startAutoStartJob(io);
 *   In shutdown():
 *     autoStartJob.stop();
 * ============================================================
 */

import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import NotificationService from "../services/NotificationService.js";
import { BOOKING_STATUS, transitionBookingStatus } from "../utils/bookingState.machine.js";
import { toFriendlyId } from "../utils/friendlyId.js";
import { emitToRoom } from "../socket/index.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS            = 60 * 1000;
const BATCH_SIZE             = 50;
const MAX_ITERATIONS_PER_RUN = 20;
const JOB_NAME                = "[AutoStartJob]";

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false;
let io        = null;

//////////////////////////////////////////////////////////////
// 🔎 CANDIDATE QUERY
//////////////////////////////////////////////////////////////

const buildAutoStartQuery = (now) => ({
  status:           BOOKING_STATUS.CHECKED_IN,
  serviceStartedAt: null,
  startTime:        { $lte: now },
});

//////////////////////////////////////////////////////////////
// 🔐 AUTO-START ONE BOOKING — ATOMIC SESSION
//////////////////////////////////////////////////////////////

const autoStartOneBooking = async (candidateId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findById(candidateId).session(session);

    if (!booking || booking.status !== BOOKING_STATUS.CHECKED_IN || booking.serviceStartedAt) {
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "Already started or no longer CHECKED_IN" };
    }

    if (booking.startTime > new Date()) {
      // Defensive re-check — should be impossible given the candidate
      // query, but never trust the outer query blindly.
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "Not yet due" };
    }

    await transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.ONGOING, session });

    await session.commitTransaction();
    session.endSession();

    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Service Started",
      message:       "Your service has started. Sit back and relax!",
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });

    if (io) {
      const payload = {
        bookingId:        booking._id,
        chairId:          booking.chairRef,
        status:           BOOKING_STATUS.ONGOING,
        serviceStartedAt: booking.serviceStartedAt,
      };
      emitToRoom(io, `salon:${booking.salonRef}`, "booking:serviceStarted", payload);
      emitToRoom(io, `user:${booking.userRef}`,   "booking:serviceStarted", payload);
    }

    return { started: true };

  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER
//////////////////////////////////////////////////////////////

const runAutoStartJob = async () => {
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  let totalStarted = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;
  let iterations   = 0;

  try {
    const now = new Date();

    while (iterations < MAX_ITERATIONS_PER_RUN) {
      const candidates = await Booking
        .find(buildAutoStartQuery(now))
        .select("_id")
        .sort({ startTime: 1 })
        .limit(BATCH_SIZE)
        .lean();

      if (candidates.length === 0) break;

      iterations++;

      for (const candidate of candidates) {
        try {
          const result = await autoStartOneBooking(candidate._id);
          if (result.started) {
            totalStarted++;
            console.info(`${JOB_NAME} Auto-started: ${candidate._id}`);
          } else {
            totalSkipped++;
          }
        } catch (err) {
          totalErrors++;
          console.error(`${JOB_NAME} Failed to auto-start booking ${candidate._id}:`, err.message);
        }
      }

      if (candidates.length < BATCH_SIZE) break;
    }

    if (totalStarted > 0 || totalErrors > 0) {
      console.info(
        `${JOB_NAME} Run complete — started: ${totalStarted} | skipped: ${totalSkipped} | errors: ${totalErrors}`
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

export const startAutoStartJob = (ioInstance) => {
  io = ioInstance;

  runAutoStartJob();

  const intervalHandle = setInterval(runAutoStartJob, INTERVAL_MS);

  console.info(`${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE}`);

  return {
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};
