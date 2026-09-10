/**
 * ============================================================
 * 📅 WEEKLY SCHEDULE MATERIALIZER JOB (C4 Phase 2)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Converts each salon's WeeklyScheduleTemplate (C4 Phase 1 — a
 * versioned, day-of-week staff→chair→time PATTERN) into concrete
 * ProfessionalChairAssignment rows for the salon's own rolling booking
 * window (Salon.business.bookingWindowDays, default 7 — today
 * through today+N-1).
 *
 * Without this job:
 *   The owner would have to manually create a ProfessionalChairAssignment
 *   row for every chair/professional/day, forever, by hand.
 *
 * With this job:
 *   The owner defines the pattern once; every day, this job tops up
 *   the rolling window with whatever concrete rows are still missing.
 *
 * HOW IT WORKS
 * ────────────
 *   Once a day (and once immediately on startup):
 *     services/weeklyScheduleMaterializer.service.js::runMaterializerOnce()
 *     does the actual work — see that file for the full algorithm.
 *     This file is only the scheduling wrapper, mirroring every other
 *     job in this directory.
 *
 * DESIGN DECISIONS
 * ────────────────
 *   - Uses setInterval (not node-cron) — matches every existing job
 *     in this directory (holdExpiry, autoComplete, autoStart,
 *     reminder, serviceOverdue, slaScanner, ratingOutbox). node-cron
 *     is a listed dependency but is not actually used anywhere in
 *     this codebase.
 *   - isRunning flag prevents overlapping executions if a run takes
 *     longer than the interval.
 *   - Runs once immediately on startup, then every 24h — a daily
 *     cadence is sufficient since the window only needs one new date
 *     topped up per calendar day; the job never assumes the previous
 *     run succeeded (runMaterializerOnce() always recomputes the
 *     current window fresh from "today").
 *   - No Socket.IO dependency — this job has no realtime/customer-
 *     facing side effect, unlike holdExpiry/serviceOverdue/etc.
 *   - No new persistent "materialization history" collection — every
 *     outcome is a structured log line via utils/logger.js (matching
 *     jobs/ratingOutbox.job.js's own logger usage, the most recent/
 *     rigorous existing job).
 *
 * INTEGRATION
 * ───────────
 *   In server.js, alongside the other background jobs:
 *     import { startWeeklyScheduleMaterializerJob } from "./jobs/weeklyScheduleMaterializer.job.js";
 *     const weeklyScheduleMaterializerJob = startWeeklyScheduleMaterializerJob();
 *   In shutdown():
 *     weeklyScheduleMaterializerJob.stop();
 * ============================================================
 */

import { runMaterializerOnce } from "../services/weeklyScheduleMaterializer.service.js";
import logger from "../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "./jobHeartbeat.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const JOB_NAME     = "[WeeklyScheduleMaterializerJob]";

//////////////////////////////////////////////////////////////
// 🧠 INTERNAL STATE
//////////////////////////////////////////////////////////////

let isRunning = false; // prevents overlapping executions (single process)

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER
//////////////////////////////////////////////////////////////

const runJob = async () => {
  if (isRunning) {
    logger.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;
  try {
    recordStart(JOB_NAME, { intervalMs: INTERVAL_MS });
    await runMaterializerOnce();
    recordSuccess(JOB_NAME);
  } catch (err) {
    // Top-level failure (e.g. DB connection lost) — never silently
    // swallowed, but also never crashes the process; the next
    // scheduled tick (or the next server restart's immediate run)
    // will simply recompute the window fresh and catch up.
    logger.error(`${JOB_NAME} Run failed`, { message: err.message });
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORTED STARTER
//////////////////////////////////////////////////////////////

/**
 * Start the weekly schedule materializer background job.
 *
 * @returns {{ stop: () => void }}
 */
export const startWeeklyScheduleMaterializerJob = () => {
  // Run once immediately on startup — catches up any dates that
  // should already be materialized (e.g. after a deploy/restart).
  runJob();

  const intervalHandle = setInterval(runJob, INTERVAL_MS);

  logger.info(`${JOB_NAME} Started`, { intervalMs: INTERVAL_MS });

  return {
    /**
     * Stop the job cleanly. Call during graceful shutdown before
     * closing the MongoDB connection.
     */
    stop: () => {
      clearInterval(intervalHandle);
      logger.info(`${JOB_NAME} Stopped`);
    },
  };
};
