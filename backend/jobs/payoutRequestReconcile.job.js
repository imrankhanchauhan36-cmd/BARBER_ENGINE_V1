/**
 * BARBER ENGINE V1
 * backend/jobs/payoutRequestReconcile.job.js
 *
 * FINANCE-P0-1 — resolves in-flight RAZORPAY_ROUTE PayoutRequest
 * (canonical SALON) payouts whose webhook never arrived (or whose
 * create call timed out) by polling Razorpay by reference_id.
 * Idempotent and safe on multiple instances — see
 * services/settlement/payoutRequestDispatch.service.js's own header.
 * Mirrors modules/payout/jobs/genericPayoutReconcile.job.js exactly,
 * which that file itself documents mirroring
 * modules/fieldAgent/jobs/cashfreePayoutReconcile.job.js — the same,
 * already-proven precedent, not a new pattern.
 */

import { reconcilePayoutRequests } from "../services/settlement/payoutRequestDispatch.service.js";
import logger from "../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "./jobHeartbeat.js";

const INTERVAL_MS = 2 * 60 * 1000;
const JOB_NAME = "[PayoutRequestReconcileJob]";

let isRunning = false;
let intervalHandle = null;

const tick = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    recordStart("payoutRequestReconcile", { intervalMs: INTERVAL_MS });
    const res = await reconcilePayoutRequests();
    if (res.checked > 0) logger.info(`${JOB_NAME} tick`, res);
    recordSuccess("payoutRequestReconcile");
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure("payoutRequestReconcile", err);
  } finally {
    isRunning = false;
  }
};

export const startPayoutRequestReconcileJob = () => {
  tick();
  intervalHandle = setInterval(tick, INTERVAL_MS);
  logger.info(`${JOB_NAME} Started`, { intervalMs: INTERVAL_MS });
  return {
    stop: () => {
      if (intervalHandle) clearInterval(intervalHandle);
      logger.info(`${JOB_NAME} Stopped`);
    },
  };
};
