/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/jobs/notificationRetry.job.js
 *
 * FA-P2-A — Notification Engine reliability. Retries a FAILED PUSH
 * NotificationDeliveryLog row, using exactly the fields
 * NotificationDeliveryLog.js has carried — documented as unused —
 * since Phase 1 (attemptCount, nextRetryAt, processingStartedAt,
 * lastError). No schema change was needed for this job at all.
 *
 * Follows this repository's own established background-job precedent
 * exactly (jobs/ratingOutbox.job.js, modules/fieldAgent/jobs/
 * fraudDetection.job.js): plain Node.js setInterval, no external
 * queue/cron library, startXJob() returning {stop}, jobHeartbeat.js
 * observability.
 *
 * CLAIM is one atomic findOneAndUpdate (FAILED + processingStartedAt
 * null/stale -> processingStartedAt:now), so two backend instances
 * polling at the same instant can never both retry the same row —
 * mirrors ratingOutbox.job.js's own claim step exactly, just without
 * an intermediate "PROCESSING" status value (this model has no such
 * status — processingStartedAt itself IS the claim marker, avoiding
 * a schema/enum change).
 *
 * After MAX_ATTEMPTS_BEFORE_FAILED, a row moves to FAILED_PERMANENT
 * and is never retried again — always inspectable, never silently
 * lost, per DELIVERY_STATUS's own documented lifecycle.
 *
 * Scope: PUSH channel only. IN_APP is written synchronously at
 * creation time (never fails in a way that benefits from a retry —
 * see NotificationService.js) and SMS/EMAIL/WHATSAPP are still
 * PENDING-placeholder-only channels this phase does not target.
 *
 * INTEGRATION (server.js, alongside the other background jobs):
 *   import { startNotificationRetryJob } from "./modules/notifications/jobs/notificationRetry.job.js";
 *   const notificationRetryJob = startNotificationRetryJob();
 *   ...
 *   notificationRetryJob.stop(); // in shutdown()
 */

import NotificationDeliveryLog from "../models/NotificationDeliveryLog.js";
import Notification from "../../../models/Notification.js";
import PushProvider from "../providers/PushProvider.js";
import { DELIVERY_STATUS, NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";

const INTERVAL_MS = 30 * 1000; // poll every 30 seconds — push retries are not as time-critical as the rating outbox
const BATCH_SIZE = 25;
const STALE_CLAIM_MS = 2 * 60 * 1000; // 2 minutes — same abandoned-worker assumption as ratingOutbox.job.js
const MAX_ATTEMPTS_BEFORE_FAILED = 5;
const JOB_NAME = "[NotificationRetryJob]";

let isRunning = false;
let intervalHandle = null;

//////////////////////////////////////////////////////////////
// CLAIM ONE FAILED PUSH ROW — atomic, multi-instance-safe
//////////////////////////////////////////////////////////////

async function claimOneFailedDelivery() {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

  return NotificationDeliveryLog.findOneAndUpdate(
    {
      channel: NOTIFICATION_CHANNEL.PUSH,
      status: DELIVERY_STATUS.FAILED,
      attemptCount: { $lt: MAX_ATTEMPTS_BEFORE_FAILED },
      $or: [
        { processingStartedAt: null },
        { processingStartedAt: { $lt: staleThreshold } },
      ],
    },
    { $set: { processingStartedAt: now } },
    { sort: { updatedAt: 1 }, new: true }
  );
}

//////////////////////////////////////////////////////////////
// RETRY ONE CLAIMED ROW
//////////////////////////////////////////////////////////////

async function retryClaimedDelivery(deliveryLog) {
  try {
    if (!deliveryLog.notificationId) {
      // Nothing to resend without the original content — dead end,
      // never retried again (distinct from a real send failure).
      await NotificationDeliveryLog.updateOne(
        { _id: deliveryLog._id },
        { $set: { status: DELIVERY_STATUS.FAILED_PERMANENT, lastError: "NO_NOTIFICATION_REFERENCE", processingStartedAt: null } }
      );
      return { retried: false };
    }

    const notification = await Notification.findById(deliveryLog.notificationId).lean();
    if (!notification) {
      await NotificationDeliveryLog.updateOne(
        { _id: deliveryLog._id },
        { $set: { status: DELIVERY_STATUS.FAILED_PERMANENT, lastError: "NOTIFICATION_NOT_FOUND", processingStartedAt: null } }
      );
      return { retried: false };
    }

    const pushResult = await PushProvider.send({
      recipientType: deliveryLog.recipientType,
      recipientId:   deliveryLog.recipientId,
      title:         notification.title,
      message:       notification.message,
      actionType:    notification.actionType,
      actionUrl:     notification.actionUrl,
      entityType:    notification.entityType,
      entityId:      notification.entityId,
    });

    if (pushResult.success) {
      await NotificationDeliveryLog.updateOne(
        { _id: deliveryLog._id },
        {
          $set: {
            status:             DELIVERY_STATUS.SENT,
            provider:           pushResult.provider ?? null,
            providerMessageId:  pushResult.messageId ?? null,
            sentAt:             new Date(),
            lastError:          null,
            processingStartedAt: null,
          },
        }
      );
      return { retried: true, success: true };
    }

    const nextAttemptCount = deliveryLog.attemptCount + 1;
    const nextStatus = nextAttemptCount >= MAX_ATTEMPTS_BEFORE_FAILED
      ? DELIVERY_STATUS.FAILED_PERMANENT
      : DELIVERY_STATUS.FAILED;

    await NotificationDeliveryLog.updateOne(
      { _id: deliveryLog._id },
      {
        $set: {
          status: nextStatus,
          attemptCount: nextAttemptCount,
          lastError: pushResult.error || "PUSH_RETRY_FAILED",
          processingStartedAt: null,
        },
      }
    );
    return { retried: true, success: false };
  } catch (err) {
    logger.error(`${JOB_NAME} failed to retry delivery ${deliveryLog._id}`, { message: err.message });
    // Release the claim so a later tick (or the stale-claim path) can
    // try again — never leave a row permanently stuck mid-claim.
    await NotificationDeliveryLog.updateOne(
      { _id: deliveryLog._id },
      { $set: { processingStartedAt: null, lastError: err.message } }
    ).catch((updateErr) => {
      logger.error(`${JOB_NAME} failed to release claim for ${deliveryLog._id}`, { message: updateErr.message });
    });
    return { retried: false, error: err.message };
  }
}

//////////////////////////////////////////////////////////////
// MAIN TICK
//////////////////////////////////////////////////////////////

async function runRetryTick() {
  if (isRunning) return;
  isRunning = true;

  try {
    recordStart(JOB_NAME, { intervalMs: INTERVAL_MS });
    let retriedCount = 0;
    let sentCount = 0;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const deliveryLog = await claimOneFailedDelivery();
      if (!deliveryLog) break;

      const result = await retryClaimedDelivery(deliveryLog);
      if (result.retried) retriedCount++;
      if (result.success) sentCount++;
    }

    if (retriedCount > 0) {
      logger.info(`${JOB_NAME} tick complete`, { retriedCount, sentCount });
    }
    recordSuccess(JOB_NAME);
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
}

//////////////////////////////////////////////////////////////
// EXPORTED STARTER
//////////////////////////////////////////////////////////////

export const startNotificationRetryJob = () => {
  runRetryTick();
  intervalHandle = setInterval(runRetryTick, INTERVAL_MS);

  logger.info(`${JOB_NAME} Started`, { intervalMs: INTERVAL_MS, batchSize: BATCH_SIZE });

  return {
    stop: () => {
      if (intervalHandle) clearInterval(intervalHandle);
      logger.info(`${JOB_NAME} Stopped`);
    },
  };
};

// Exported for the disposable-script verification methodology this
// project uses — never imported by any route/controller.
export const _internal = { claimOneFailedDelivery, retryClaimedDelivery, runRetryTick };
