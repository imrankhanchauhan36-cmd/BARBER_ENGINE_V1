/**
 * BARBER ENGINE V1
 * backend/modules/otp/jobs/otpAuditOutbox.job.js
 *
 * OTP-1 REVISION 1 — background consumer that drains
 * modules/otp/models/OtpAuditOutbox.js into
 * modules/otp/models/OtpAuditLog.js asynchronously. The request path
 * (otp.service.js) only ever writes the outbox, fire-and-forget, and
 * never touches OtpAuditLog or this job directly.
 *
 * ARCHITECTURE — mirrors jobs/ratingOutbox.job.js's own established
 * shape (same claim/apply/reclaim idiom, same MongoDB-only safety
 * properties, no external queue):
 *
 *   1. CLAIM is one atomic findOneAndUpdate per row
 *      (PENDING -> PROCESSING), so two instances polling at the same
 *      instant can never double-claim the same outbox row.
 *   2. APPLY copies the row into OtpAuditLog. On success, the outbox
 *      row is deleted — its job is done, nothing more to retry.
 *      On failure, outboxState reverts to PENDING (or FAILED once
 *      OTP_OUTBOX_MAX_ATTEMPTS_BEFORE_FAILED is exceeded), attempts++,
 *      lastError recorded — the row is NEVER deleted on failure, so
 *      audit loss from a transient Mongo hiccup is always retryable.
 *   3. STALE CLAIMS (a worker crashed mid-drain, stuck at PROCESSING)
 *      are reclaimed after OTP_OUTBOX_STALE_CLAIM_MS, same
 *      "claimedAt expiry" idiom as RatingEvent's own stale-claim
 *      handling.
 *   4. FAILED rows (exhausted attempts) are kept, not deleted — always
 *      inspectable, never silently lost.
 *
 * INTEGRATION — OTP-2 Part D: registered explicitly in server.js
 * (`import { startOtpAuditOutboxJob } from "./modules/otp/jobs/otpAuditOutbox.job.js";`
 * / `const otpAuditOutboxJob = startOtpAuditOutboxJob();`), the exact
 * same convention every sibling background job already uses there.
 * This file does NOT self-start (an earlier OTP-1 revision phase had
 * it self-start as a workaround while server.js was outside that
 * phase's permitted scope — now that server.js registration is
 * explicitly authorized, the workaround is removed in favor of the
 * real convention).
 */

import OtpAuditOutbox from "../models/OtpAuditOutbox.js";
import OtpAuditLog from "../models/OtpAuditLog.js";
import logger from "../../../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "../../../jobs/jobHeartbeat.js";
import {
  OTP_OUTBOX_STATE,
  OTP_OUTBOX_POLL_INTERVAL_MS,
  OTP_OUTBOX_BATCH_SIZE,
  OTP_OUTBOX_STALE_CLAIM_MS,
  OTP_OUTBOX_MAX_ATTEMPTS_BEFORE_FAILED,
} from "../constants/otp.constants.js";

const JOB_NAME = "[OtpAuditOutboxJob]";

let isRunning = false;
let intervalHandle = null;

const AUDIT_FIELDS = ["phone", "role", "purpose", "provider", "status", "ip", "userAgent", "deviceId", "latencyMs", "failureReason"];

const reclaimStaleClaims = async () => {
  const staleBefore = new Date(Date.now() - OTP_OUTBOX_STALE_CLAIM_MS);
  const result = await OtpAuditOutbox.updateMany(
    { outboxState: OTP_OUTBOX_STATE.PROCESSING, claimedAt: { $lt: staleBefore } },
    { $set: { outboxState: OTP_OUTBOX_STATE.PENDING, claimedAt: null } }
  );
  if (result.modifiedCount > 0) {
    logger.warn(`${JOB_NAME} reclaimed ${result.modifiedCount} stale PROCESSING row(s)`);
  }
};

const claimBatch = async () => {
  const claimed = [];
  // One atomic claim per row (matches ratingOutbox.job.js's own
  // per-row claim loop) — simplest correct way to guarantee no two
  // concurrent workers ever process the same row, without a
  // multi-document transaction.
  for (let i = 0; i < OTP_OUTBOX_BATCH_SIZE; i++) {
    const row = await OtpAuditOutbox.findOneAndUpdate(
      { outboxState: OTP_OUTBOX_STATE.PENDING },
      { $set: { outboxState: OTP_OUTBOX_STATE.PROCESSING, claimedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!row) break; // nothing left pending
    claimed.push(row);
  }
  return claimed;
};

const applyRow = async (row) => {
  try {
    const doc = {};
    for (const field of AUDIT_FIELDS) doc[field] = row[field];
    await OtpAuditLog.create(doc);
    await OtpAuditOutbox.deleteOne({ _id: row._id });
    return true;
  } catch (err) {
    const attempts = row.attempts + 1;
    const parkAsFailed = attempts >= OTP_OUTBOX_MAX_ATTEMPTS_BEFORE_FAILED;
    await OtpAuditOutbox.updateOne(
      { _id: row._id },
      {
        $set: {
          outboxState: parkAsFailed ? OTP_OUTBOX_STATE.FAILED : OTP_OUTBOX_STATE.PENDING,
          claimedAt: null,
          attempts,
          lastError: String(err.message || err).slice(0, 500),
        },
      }
    );
    logger.error(`${JOB_NAME} failed to persist outbox row ${row._id}`, { attempts, parkAsFailed, message: err.message });
    return false;
  }
};

const tick = async () => {
  if (isRunning) return; // never overlap ticks
  isRunning = true;
  recordStart(JOB_NAME, { intervalMs: OTP_OUTBOX_POLL_INTERVAL_MS });
  try {
    await reclaimStaleClaims();
    const batch = await claimBatch();
    if (batch.length === 0) {
      recordSuccess(JOB_NAME);
      return;
    }
    let succeeded = 0;
    for (const row of batch) {
      if (await applyRow(row)) succeeded++;
    }
    recordSuccess(JOB_NAME);
  } catch (err) {
    logger.error(`${JOB_NAME} tick crashed`, { message: err.message, stack: err.stack });
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
};

export const startOtpAuditOutboxJob = () => {
  if (intervalHandle) {
    return { stop: () => stopOtpAuditOutboxJob() }; // already running — idempotent
  }
  intervalHandle = setInterval(tick, OTP_OUTBOX_POLL_INTERVAL_MS);
  intervalHandle.unref?.(); // never keeps the process alive on its own
  logger.info(`${JOB_NAME} Started — interval: ${OTP_OUTBOX_POLL_INTERVAL_MS / 1000}s | batch: ${OTP_OUTBOX_BATCH_SIZE}`);
  // Run once immediately, matching every sibling job's own
  // "don't wait a full interval before the first drain" convention.
  tick();
  return { stop: () => stopOtpAuditOutboxJob() };
};

export const stopOtpAuditOutboxJob = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
