/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/jobs/fieldAgentEarning.job.js
 *
 * FA-9 — the scheduler for the Field Agent earning engine. Follows
 * this repository's own established background-job precedent exactly
 * (jobs/ratingOutbox.job.js, modules/fieldAgent/jobs/fraudDetection.job.js):
 * plain Node.js `setInterval`, no external queue/cron library,
 * `startXJob()` returning `{stop}`, the same jobHeartbeat.js
 * observability integration every other job already uses.
 *
 * ═══ DISCOVERY (FA-9 Issue 3 correction) ══════════════════════════
 * Cursor is the compound (lastCompletedAt, lastId) — NOT createdAt (a
 * bare createdAt cursor can permanently skip a booking that completes
 * out of creation order; a bare Date cursor alone can skip a same-
 * instant sibling — see FieldAgentEarningJobCheckpoint.js's own
 * header). The query's upper bound additionally excludes the trailing
 * EARNING_JOB_GRACE_PERIOD_MS window, defending against clock skew
 * across app-server instances (completedAt is assigned via `new
 * Date()` at write time on whichever instance handles that request).
 *
 * ═══ CHECKPOINT SAFETY ═════════════════════════════════════════════
 * The checkpoint advances ONLY after every booking in the fetched
 * batch reaches a terminal outcome — never mid-batch, never to "now".
 * This is what makes a crash mid-batch safe: the checkpoint simply
 * isn't advanced, and the next tick re-fetches the identical batch
 * (already-processed bookings are cheap idempotent no-ops). The
 * advance itself is additionally guarded to only ever move forward
 * (monotonic $lt/$lt-or-equal-with-id-tiebreak check), protecting
 * against any theoretical out-of-order commit across parallel salon
 * groups within one batch.
 *
 * ═══ SAME-CLAIM SERIALIZATION (FA-9 Issue 2 correction) ═══════════
 * Bookings are grouped by salonRef (equivalent to grouping by
 * AcquisitionClaim, since at most one ACTIVE claim exists per salon —
 * AcquisitionClaim.js's own unique partial index) and each group is
 * processed strictly sequentially, in the ascending completedAt/_id
 * order already guaranteed by the batch's own query sort. Different
 * salons' groups run fully in parallel via Promise.allSettled. This
 * is what makes "which booking reaches the acquisition target" — and
 * therefore which subsequent booking correctly falls through to
 * Territory Partner — deterministic under concurrency.
 *
 * ═══ POLICY-GAP DURABILITY (FA-9 CORRECTIVE — Finding A-1) ═════════
 * A booking with no applicable policy is durably recorded by
 * fieldAgentEarning.service.js itself (FieldAgentEarningPolicyGap) —
 * NOT tracked via checkpoint position. The main discovery checkpoint
 * is therefore free to advance past a gapped booking on the very same
 * tick (this is intentional, not a bug: the earlier defect was
 * conflating "checkpoint position" with "resolution completeness" —
 * decoupling them means one old unresolved booking never freezes
 * discovery of everything after it). runGapReconciliationTick, called
 * every tick after the main batch, independently reprocesses a small
 * bounded number of OPEN gaps, fully decoupled from wherever the main
 * cursor currently sits — a gap can be resolved (or keep failing)
 * regardless of what the checkpoint is doing.
 *
 * INTEGRATION (server.js, alongside the other background jobs):
 *   import { startFieldAgentEarningJob } from "./modules/fieldAgent/jobs/fieldAgentEarning.job.js";
 *   const fieldAgentEarningJob = startFieldAgentEarningJob();
 *   ...
 *   fieldAgentEarningJob.stop(); // in shutdown()
 */

import mongoose from "mongoose";
import Booking, { BOOKING_STATUS } from "../../../models/Booking.js";
import FieldAgentEarningJobCheckpoint from "../models/FieldAgentEarningJobCheckpoint.js";
import { processCompletedBooking, listOpenGaps, reprocessOneGap } from "../services/fieldAgentEarning.service.js";
import { EARNING_ENTITLEMENT_TYPE } from "../constants/fieldAgentEarning.constants.js";
import FieldAgent from "../models/FieldAgent.js";
import NotificationService from "../../../services/NotificationService.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { NOTIFICATION_EVENTS } from "../../notifications/constants/notificationEvents.constants.js";
import {
  EARNING_JOB_INTERVAL_MS,
  EARNING_JOB_BATCH_SIZE,
  EARNING_JOB_GRACE_PERIOD_MS,
  EARNING_JOB_CHECKPOINT_ID,
  GAP_RECONCILE_BATCH_SIZE,
} from "../constants/fieldAgentEarning.constants.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";

const formatPaiseAsRupees = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// FA-P2-A — "Referral Reward Credited". Deliberately lives HERE, not
// in fieldAgentEarning.service.js — that file's own header declares a
// locked, non-negotiable boundary ("the only documents this file ever
// writes are AcquisitionEarningProgress and FieldAgentEarningLedger");
// adding a notification side-effect there, however harmless, would
// still be a new responsibility inside a file explicitly scoped away
// from having one. This job is processCompletedBooking's ONLY caller
// (per that file's own header), so wiring the notification at the
// call site achieves the same outcome with zero risk to the locked
// financial engine. Fires at most once per booking — gated on
// `!alreadyProcessed` (an idempotent-replay booking, e.g. after a
// crash-restart, never re-notifies) and only for the ACQUISITION
// entitlement (a Territory Partner's ongoing commission share is a
// different, unnamed event — out of this phase's named 7). Never
// awaited by the caller in a way that can fail the tick — errors are
// caught and logged, exactly like every other per-booking failure
// path in this job.
const notifyReferralRewardCredited = async (result) => {
  try {
    if (!result || result.alreadyProcessed) return;
    if (result.entitlementType !== EARNING_ENTITLEMENT_TYPE.ACQUISITION) return;
    if (!(result.creditedAmountInPaise > 0)) return;

    const fieldAgent = await FieldAgent.findById(result.fieldAgentRef).select("userRef").lean();
    if (!fieldAgent) return;

    await NotificationService.send(
      {
        recipientId:   fieldAgent.userRef,
        recipientType: "FIELD_AGENT",
        templateKey:   NOTIFICATION_EVENTS.REFERRAL_REWARD_CREDITED,
        variables:     { amount: formatPaiseAsRupees(result.creditedAmountInPaise) },
        title:         "Referral Reward Credited",
        message:       `You've earned ${formatPaiseAsRupees(result.creditedAmountInPaise)} from a referred salon's booking.`,
        type:          "SYSTEM",
        priority:      "MEDIUM",
        actionType:    "OPEN_WALLET",
        actionUrl:     "/field-agent/earnings",
        entityType:    "BOOKING",
        entityId:      result.bookingId,
        meta:          { creditedAmountInPaise: result.creditedAmountInPaise, bookingId: result.bookingId },
      },
      [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH]
    );
  } catch (err) {
    logger.warn(`${JOB_NAME} REFERRAL_REWARD_CREDITED notification failed (non-critical)`, { message: err.message });
  }
};

const JOB_NAME = "[FieldAgentEarningJob]";
const MIN_OBJECT_ID = new mongoose.Types.ObjectId("000000000000000000000000");

let intervalHandle = null;
let isRunning = false;

const ensureCheckpointExists = () =>
  FieldAgentEarningJobCheckpoint.updateOne(
    { _id: EARNING_JOB_CHECKPOINT_ID },
    { $setOnInsert: { lastCompletedAt: new Date(0), lastId: MIN_OBJECT_ID } },
    { upsert: true }
  );

const fetchDiscoveryBatch = async (checkpoint, safeUpperBound) =>
  Booking.find({
    status: BOOKING_STATUS.COMPLETED,
    completedAt: { $lte: safeUpperBound },
    $or: [
      { completedAt: { $gt: checkpoint.lastCompletedAt } },
      { completedAt: checkpoint.lastCompletedAt, _id: { $gt: checkpoint.lastId } },
    ],
  })
    .select("_id salonRef commissionAmountInPaise completedAt")
    .sort({ completedAt: 1, _id: 1 })
    .limit(EARNING_JOB_BATCH_SIZE)
    .lean();

const groupBySalon = (batch) => {
  const groups = new Map();
  for (const booking of batch) {
    const key = String(booking.salonRef);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(booking);
  }
  return [...groups.values()];
};

// Guarded, forward-only advance — never regresses the checkpoint even
// if called with an out-of-order tail (defense in depth; the batch
// design above should never actually produce that call).
const advanceCheckpoint = (tail) =>
  FieldAgentEarningJobCheckpoint.updateOne(
    {
      _id: EARNING_JOB_CHECKPOINT_ID,
      $or: [{ lastCompletedAt: { $lt: tail.completedAt } }, { lastCompletedAt: tail.completedAt, lastId: { $lt: tail._id } }],
    },
    { $set: { lastCompletedAt: tail.completedAt, lastId: tail._id, updatedAt: new Date() } }
  );

// FA-9 CORRECTIVE (Finding A-1) — independently reprocesses a small,
// bounded number of OPEN gaps every tick. Deliberately decoupled from
// the main discovery batch/checkpoint above: a gap's resolution never
// depends on, or blocks, wherever the main cursor currently sits.
// Errors here are logged and swallowed per-gap (never let one bad gap
// crash the whole tick or the main discovery batch that follows it in
// the same tick).
const runGapReconciliationTick = async () => {
  const gaps = await listOpenGaps(GAP_RECONCILE_BATCH_SIZE);
  if (!gaps.length) return { attempted: 0, resolved: 0 };

  let resolved = 0;
  for (const gap of gaps) {
    try {
      const result = await reprocessOneGap(gap);
      if (result.reprocessed) resolved++;
    } catch (err) {
      logger.error(`${JOB_NAME} gap reconciliation failed for ${gap.referenceKey}`, { message: err.message });
    }
  }
  return { attempted: gaps.length, resolved };
};

export const runEarningJobTick = async () => {
  if (isRunning) return; // in-process overlap courtesy only, mirrors fraudDetection.job.js
  isRunning = true;
  recordStart(JOB_NAME, { intervalMs: EARNING_JOB_INTERVAL_MS });
  try {
    await ensureCheckpointExists();
    const checkpoint = await FieldAgentEarningJobCheckpoint.findById(EARNING_JOB_CHECKPOINT_ID).lean();
    const safeUpperBound = new Date(Date.now() - EARNING_JOB_GRACE_PERIOD_MS);

    const batch = await fetchDiscoveryBatch(checkpoint, safeUpperBound);

    if (batch.length) {
      const groups = groupBySalon(batch);
      const settled = await Promise.allSettled(
        groups.map(async (group) => {
          for (const booking of group) {
            const result = await processCompletedBooking(booking);
            await notifyReferralRewardCredited(result);
          }
        })
      );

      const failures = settled.filter((r) => r.status === "rejected");
      if (failures.length) {
        // Do NOT advance the checkpoint past a batch containing a
        // genuine failure (a thrown exception — e.g. retry exhaustion)
        // — the entire batch is safely retried next tick; groups that
        // already succeeded are cheap idempotent no-ops on replay.
        // NOTE: a PENDING_POLICY_GAP/PENDING_CLAIM_PROGRESS_GAP outcome
        // is NOT a failure here — it is a normal, resolved promise,
        // durably tracked by fieldAgentEarning.service.js itself
        // (FieldAgentEarningPolicyGap), independently reprocessed by
        // runGapReconciliationTick below. The checkpoint is free to
        // advance past such bookings (FA-9 Finding A-1 correction).
        logger.error(`${JOB_NAME} tick had ${failures.length} failing salon group(s) of ${groups.length}`, {
          firstError: failures[0].reason?.message,
        });
        recordFailure(JOB_NAME, failures[0].reason);
        return;
      }

      const tail = batch[batch.length - 1];
      await advanceCheckpoint(tail);
      logger.info(`${JOB_NAME} tick complete`, { processed: batch.length, salonGroups: groups.length });
    }

    const gapResult = await runGapReconciliationTick();
    if (gapResult.attempted) {
      logger.info(`${JOB_NAME} gap reconciliation`, gapResult);
    }

    recordSuccess(JOB_NAME);
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
};

export const startFieldAgentEarningJob = () => {
  runEarningJobTick();
  intervalHandle = setInterval(runEarningJobTick, EARNING_JOB_INTERVAL_MS);

  logger.info(`${JOB_NAME} Started`, { intervalMs: EARNING_JOB_INTERVAL_MS });

  return {
    stop: () => {
      if (intervalHandle) clearInterval(intervalHandle);
      logger.info(`${JOB_NAME} Stopped`);
    },
  };
};

// Exported for the disposable-script verification methodology this
// project uses — never imported by any route/controller.
export const _internal = {
  runEarningJobTick,
  fetchDiscoveryBatch,
  groupBySalon,
  advanceCheckpoint,
  ensureCheckpointExists,
  runGapReconciliationTick,
};
