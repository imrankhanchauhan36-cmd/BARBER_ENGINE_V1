/**
 * ============================================================
 * ✅ AUTO COMPLETE JOB (Booking Engine V2 — Phase 4)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Automatically completes an ONGOING booking that has been
 * overdue (serviceOverdue.job.js's flag) for long enough that no
 * salon-owner action (manual complete, or a Phase-3 extend) has
 * happened. Status still becomes COMPLETED via the exact same
 * transition every manual completion uses — this job never
 * invents a new status, it only supplies a SYSTEM-triggered
 * caller for a transition (ONGOING → COMPLETED) that already
 * existed before this feature.
 *
 * THIS JOB DOES NOT CALL completeService() DIRECTLY
 * ───────────────────────────────────────────────────
 * completeService() is an Express handler — it reads req.user._id
 * (for assertSalonOwnership) and req.app.get("io"), neither of
 * which exist for a cron job, and there is no "acting owner" for
 * a system-triggered completion anyway. forceComplete() already
 * establishes the precedent for this exact situation elsewhere in
 * booking.controller.js: it does not call completeService() either
 * — it independently orchestrates the SAME shared primitives
 * (WalletBalanceService, transitionBookingStatus, NotificationService).
 * This job follows that same, already-shipped shape.
 *
 * HOW IT WORKS
 * ────────────
 *   Every 60 seconds, in pages until none remain:
 *     1. Query ONGOING, not yet autoCompleted, already overdue-
 *        flagged bookings whose bare (serviceStartedAt + serviceDuration)
 *        has passed (a wide PRE-FILTER — see buildAutoCompleteQuery's own
 *        comment for why this can't resolve per-service grace itself),
 *        and whose overdueOverrideUntil is either unset or already
 *        expired.
 *     2. For each candidate: open a mongoose session/transaction,
 *        RE-FETCH the booking inside it, resolve the REAL grace
 *        threshold (resolveAutoCompleteGraceMinutes — per-service
 *        Service.autoCompleteGraceMinutes override, MAX across the
 *        booking's services, falling back to AUTO_COMPLETE_GRACE_MINUTES
 *        when a service has none), and re-verify every guard condition
 *        before writing anything — the exact same "re-fetch inside
 *        session, abort if stale" pattern holdExpiry.job.js already
 *        uses for this identical class of problem (something changed,
 *        or simply isn't due yet, between the outer pre-filter and
 *        this job actually getting to it).
 *     3. Verify the PAID payment Transaction exists (same hard
 *        block completeService() already applies).
 *     4. WalletBalanceService.releasePendingToAvailable — SAME
 *        function, SAME idempotencyKey format
 *        (`booking:release:${bookingId}`) completeService()/
 *        forceComplete() already use. WalletLedger.idempotencyKey
 *        is unique+sparse at the schema level — this is the actual
 *        database-enforced guarantee against a double release, not
 *        just a style match.
 *     5. autoCompleted = true, push an AUTO_COMPLETED timelineEvent,
 *        THEN transitionBookingStatus (reused, unmodified) —
 *        ONGOING → COMPLETED, same transition completeService() uses.
 *     6. Service.updateMany bookingCount++ — same as completeService().
 *     7. Commit. Post-commit: invalidateNextSlotCache (reused —
 *        already no-ops safely if Redis is down), 2 notifications
 *        (auto-complete-specific copy), emit the EXISTING
 *        "booking:completed" event (not a new event) to salon+user
 *        rooms AND the "admin" room (already joined by admin
 *        sockets in socket/index.js — just never targeted before).
 *
 * WHAT THIS JOB DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────
 *   - No new BOOKING_STATUS value.
 *   - No new wallet math — every call goes through
 *     WalletBalanceService, the sole authority for SalonEarnings.
 *   - No explicit "chair release" — chair occupancy is derived
 *     from status membership in Booking.js's partial index; the
 *     moment status commits to COMPLETED the chair is already free.
 *   - No new socket event name — booking:completed is extended
 *     with autoCompleted: true, not replaced or duplicated.
 *   - No retry loop for transient transaction errors — matches
 *     every existing controller/job in this codebase (none of them
 *     retry either); a failed attempt simply remains a candidate
 *     on the next 60s tick, since nothing was persisted.
 *
 * INTEGRATION (NOT wired up in this phase — file only, matching
 * how serviceOverdue.job.js was left in Phase 2 until reviewed)
 * ───────────
 *   In server.js, alongside the existing jobs:
 *
 *     import { startAutoCompleteJob } from "./jobs/autoComplete.job.js";
 *     const autoCompleteJob = startAutoCompleteJob(io);
 *
 *   In shutdown():
 *     autoCompleteJob.stop();
 *
 * ============================================================
 */

import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import Transaction, { TRANSACTION_STATUS, TRANSACTION_TYPE } from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";
import NotificationService from "../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import { invalidateNextSlotCache } from "../services/slotEngine.service.js";
import { BOOKING_STATUS, transitionBookingStatus } from "../utils/bookingState.machine.js";
import { toFriendlyId } from "../utils/friendlyId.js";
import { emitToRoom } from "../socket/index.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS            = 60 * 1000; // run every 60 seconds
const BATCH_SIZE             = 50;         // rows fetched per page
const MAX_ITERATIONS_PER_RUN = 20;         // safety valve: max 20 pages (1000 bookings) per tick
const JOB_NAME                = "[AutoCompleteJob]";

// Separate, LONGER grace than serviceOverdue.job.js's 10-minute
// overdue flag — this is the real reaction window a salon owner
// gets (see the Phase-3 "Extend"/"Complete" banner) before the
// system completes the booking for them. Platform-wide fallback —
// used only for a service with no autoCompleteGraceMinutes override
// (see resolveAutoCompleteGraceMinutes below).
const AUTO_COMPLETE_GRACE_MINUTES = 20;

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false; // prevents overlapping executions (single process)
let io        = null;  // Socket.IO instance — injected at startup

//////////////////////////////////////////////////////////////
// 🔎 CANDIDATE QUERY BUILDER
//
// $expr evaluates a PRE-FILTER threshold IN THE DATABASE — deliberately
// using +0 grace (bare duration only), not AUTO_COMPLETE_GRACE_MINUTES.
//
// Per-service grace overrides (Service.autoCompleteGraceMinutes) live on
// a different collection than Booking, and this is a plain .find(), not
// a $lookup aggregation — a single flat $expr cannot resolve a per-
// document override from another collection. So this query can only ever
// be a WIDE, safe pre-filter: "already past bare duration, may or may not
// actually be due yet." The REAL, per-service-resolved threshold is
// re-checked authoritatively inside autoCompleteOneBooking below, where
// the booking (and its services) are already fetched. This guarantees a
// SHORTER per-service override is never excluded here before it's even
// evaluated, and a LONGER one is correctly skipped by the real check
// downstream — at the cost of some bookings entering this pre-filter
// earlier than they'll actually be acted on (a bounded, cheap trade-off:
// ONGOING-at-any-instant is already a small, chair-bounded set — same
// reasoning that justified no new index in Phase 2/4).
//
// overdueOverrideUntil check is corrected from a strict "== null" —
// Phase 3 never clears this field back to null once an extension
// expires, so a strict null-check would let a single past extension
// permanently exempt a booking from ever auto-completing. Correct
// condition: no override was ever set, OR the one that was set has
// already expired.
//////////////////////////////////////////////////////////////

const buildAutoCompleteQuery = (now) => ({
  status:           BOOKING_STATUS.ONGOING,
  autoCompleted:    false,
  serviceOverdueAt: { $ne: null },
  serviceStartedAt: { $ne: null },
  $or: [
    { overdueOverrideUntil: null },
    { overdueOverrideUntil: { $lte: now } },
  ],
  $expr: {
    $lte: [
      {
        $add: [
          "$serviceStartedAt",
          { $multiply: [{ $add: ["$serviceDuration", 0] }, 60 * 1000] },
        ],
      },
      now,
    ],
  },
});

//////////////////////////////////////////////////////////////
// 🔎 RESOLVE EFFECTIVE GRACE FOR ONE BOOKING
//
// Per-service override wins over the global default; the global
// default is used ONLY when a service has no override at all
// (null/undefined). Across multiple booked services, the MAX
// resolved grace wins — a booking should never auto-complete
// before the most generous configured service on it says it's
// safe to.
//////////////////////////////////////////////////////////////

const resolveAutoCompleteGraceMinutes = (services) => {
  if (!Array.isArray(services) || services.length === 0) {
    return AUTO_COMPLETE_GRACE_MINUTES;
  }

  const resolvedPerService = services.map(
    (service) => service.autoCompleteGraceMinutes ?? AUTO_COMPLETE_GRACE_MINUTES
  );

  return Math.max(...resolvedPerService);
};

//////////////////////////////////////////////////////////////
// 🔐 AUTO-COMPLETE ONE BOOKING — ATOMIC SESSION
//
// Mirrors holdExpiry.job.js's own pattern for this exact class of
// problem: re-fetch inside the session for a consistent snapshot,
// re-verify every guard, abort+skip (not error) if anything has
// changed since the outer candidate query ran.
//////////////////////////////////////////////////////////////

const autoCompleteOneBooking = async (candidateId, now) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findById(candidateId).session(session);

    //////////////////////////////////////////////////////////
    // 🔁 RE-VERIFY EVERY GUARD — booking may have changed between
    // the outer candidate query and this transaction starting
    // (manual complete, manual extend, cancellation, etc.)
    //////////////////////////////////////////////////////////

    if (!booking || booking.status !== BOOKING_STATUS.ONGOING || booking.autoCompleted) {
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "Already processed or no longer ONGOING" };
    }

    if (booking.overdueOverrideUntil && booking.overdueOverrideUntil > now) {
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "Active manual extension" };
    }

    if (!booking.serviceStartedAt) {
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "No serviceStartedAt" };
    }

    //////////////////////////////////////////////////////////
    // 🔎 RESOLVE PER-SERVICE GRACE — this is the REAL, authoritative
    // threshold check. The outer candidate query only pre-filters on
    // bare duration (+0 grace); a booking reaching this point may
    // still not actually be due if any of its services has a
    // configured autoCompleteGraceMinutes that hasn't elapsed yet.
    //////////////////////////////////////////////////////////

    const bookedServices = await Service
      .find({ _id: { $in: booking.serviceRefs } })
      .select("autoCompleteGraceMinutes")
      .session(session)
      .lean();

    // Defensive logging only — resolveAutoCompleteGraceMinutes() already
    // falls back safely (global default) regardless of this mismatch;
    // this warning exists purely so a deleted/invalid serviceRef is
    // visible for debugging, not to change behavior.
    if (bookedServices.length !== booking.serviceRefs.length) {
      console.warn(
        `${JOB_NAME} Service count mismatch for booking ${booking._id} — ` +
        `expected ${booking.serviceRefs.length}, fetched ${bookedServices.length}`
      );
    }

    const resolvedGraceMinutes = resolveAutoCompleteGraceMinutes(bookedServices);

    const expectedAutoCompleteAt = new Date(
      booking.serviceStartedAt.getTime() +
      (booking.serviceDuration + resolvedGraceMinutes) * 60 * 1000
    );

    if (expectedAutoCompleteAt > now) {
      // No longer "structurally impossible" — the outer query only
      // guarantees bare duration has elapsed; a per-service grace
      // override can genuinely push the real threshold later than
      // that. A normal, expected skip, not an anomaly.
      await session.abortTransaction();
      session.endSession();
      return { skipped: true, reason: "Not yet due (per-service grace not yet elapsed)" };
    }

    //////////////////////////////////////////////////////////
    // 💰 VERIFY PAYMENT TRANSACTION EXISTS — same hard block
    // completeService() already applies. A missing payment record
    // means this booking was never properly confirmed; the job
    // must NOT complete it, and must NOT mark autoCompleted, so it
    // remains visible (and retried) rather than silently vanishing.
    //////////////////////////////////////////////////////////

    const paymentTxn = await Transaction.findOne({
      bookingId: booking._id,
      type:      TRANSACTION_TYPE.BOOKING,
      status:    TRANSACTION_STATUS.PAID,
    }).session(session);

    if (!paymentTxn) {
      await session.abortTransaction();
      session.endSession();
      return { error: true, reason: "Payment record not found" };
    }

    //////////////////////////////////////////////////////////
    // 💰 RELEASE PENDING → AVAILABLE — same function, same
    // idempotency key format as completeService()/forceComplete().
    //////////////////////////////////////////////////////////

    await WalletBalanceService.releasePendingToAvailable({
      salonId:        booking.salonRef,
      amountInPaise:  paymentTxn.payoutAmount,
      entityType:     "BOOKING",
      entityId:       paymentTxn._id,
      idempotencyKey: `booking:release:${booking._id}`,
      session,
      triggeredBy:    "SYSTEM",
      remarks:        "Service auto-completed — funds released to available balance",
    });

    const currentWallet = await SalonEarnings.findOne({
      salonId: booking.salonRef,
    }).session(session);

    //////////////////////////////////////////////////////////
    // 🧾 TIMELINE — appended BEFORE the transition, per spec.
    // Both land in the same .save() call that transitionBookingStatus
    // performs below.
    //////////////////////////////////////////////////////////

    booking.autoCompleted = true;
    booking.timelineEvents.push({
      eventType:  "AUTO_COMPLETED",
      occurredAt: now,
      actor:      "SYSTEM",
      meta: {
        expectedAutoCompleteAt,
        graceMinutes: resolvedGraceMinutes,
      },
    });

    //////////////////////////////////////////////////////////
    // ✅ TRANSITION TO COMPLETED — reused, unmodified.
    //////////////////////////////////////////////////////////

    await transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.COMPLETED, session });

    //////////////////////////////////////////////////////////
    // 📈 SERVICE BOOKING COUNT — same as completeService().
    //////////////////////////////////////////////////////////

    if (Array.isArray(booking.serviceRefs) && booking.serviceRefs.length) {
      await Service.updateMany(
        { _id: { $in: booking.serviceRefs } },
        { $inc: { bookingCount: 1 } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////////
    // 🗑️ CACHE INVALIDATION — reused; already a safe no-op if
    // Redis is unavailable (see slotEngine.service.js).
    //////////////////////////////////////////////////////////

    await invalidateNextSlotCache(
      booking.salonRef.toString(),
      booking.startTime.toISOString().split("T")[0]
    );

    //////////////////////////////////////////////////////////
    // 📬 NOTIFICATIONS (non-blocking, after commit) — same
    // NotificationService, auto-complete-specific copy so the
    // recipient can tell this apart from a manual completion.
    //////////////////////////////////////////////////////////

    await NotificationService.send({
      recipientId:   booking.salonRef,
      recipientType: "SALON",
      templateKey:   NOTIFICATION_EVENTS.SERVICE_AUTO_COMPLETED_SALON,
      title:         "Service Auto-Completed",
      message:       "Service auto-completed — chair is now free.",
      type:          "BOOKING",
      priority:      "HIGH",
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });

    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      templateKey:   NOTIFICATION_EVENTS.SERVICE_AUTO_COMPLETED_USER,
      title:         "Service Completed",
      message:       "Your service duration ended. Booking automatically completed. Chair released.",
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — reuses the EXISTING "booking:completed" event
    // (not a new one), extended with autoCompleted: true. Salon +
    // user rooms match completeService()'s own emit exactly; the
    // "admin" room is a new THIRD target — already joined by admin
    // sockets in socket/index.js, just never targeted before.
    //////////////////////////////////////////////////////////

    const payload = {
      bookingId:     booking._id,
      chairId:       booking.chairRef,
      status:        BOOKING_STATUS.COMPLETED,
      autoCompleted: true,
      walletBalance: currentWallet?.availableBalanceInPaise ?? 0,
    };

    if (io) {
      emitToRoom(io, `salon:${booking.salonRef}`, "booking:completed", payload);
      emitToRoom(io, `user:${booking.userRef}`,   "booking:completed", payload);
      emitToRoom(io, "admin",                     "booking:completed", payload);
    }

    return { completed: true };

  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err; // caller logs this
  }
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER — pages through candidates until none remain
//////////////////////////////////////////////////////////////

const runAutoCompleteJob = async () => {
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  let totalCompleted = 0;
  let totalSkipped    = 0;
  let totalErrors     = 0;
  let iterations      = 0;

  try {
    const now   = new Date();
    const query = buildAutoCompleteQuery(now);

    while (iterations < MAX_ITERATIONS_PER_RUN) {
      const candidates = await Booking
        .find(query)
        .select("_id")
        .sort({ serviceStartedAt: 1 }) // oldest overdue booking first
        .limit(BATCH_SIZE)
        .lean();

      if (candidates.length === 0) {
        break;
      }

      iterations++;

      // Sequential, not parallel — same rationale as holdExpiry.job.js:
      // don't overwhelm Mongo with many simultaneous transactions
      // during a traffic-spike recovery.
      for (const candidate of candidates) {
        try {
          const result = await autoCompleteOneBooking(candidate._id, now);
          if (result.completed) {
            totalCompleted++;
            console.info(`${JOB_NAME} Auto-completed: ${candidate._id}`);
          } else if (result.error) {
            totalErrors++;
            console.error(`${JOB_NAME} ${candidate._id} — ${result.reason}`);
          } else {
            totalSkipped++;
          }
        } catch (err) {
          totalErrors++;
          console.error(`${JOB_NAME} Failed to auto-complete booking ${candidate._id}:`, err.message);
          // Continue — don't let one failure stop the rest of the batch.
          // No retry loop here: a failed attempt leaves the booking
          // untouched (still ONGOING), so it remains a valid candidate
          // on the next 60s tick — the same "natural retry via next
          // tick" every other job in this codebase already relies on.
        }
      }

      if (candidates.length < BATCH_SIZE) {
        break; // last page
      }
    }

    if (iterations >= MAX_ITERATIONS_PER_RUN) {
      console.warn(
        `${JOB_NAME} Hit MAX_ITERATIONS_PER_RUN (${MAX_ITERATIONS_PER_RUN}) — ` +
        `remaining bookings will be picked up on the next tick`
      );
    }

    if (totalCompleted > 0 || totalErrors > 0) {
      console.info(
        `${JOB_NAME} Run complete — ` +
        `completed: ${totalCompleted} | skipped: ${totalSkipped} | errors: ${totalErrors}`
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
 * Start the auto-complete background job.
 *
 * @param {import("socket.io").Server} ioInstance
 *   The Socket.IO server instance from initSocket().
 *
 * @returns {{ stop: () => void }}
 *
 * NOT called from server.js in this phase — this file only
 * declares the job; wiring it into startup is a later step,
 * matching how serviceOverdue.job.js was left after Phase 2.
 */
export const startAutoCompleteJob = (ioInstance) => {
  io = ioInstance;

  runAutoCompleteJob();

  const intervalHandle = setInterval(runAutoCompleteJob, INTERVAL_MS);

  console.info(
    `${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE} | grace: ${AUTO_COMPLETE_GRACE_MINUTES}min`
  );

  return {
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};
