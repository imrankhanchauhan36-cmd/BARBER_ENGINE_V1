/**
 * ============================================================
 * ⭐ RATING OUTBOX CONSUMER JOB
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Rating & Review Engine, Phase 2. Applies RatingEvent rows (written
 * transactionally alongside every ServiceRating — see
 * services/ratingSubmission.service.js) onto the derived
 * RatingAggregate documents. Never runs inside the submission
 * transaction itself (Phase 1 constitution rule 2 — a rating create
 * must never be directly coupled to an aggregate update).
 *
 * Phase 1 Decision 5 (approved): NO external queue (no BullMQ/SQS/
 * RabbitMQ) in this phase, but this is explicitly NOT a naive
 * process-local setInterval race. Every safety property lives in
 * MongoDB, not in this process's memory:
 *
 *   1. CLAIM is one atomic findOneAndUpdate (PENDING -> PROCESSING).
 *      Two backend instances polling at the same instant can never
 *      both claim the same event — MongoDB guarantees atomicity of a
 *      single findOneAndUpdate.
 *   2. APPLY is an idempotent conditional update: the filter requires
 *      `appliedEventIds` NOT already contain this event's _id. If a
 *      worker crashes after applying but before marking PROCESSED,
 *      the retry's apply step is a guaranteed no-op — the aggregate
 *      is never incremented twice for the same event.
 *   3. STALE CLAIMS (a worker crashed mid-processing, status stuck at
 *      PROCESSING) are reclaimed after STALE_CLAIM_MS, same
 *      "lockUntil"-expiry idiom as Booking.js's own HOLD expiry.
 *   4. FAILED events keep their row (never deleted) with lastError +
 *      attempts recorded — always recoverable, never silently lost.
 *
 * This state machine (PENDING -> PROCESSING -> PROCESSED/FAILED with
 * atomic claim) is deliberately the same shape a real queue
 * consumer would implement — migrating to an actual queue later
 * means swapping this poll loop for a subscriber while keeping the
 * identical claim/apply/idempotency logic untouched.
 *
 * INTEGRATION
 * ───────────
 *   In server.js, alongside the other background jobs:
 *     import { startRatingOutboxJob } from "./jobs/ratingOutbox.job.js";
 *     const ratingOutboxJob = startRatingOutboxJob();
 *   In shutdown(): ratingOutboxJob.stop();
 * ============================================================
 */

import crypto from "crypto";
import mongoose from "mongoose";

import RatingEvent, { RATING_EVENT_STATUS, RATING_EVENT_TYPE } from "../models/RatingEvent.js";
import RatingAggregate from "../models/RatingAggregate.js";
import { RATING_TYPE } from "../models/ServiceRating.js";
import Salon from "../models/Salon.js";
import logger from "../utils/logger.js";
import { recordStart, recordSuccess, recordFailure } from "./jobHeartbeat.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const INTERVAL_MS = 10 * 1000; // poll every 10 seconds
const BATCH_SIZE = 25; // events claimed per tick
const STALE_CLAIM_MS = 2 * 60 * 1000; // 2 minutes — matches an abandoned-worker assumption
const MAX_ATTEMPTS_BEFORE_FAILED = 5;
const MAX_APPLY_ATTEMPTS = 3; // R2: bounded retry for a transient transaction conflict within one apply
const JOB_NAME = "[RatingOutboxJob]";

const isDuplicateOrConflict = (err) =>
  err.code === 11000 ||
  (typeof err.hasErrorLabel === "function" && err.hasErrorLabel("TransientTransactionError"));

const WORKER_ID = `${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

let isRunning = false;
let intervalHandle = null;

//////////////////////////////////////////////////////////////
// 🔐 CLAIM ONE EVENT — atomic, multi-instance-safe
//////////////////////////////////////////////////////////////

async function claimOneEvent() {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

  return RatingEvent.findOneAndUpdate(
    {
      $or: [
        { status: RATING_EVENT_STATUS.PENDING },
        { status: RATING_EVENT_STATUS.PROCESSING, claimedAt: { $lt: staleThreshold } },
      ],
    },
    {
      $set: { status: RATING_EVENT_STATUS.PROCESSING, claimedAt: now, claimedBy: WORKER_ID },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true }
  );
}

//////////////////////////////////////////////////////////////
// 🔧 IDEMPOTENT APPLY — safe to retry unconditionally
//////////////////////////////////////////////////////////////

async function applyEventToAggregate(event) {
  const eventId = event._id;
  const key = { salonId: event.salonId, type: event.type, targetId: event.targetId };

  // R1 (Rating Consistency Fix): a RATING_HIDDEN event must REMOVE its
  // rating's contribution rather than add it — RATING_CREATED and
  // RATING_UNHIDDEN both add. `delta.stars`/`delta.count` themselves
  // always stay positive (see models/RatingEvent.js); the sign lives
  // here, and here alone. NOTE: RatingAggregate's count/total `min:0`
  // schema constraint is NOT actually enforced on these $inc updates
  // (Mongoose skips validators on updateOne/findOneAndUpdate unless
  // runValidators:true is passed, and it isn't here — confirmed
  // empirically during R1 testing). The real, load-bearing guarantee
  // against a negative aggregate is that controllers/
  // adminServiceRating.controller.js's transition gate can never emit
  // an unbalanced HIDDEN event in real usage — not this schema field.
  const sign = event.eventType === RATING_EVENT_TYPE.RATING_HIDDEN ? -1 : 1;

  // R2 (Salon.rating Reconciliation): for a SALON-type event, this
  // event's aggregate update and its write-through sync into
  // Salon.rating must succeed or fail TOGETHER. Two separate,
  // non-transactional updateOne calls (the pre-R2 shape) would leave
  // a crash-window where the aggregate update commits but the Salon
  // sync never runs — and because the aggregate side's own
  // appliedEventIds gate would then correctly no-op on any later
  // retry, that Salon sync would NEVER be re-attempted either,
  // producing permanent, silent drift (the exact failure class R1
  // exists to eliminate, just relocated). Wrapping every write for
  // this event in one Mongo transaction, with a bounded retry on a
  // transient write conflict (mirrors services/ratingSubmission.
  // service.js and controllers/adminServiceRating.controller.js's own
  // established pattern), closes that gap completely: either every
  // write for this event lands, or none of them do.
  for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // STEP 1 — ensure the aggregate document exists, touching nothing
      // else. $setOnInsert only takes effect when this upsert actually
      // creates a new document; run against an existing document it is a
      // true no-op (matches, changes nothing). Deliberately separated
      // from the conditional increment below: combining "upsert" with a
      // filter that excludes already-applied events (step 2) is exactly
      // what previously caused an E11000 — when the document already
      // existed AND already contained eventId, that combined filter
      // matched nothing, so upsert tried to INSERT a second document with
      // the same {salonId,type,targetId}, colliding with the unique
      // index. Splitting the two concerns removes that combination
      // entirely.
      await RatingAggregate.updateOne(
        key,
        {
          $setOnInsert: {
            ...key,
            count: 0,
            total: 0,
            distribution: new Map([["1", 0], ["2", 0], ["3", 0], ["4", 0], ["5", 0]]),
            appliedEventIds: [],
          },
        },
        { session, upsert: true }
      );

      // STEP 2 — apply the delta ONLY if this event hasn't already been
      // folded in. NO upsert here — the aggregate is guaranteed to exist
      // after step 1, so a non-match here means exactly one thing: this
      // eventId is already present in appliedEventIds. matchedCount 0 is
      // then a genuine, safe, silent no-op (CASE C) — never an error,
      // never a double-increment. This is what makes re-applying an
      // already-processed event (a crash-retry, or a defensive manual
      // re-run) idempotent instead of throwing.
      const result = await RatingAggregate.updateOne(
        { ...key, appliedEventIds: { $ne: eventId } },
        {
          $inc: {
            count: sign * event.delta.count,
            total: sign * event.delta.stars,
            [`distribution.${event.delta.stars}`]: sign,
          },
          $push: { appliedEventIds: eventId },
        },
        { session }
      );

      // STEP 3 (R2) — write-through sync into Salon.rating. Only for
      // SALON-type events (SERVICE/PROFESSIONAL ratings are a
      // different metric entirely and must never touch Salon.rating —
      // approved rule). Only when step 2 just genuinely applied this
      // event for the FIRST time (matchedCount > 0) — on a safe no-op
      // retry (matchedCount 0), skipping this too is what prevents a
      // double-sync, reusing the exact same idempotency gate step 2
      // already established rather than inventing a second ledger.
      if (event.type === RATING_TYPE.SALON && result.matchedCount > 0) {
        await Salon.updateOne(
          { _id: event.targetId },
          {
            $inc: {
              "rating.count": sign * event.delta.count,
              "rating.total": sign * event.delta.stars,
            },
          },
          { session }
        );
      }

      await session.commitTransaction();
      return result;
    } catch (err) {
      await session.abortTransaction();

      if (isDuplicateOrConflict(err) && attempt < MAX_APPLY_ATTEMPTS - 1) {
        logger.warn(`${JOB_NAME} retrying apply after transient conflict`, {
          eventId: eventId.toString(),
          attempt,
        });
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
}

//////////////////////////////////////////////////////////////
// 🚀 PROCESS ONE CLAIMED EVENT
//////////////////////////////////////////////////////////////

async function processClaimedEvent(event) {
  try {
    await applyEventToAggregate(event);

    await RatingEvent.updateOne(
      { _id: event._id },
      { $set: { status: RATING_EVENT_STATUS.PROCESSED, processedAt: new Date() } }
    );

    return { processed: true };
  } catch (err) {
    const nextStatus =
      event.attempts >= MAX_ATTEMPTS_BEFORE_FAILED
        ? RATING_EVENT_STATUS.FAILED
        : RATING_EVENT_STATUS.PENDING; // back to PENDING — eligible for another claim

    await RatingEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          status: nextStatus,
          lastError: err.message,
          claimedAt: null,
          claimedBy: null,
        },
      }
    ).catch((updateErr) => {
      // Even the failure-recording update failed (e.g. DB blip) —
      // the row still exists with its last known state and will be
      // reclaimed once its PROCESSING claim goes stale. Never lost.
      logger.error(`${JOB_NAME} failed to record failure for event ${event._id}`, {
        message: updateErr.message,
      });
    });

    logger.error(`${JOB_NAME} failed to apply event ${event._id}`, {
      message: err.message,
      type: event.type,
      targetId: event.targetId?.toString(),
    });

    return { processed: false, error: err.message };
  }
}

//////////////////////////////////////////////////////////////
// 🚀 MAIN TICK
//////////////////////////////////////////////////////////////

async function runOutboxTick() {
  if (isRunning) {
    return; // previous tick still in progress — skip, no log noise
  }
  isRunning = true;

  try {
    recordStart(JOB_NAME, { intervalMs: INTERVAL_MS });
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const event = await claimOneEvent();
      if (!event) break; // nothing left to claim this tick

      const result = await processClaimedEvent(event);
      if (result.processed) processedCount++;
      else failedCount++;
    }

    if (processedCount > 0 || failedCount > 0) {
      logger.info(`${JOB_NAME} tick complete`, { processedCount, failedCount, worker: WORKER_ID });
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
// 🚀 EXPORTED STARTER — mirrors jobs/holdExpiry.job.js's convention
//////////////////////////////////////////////////////////////

export const startRatingOutboxJob = () => {
  runOutboxTick();
  intervalHandle = setInterval(runOutboxTick, INTERVAL_MS);

  logger.info(`${JOB_NAME} Started`, { intervalMs: INTERVAL_MS, batchSize: BATCH_SIZE, worker: WORKER_ID });

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
export const _internal = { claimOneEvent, applyEventToAggregate, processClaimedEvent, runOutboxTick };
