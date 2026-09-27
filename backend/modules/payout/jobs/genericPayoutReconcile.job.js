/**
 * BARBER ENGINE V1
 * backend/modules/payout/jobs/genericPayoutReconcile.job.js
 *
 * STEP 6.4 — resolves in-flight RAZORPAY_ROUTE GenericPayoutRequest
 * payouts (SALON/ACQUISITION_AGENT/TERRITORY_PARTNER) whose webhook
 * never arrived (or whose create call timed out) by polling Razorpay
 * by reference_id. Idempotent and safe on multiple instances: every
 * outcome funnels through applyTransferOutcome()'s status guard and
 * the wallet ledger's idempotency keys, so two instances resolving the
 * same payout result in exactly one wallet movement. Mirrors
 * modules/fieldAgent/jobs/cashfreePayoutReconcile.job.js exactly.
 */

import { reconcileRazorpayRoutePayouts } from "../services/genericPayoutDispatch.service.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";

const INTERVAL_MS = 2 * 60 * 1000;
const JOB_NAME = "[GenericPayoutReconcileJob]";

let isRunning = false;
let intervalHandle = null;

const tick = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    recordStart("genericPayoutReconcile", { intervalMs: INTERVAL_MS });
    const res = await reconcileRazorpayRoutePayouts();
    if (res.checked > 0) logger.info(`${JOB_NAME} tick`, res);
    recordSuccess("genericPayoutReconcile");
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure("genericPayoutReconcile", err);
  } finally {
    isRunning = false;
  }
};

export const startGenericPayoutReconcileJob = () => {
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
