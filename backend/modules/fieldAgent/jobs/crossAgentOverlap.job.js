/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/jobs/crossAgentOverlap.job.js
 *
 * FA-7.3 — the scheduler for the CROSS_AGENT_SALON_CYCLING detector.
 * Deliberately a SEPARATE job file, not an addition inside the frozen
 * FA-7.2 fraudDetection.job.js: that file's own tick is time-bucketed
 * (closed-hour REFERRAL_VELOCITY) and hardcodes calling
 * fraudDetection.service.js's two FA-7.2 detectors specifically —
 * extending it to also call this detector would require modifying a
 * frozen file for pure convenience, which the FA-7.3 authorization
 * explicitly disfavors ("prefer additive... unless absolutely
 * unavoidable"). This detector has no time-bucket concept at all (per
 * the FA-7.3 lock: "no time window in V1" — it evaluates the full
 * persisted qualifying history every run), so it does not naturally
 * share the closed-hour-bucket shape that job's own tick is built
 * around; a second, equally minimal scheduler is the cleaner choice
 * than reshaping the frozen file's contract to fit a shape it was
 * never designed for.
 *
 * Otherwise follows this repository's own established background-job
 * precedent exactly (jobs/ratingOutbox.job.js,
 * modules/kyc/jobs/fieldAgentKycSync.job.js,
 * modules/fieldAgent/jobs/fraudDetection.job.js): plain Node.js
 * `setInterval`, no external queue/cron library, `startXJob()`
 * returning `{stop}`, an immediate first tick on start, the same
 * jobHeartbeat.js observability integration every other job already
 * uses. `isRunning` is in-process overlap avoidance only (a courtesy,
 * not a correctness requirement) — the real safety property lives in
 * MongoDB's unique dedupeKey index (FA-7.1), not in this flag.
 *
 * INTEGRATION (server.js, alongside the other background jobs):
 *   import { startCrossAgentOverlapJob } from "./modules/fieldAgent/jobs/crossAgentOverlap.job.js";
 *   const crossAgentOverlapJob = startCrossAgentOverlapJob();
 *   ...
 *   crossAgentOverlapJob.stop(); // in shutdown()
 */

import { detectCrossAgentSalonCycling } from "../services/crossAgentOverlap.service.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";

const JOB_NAME = "[CrossAgentOverlapJob]";

// Technical default only (detection granularity), not a business
// threshold — freely adjustable later without business sign-off, same
// distinction fraudDetection.constants.js's own header draws.
const JOB_INTERVAL_MS = 60 * 60 * 1000; // at most hourly

let intervalHandle = null;
let isRunning = false;

export const runDetectionTick = async () => {
  if (isRunning) return; // in-process overlap courtesy only — see file header
  isRunning = true;
  recordStart(JOB_NAME, { intervalMs: JOB_INTERVAL_MS });
  try {
    const signals = await detectCrossAgentSalonCycling();
    logger.info(`${JOB_NAME} tick complete`, { crossAgentSignals: signals.length });
    recordSuccess(JOB_NAME);
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
};

export const startCrossAgentOverlapJob = () => {
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
export const _internal = { runDetectionTick };
