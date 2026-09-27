/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/jobs/cashfreePayoutReconcile.job.js
 *
 * FA-P4-D Step 1 — resolves in-flight Cashfree Field Agent payouts whose
 * webhook never arrived (or whose create call timed out) by polling
 * Cashfree by transfer_id. Idempotent and safe on multiple instances:
 * every outcome funnels through applyTransferOutcome()'s status guard and
 * the wallet ledger's idempotency keys, so two instances resolving the
 * same payout result in exactly one wallet movement.
 */

import { reconcileCashfreePayouts } from "../services/fieldAgentAutoPayout.service.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";

const INTERVAL_MS = 2 * 60 * 1000;
const JOB_NAME = "[CashfreePayoutReconcileJob]";

let isRunning = false;
let intervalHandle = null;

const tick = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    recordStart("cashfreePayoutReconcile", { intervalMs: INTERVAL_MS });
    const res = await reconcileCashfreePayouts();
    if (res.checked > 0) logger.info(`${JOB_NAME} tick`, res);
    recordSuccess("cashfreePayoutReconcile");
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure("cashfreePayoutReconcile", err);
  } finally {
    isRunning = false;
  }
};

export const startCashfreePayoutReconcileJob = () => {
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
