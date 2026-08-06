/**
 * ============================================================
 * ⏰ REMINDER JOB (Booking Engine V2 — Phase 6)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Sends the customer a reminder 30 minutes and 5 minutes before
 * their CONFIRMED appointment's startTime, per the approved
 * business flow.
 *
 * HOW IT WORKS
 * ────────────
 *   Every 60 seconds, two independent flag-once passes:
 *     1. CONFIRMED bookings whose startTime is within the next
 *        30 minutes (and reminder30MinSentAt is still null) →
 *        notify + set reminder30MinSentAt.
 *     2. Same for the 5-minute window / reminder5MinSentAt.
 *   Same "one-sided threshold crossed, flag once, never re-fire"
 *   pattern as every other job in this codebase (holdExpiry,
 *   customerArrival, serviceOverdue) — not an exact-instant match,
 *   so a slow tick can never cause a reminder to be silently
 *   skipped, only slightly late.
 *
 * DESIGN DECISIONS
 * ────────────────
 *   - No wallet, no status transition — pure notification + a
 *     flag, so a plain atomic findOneAndUpdate is sufficient
 *     (same reasoning as serviceOverdue.job.js — no session needed).
 *   - Each booking processed individually so one failure doesn't
 *     block the rest of the batch.
 *   - Notification only (NotificationService) — no SMS, no socket
 *     event, matching the approved plan exactly.
 *
 * INTEGRATION
 * ───────────
 *   In server.js, alongside the existing jobs:
 *     import { startReminderJob } from "./jobs/reminder.job.js";
 *     const reminderJob = startReminderJob();
 *   In shutdown():
 *     reminderJob.stop();
 * ============================================================
 */

import Booking from "../models/Booking.js";
import NotificationService from "../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import { BOOKING_STATUS } from "../utils/bookingState.machine.js";
import { toFriendlyId } from "../utils/friendlyId.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS = 60 * 1000; // run every 60 seconds
const BATCH_SIZE  = 50;
const JOB_NAME     = "[ReminderJob]";

const REMINDER_30_MIN_MS = 30 * 60 * 1000;
const REMINDER_5_MIN_MS  = 5  * 60 * 1000;

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false;

//////////////////////////////////////////////////////////////
// 🔐 RUN ONE REMINDER PASS (30-min or 5-min)
//////////////////////////////////////////////////////////////

const runReminderPass = async ({ windowMs, sentAtField, label, buildMessage, templateKey, now }) => {
  const query = {
    status:               BOOKING_STATUS.CONFIRMED,
    [sentAtField]:         null,
    startTime:            { $gt: now, $lte: new Date(now.getTime() + windowMs) },
  };

  const candidates = await Booking
    .find(query)
    .select("_id userRef serviceRefs startTime")
    .limit(BATCH_SIZE)
    .populate("serviceRefs", "name");

  let sentCount  = 0;
  let errorCount = 0;

  for (const booking of candidates) {
    try {
      // Atomic — only one process/tick can ever win this flag-set for
      // a given booking, same guard pattern as serviceOverdue.job.js.
      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, status: BOOKING_STATUS.CONFIRMED, [sentAtField]: null },
        { $set: { [sentAtField]: now } },
        { new: true, select: "_id userRef" }
      );

      if (!updated) continue; // lost the race or state changed — safe skip

      const serviceNames = (booking.serviceRefs || []).map(s => s.name).join(", ") || "your service";

      await NotificationService.send({
        recipientId:   booking.userRef,
        recipientType: "USER",
        templateKey,
        variables:     { serviceNames },
        title:         label,
        message:       buildMessage(serviceNames),
        type:          "BOOKING",
        priority:      "MEDIUM",
        actionType:    "OPEN_BOOKING",
        actionUrl:     `/bookings/${booking._id}`,
        meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
      });

      sentCount++;
    } catch (err) {
      errorCount++;
      console.error(`${JOB_NAME} Failed to send ${label} for booking ${booking._id}:`, err.message);
    }
  }

  return { sentCount, errorCount };
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER
//////////////////////////////////////////////////////////////

const runReminderJob = async () => {
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  try {
    const now = new Date();

    const [thirtyMin, fiveMin] = await Promise.all([
      runReminderPass({
        windowMs:    REMINDER_30_MIN_MS,
        sentAtField: "reminder30MinSentAt",
        label:       "Appointment Reminder",
        buildMessage: (services) => `Your appointment for ${services} is in 30 minutes.`,
        templateKey: NOTIFICATION_EVENTS.BOOKING_REMINDER_30MIN,
        now,
      }),
      runReminderPass({
        windowMs:    REMINDER_5_MIN_MS,
        sentAtField: "reminder5MinSentAt",
        label:       "Appointment Starting Soon",
        buildMessage: (services) => `Your appointment for ${services} is in 5 minutes — please head to the salon.`,
        templateKey: NOTIFICATION_EVENTS.BOOKING_REMINDER_5MIN,
        now,
      }),
    ]);

    const totalSent   = thirtyMin.sentCount + fiveMin.sentCount;
    const totalErrors = thirtyMin.errorCount + fiveMin.errorCount;

    if (totalSent > 0 || totalErrors > 0) {
      console.info(
        `${JOB_NAME} Run complete — 30min: ${thirtyMin.sentCount} sent | ` +
        `5min: ${fiveMin.sentCount} sent | errors: ${totalErrors}`
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
 * Start the reminder background job. No io needed — notification
 * only, no socket emit.
 *
 * @returns {{ stop: () => void }}
 */
export const startReminderJob = () => {
  runReminderJob();

  const intervalHandle = setInterval(runReminderJob, INTERVAL_MS);

  console.info(`${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s | batch: ${BATCH_SIZE}`);

  return {
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};
