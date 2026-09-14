/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/jobs/fraudDetection.job.js
 *
 * FA-7.2 — the scheduler for the fraud detection engine. Follows this
 * repository's own established background-job precedent exactly
 * (jobs/ratingOutbox.job.js, modules/kyc/jobs/fieldAgentKycSync.job.js):
 * plain Node.js `setInterval`, no external queue/cron library,
 * `startXJob()` returning `{stop}`, an immediate first tick on start,
 * the same jobHeartbeat.js observability integration every other job
 * already uses.
 *
 * Deliberately SIMPLER than either reference job: there is no
 * per-event claim step here (fraudDetection.service.js's two
 * detectors are pure read-then-idempotent-write, never "apply one
 * event's effect exactly once onto a different mutable document"), so
 * no PENDING/PROCESSING state, no stale-claim reclaim, and no
 * persisted watermark are needed. "The last fully-closed hour" is
 * recomputed live from `Date.now()` on every tick, making this job
 * fully stateless and restart-safe by construction: a crash, a
 * skipped tick, or two overlapping ticks all converge on the same
 * result via FraudSignal's own dedupeKey idempotency (FA-7.1) — never
 * a duplicate signal, never a correctness issue.
 *
 * `isRunning` below is in-process overlap avoidance only (a courtesy,
 * not a correctness requirement) — even without it, two genuinely
 * concurrent ticks (in this process or a different one) would still
 * be safe, because the real safety property lives in MongoDB's unique
 * dedupeKey index, not in this flag.
 *
 * Startup performs exactly ONE closed-hour bucket — never a
 * historical backfill.
 *
 * INTEGRATION (server.js, alongside the other background jobs):
 *   import { startFraudDetectionJob } from "./modules/fieldAgent/jobs/fraudDetection.job.js";
 *   const fraudDetectionJob = startFraudDetectionJob();
 *   ...
 *   fraudDetectionJob.stop(); // in shutdown()
 */

import { runDetectionForClosedBucket } from "../services/fraudDetection.service.js";
import {
  JOB_INTERVAL_MS,
  REFERRAL_VELOCITY_THRESHOLD_PLACEHOLDER,
  WITHDRAW_RECLAIM_CYCLE_THRESHOLD_PLACEHOLDER,
} from "../constants/fraudDetection.constants.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";

const JOB_NAME = "[FraudDetectionJob]";

let intervalHandle = null;
let isRunning = false;

// Truncates to the start of the CURRENT hour, then steps back one
// hour — always the most recently fully-elapsed hour, never the
// still-accumulating current one. UTC throughout, matching this
// codebase's own convention (every other job/model here uses UTC
// Date arithmetic, never local-timezone assumptions).
export const computeClosedHourBucket = (referenceDate = new Date()) => {
  const bucketEnd = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
      referenceDate.getUTCHours(),
      0,
      0,
      0
    )
  );
  const bucketStart = new Date(bucketEnd.getTime() - 60 * 60 * 1000);
  return { bucketStart, bucketEnd };
};

export const runDetectionTick = async () => {
  if (isRunning) return; // in-process overlap courtesy only — see file header
  isRunning = true;
  recordStart(JOB_NAME, { intervalMs: JOB_INTERVAL_MS });
  try {
    const { bucketStart, bucketEnd } = computeClosedHourBucket();
    const result = await runDetectionForClosedBucket({
      bucketStart,
      bucketEnd,
      referralVelocityThreshold: REFERRAL_VELOCITY_THRESHOLD_PLACEHOLDER,
      withdrawReclaimThreshold: WITHDRAW_RECLAIM_CYCLE_THRESHOLD_PLACEHOLDER,
    });
    logger.info(`${JOB_NAME} tick complete`, {
      bucketStart,
      bucketEnd,
      referralVelocitySignals: result.referralVelocitySignals.length,
      withdrawReclaimSignals: result.withdrawReclaimSignals.length,
    });
    recordSuccess(JOB_NAME);
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
};

export const startFraudDetectionJob = () => {
  runDetectionTick();
  intervalHandle = setInterval(runDetectionTick, JOB_INTERVAL_MS);

  logger.info(`${JOB_NAME} Started`, { intervalMs: JOB_INTERVAL_MS });

  return {
    stop: () => {
      if (intervalHandle) clearInterval(intervalHandle);
      logger.info(`${JOB_NAME} Stopped`);
    },
  };
};

// Exported for the disposable-script verification methodology this
// project uses (see project conventions) — never imported by any
// route/controller.
export const _internal = { computeClosedHourBucket, runDetectionTick };
