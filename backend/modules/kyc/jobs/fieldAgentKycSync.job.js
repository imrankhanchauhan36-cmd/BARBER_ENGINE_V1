/**
 * ============================================================
 * 🪪 FIELD AGENT KYC SYNC — CONSUMER + RECONCILIATION JOB
 * ============================================================
 * FA-3.2 Consistency Layer — approved final revision (event-occurrence identity).
 *
 * Applies FieldAgentKycSyncEvent rows (written transactionally-adjacent
 * to the frozen getOrCreateKYC/approveKYC/rejectKYC calls — see
 * modules/kyc/services/fieldAgentKyc.service.js) onto the FA-2
 * FieldAgentApplication lifecycle. Never runs inside those frozen
 * KYC-side transactions (they cannot be modified to share a session).
 *
 * Two independent ticks, one job:
 *   - CONSUMER   (every 15s): claims + applies/waits/supersedes events.
 *   - RECONCILIATION (every 3 min): scans a bounded recent window of
 *     durable VerificationLog evidence for FIELD_AGENT KYCs and
 *     recreates any sync event the fast path failed to durably record
 *     (crash, or exhausted its own 3 synchronous retries).
 *
 * Every safety property lives in MongoDB, not in this process's memory:
 *   1. CLAIM is one atomic findOneAndUpdate (PENDING -> PROCESSING).
 *   2. IDENTITY is enforced by two indexes on FieldAgentKycSyncEvent —
 *      {kycRef,transitionType} partial-unique for FIRST_TOUCH (a KYC
 *      record is created exactly once, ever) and {sourceLogId}
 *      sparse-unique for APPROVAL/REJECTION (each decision occurrence
 *      — an immutable VerificationLog row — gets its own permanent
 *      identity, so repeated legitimate decisions on the same KYC
 *      record never collide).
 *   3. SUPERSEDE — an approval/rejection event is re-verified against
 *      the AUTHORITATIVE KYC.status (Check A) AND against whether it
 *      is still the LATEST decision of its kind (Check B, via a fresh
 *      VerificationLog lookup) before ever being applied. Either check
 *      failing marks the event SUPERSEDED, never FAILED, never forced.
 *   4. ORDERING — an approval/rejection event claimed while the
 *      application is still SUBMITTED (FIRST_TOUCH not yet applied) is
 *      not an error: it is released back to PENDING and retried,
 *      bounded by wall-clock time (firstWaitingAt), independent of the
 *      standard attempts-based failure budget.
 *   5. STALE CLAIMS (a worker crashed mid-processing) are reclaimed
 *      after STALE_CLAIM_MS, same "lockUntil"-expiry idiom as
 *      jobs/ratingOutbox.job.js.
 *   6. Every real application mutation goes through FA-2's own,
 *      frozen, unmodified assertValidTransition/setApplicationStatus —
 *      never a direct MongoDB write to FieldAgentApplication.status.
 *
 * INTEGRATION — in server.js, alongside the other background jobs:
 *   import { startFieldAgentKycSyncJob } from "./modules/kyc/jobs/fieldAgentKycSync.job.js";
 *   const fieldAgentKycSyncJob = startFieldAgentKycSyncJob();
 *   ...
 *   fieldAgentKycSyncJob.stop(); // in shutdown()
 * ============================================================
 */

import crypto from "crypto";
import { APPLICATION_STATUS } from "../../fieldAgent/constants/fieldAgent.constants.js";
import FieldAgentApplication from "../../fieldAgent/models/FieldAgentApplication.js";
import { assertValidTransition, setApplicationStatus } from "../../fieldAgent/services/fieldAgentApplication.service.js";
import KYC from "../models/KYC.js";
import FieldAgentKycSyncEvent, {
    FIELD_AGENT_KYC_SYNC_SOURCE,
    FIELD_AGENT_KYC_SYNC_STATUS,
    FIELD_AGENT_KYC_SYNC_TRANSITION,
} from "../models/FieldAgentKycSyncEvent.js";
import VerificationLog from "../models/VerificationLog.js";
import { recordFailure, recordStart, recordSuccess } from "../../../jobs/jobHeartbeat.js";
import logger from "../../../utils/logger.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const CONSUMER_INTERVAL_MS = 15 * 1000;          // consumer poll cadence
const RECONCILIATION_INTERVAL_MS = 3 * 60 * 1000; // reconciliation cadence — a safety net, not the primary path
const RECONCILIATION_WINDOW_MS = 30 * 60 * 1000;  // bounded recent window — never a full-collection scan
const STALE_CLAIM_MS = 2 * 60 * 1000;             // abandoned-worker assumption
const MAX_ATTEMPTS_BEFORE_FAILED = 5;             // genuine apply-error budget
const PREREQUISITE_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // wall-clock bound for "waiting on FIRST_TOUCH", independent of `attempts`
const BATCH_SIZE = 25;

const JOB_NAME = "[FieldAgentKycSyncJob]";
const RECONCILIATION_JOB_NAME = "[FieldAgentKycReconciliationJob]";
const WORKER_ID = `${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

const LOG_ACTION_BY_TRANSITION = {
  [FIELD_AGENT_KYC_SYNC_TRANSITION.APPROVAL_TO_TRAINING_PENDING]: "ADMIN_APPROVED",
  [FIELD_AGENT_KYC_SYNC_TRANSITION.REJECTION_TO_KYC_REJECTED]:    "ADMIN_REJECTED",
};

const EXPECTED_KYC_STATUS_BY_TRANSITION = {
  [FIELD_AGENT_KYC_SYNC_TRANSITION.APPROVAL_TO_TRAINING_PENDING]: "VERIFIED",
  [FIELD_AGENT_KYC_SYNC_TRANSITION.REJECTION_TO_KYC_REJECTED]:    "REJECTED",
};

let consumerRunning = false;
let reconciliationRunning = false;
let consumerIntervalHandle = null;
let reconciliationIntervalHandle = null;

//////////////////////////////////////////////////////////////
// 🔐 CLAIM ONE EVENT — atomic, multi-instance-safe
//////////////////////////////////////////////////////////////

async function claimOneEvent() {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

  return FieldAgentKycSyncEvent.findOneAndUpdate(
    {
      $or: [
        { status: FIELD_AGENT_KYC_SYNC_STATUS.PENDING },
        { status: FIELD_AGENT_KYC_SYNC_STATUS.PROCESSING, claimedAt: { $lt: staleThreshold } },
      ],
    },
    {
      $set: { status: FIELD_AGENT_KYC_SYNC_STATUS.PROCESSING, claimedAt: now, claimedBy: WORKER_ID },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true }
  );
}

//////////////////////////////////////////////////////////////
// 🔧 APPLY — FIRST_TOUCH (never superseded; see model file header)
//////////////////////////////////////////////////////////////

async function applyFirstTouch(event) {
  const application = await FieldAgentApplication.findOne({ userRef: event.userRef }).sort({ createdAt: -1 });
  if (!application) throw new Error(`No FieldAgentApplication for user ${event.userRef}`);

  // Anything other than SUBMITTED means this event's purpose (get the
  // application off SUBMITTED) is already satisfied — including
  // WITHDRAWN, which is a legitimate way to leave SUBMITTED without
  // ever reaching KYC_PENDING. Transition-specific rule, not a
  // numeric rank comparison.
  if (application.status !== APPLICATION_STATUS.SUBMITTED) {
    return { outcome: "PROCESSED", alreadyConsistent: true };
  }

  assertValidTransition(application.status, event.toStatus);
  setApplicationStatus(application, event.toStatus);
  await application.save();
  return { outcome: "PROCESSED", transitioned: true };
}

//////////////////////////////////////////////////////////////
// 🔧 APPLY — APPROVAL / REJECTION (Check A + Check B, then the
// application-status table)
//////////////////////////////////////////////////////////////

async function applyDecision(event) {
  const kyc = await KYC.findById(event.kycRef).select("status").lean();
  if (!kyc) throw new Error(`KYC ${event.kycRef} not found for event ${event._id}`);

  const expectedKycStatus = EXPECTED_KYC_STATUS_BY_TRANSITION[event.transitionType];
  const logAction = LOG_ACTION_BY_TRANSITION[event.transitionType];

  // CHECK A — has a later, legitimate change (e.g. a resubmission)
  // already moved the KYC's authoritative status away from what this
  // decision represents?
  if (kyc.status !== expectedKycStatus) {
    return {
      outcome: "SUPERSEDED",
      reason: `KYC status is now ${kyc.status} (expected ${expectedKycStatus}) — this decision is no longer applicable`,
    };
  }

  // CHECK B — is this still the LATEST decision of its kind for this
  // KYC record? (Catches: same KYC status value reached by TWO
  // separate decisions, e.g. two rejections separated by a
  // resubmission — Check A alone cannot distinguish them.)
  const latestLog = await VerificationLog.findOne({ kycId: event.kycRef, action: logAction })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();

  if (!latestLog || String(latestLog._id) !== String(event.sourceLogId)) {
    return {
      outcome: "SUPERSEDED",
      reason: `A newer ${logAction} decision exists for this KYC — this is a stale historical decision`,
    };
  }

  // Both checks passed — this decision is still the operative one.
  const application = await FieldAgentApplication.findOne({ userRef: event.userRef }).sort({ createdAt: -1 });
  if (!application) throw new Error(`No FieldAgentApplication for user ${event.userRef}`);

  if (application.status === event.expectedFromStatus) {
    assertValidTransition(application.status, event.toStatus);
    setApplicationStatus(application, event.toStatus);
    await application.save();
    return { outcome: "PROCESSED", transitioned: true };
  }

  if (application.status === event.toStatus) {
    return { outcome: "PROCESSED", alreadyConsistent: true };
  }

  if (application.status === APPLICATION_STATUS.SUBMITTED) {
    // Prerequisite FIRST_TOUCH hasn't applied yet — not an error.
    return { outcome: "WAITING" };
  }

  // Genuinely unexpected combination — never forced, never bypasses
  // assertValidTransition. Routed to the standard bounded-attempts
  // failure path below.
  throw new Error(
    `Unexpected application status ${application.status} for ${event.transitionType} (kyc ${event.kycRef})`
  );
}

async function applyEvent(event) {
  if (event.transitionType === FIELD_AGENT_KYC_SYNC_TRANSITION.FIRST_TOUCH_TO_KYC_PENDING) {
    return applyFirstTouch(event);
  }
  return applyDecision(event);
}

//////////////////////////////////////////////////////////////
// 🚀 PROCESS ONE CLAIMED EVENT
//////////////////////////////////////////////////////////////

async function processClaimedEvent(event) {
  try {
    const result = await applyEvent(event);

    if (result.outcome === "SUPERSEDED") {
      await FieldAgentKycSyncEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: FIELD_AGENT_KYC_SYNC_STATUS.SUPERSEDED,
            supersededAt: new Date(),
            lastError: result.reason,
            claimedAt: null,
            claimedBy: null,
          },
        }
      );
      return { result: "superseded" };
    }

    if (result.outcome === "WAITING") {
      const now = new Date();
      const firstWaitingAt = event.firstWaitingAt || now;

      if (now.getTime() - firstWaitingAt.getTime() > PREREQUISITE_WAIT_TIMEOUT_MS) {
        await FieldAgentKycSyncEvent.updateOne(
          { _id: event._id },
          {
            $set: {
              status: FIELD_AGENT_KYC_SYNC_STATUS.FAILED,
              lastError: "Prerequisite FIRST_TOUCH transition did not complete within timeout",
              claimedAt: null,
              claimedBy: null,
            },
          }
        );
        return { result: "failed-timeout" };
      }

      // Release back to PENDING — bounded by firstWaitingAt's own
      // wall-clock timeout above, deliberately NOT by `attempts`
      // (which is reserved for genuine apply errors, not healthy
      // waiting on a sibling event that may itself be recovering via
      // reconciliation).
      await FieldAgentKycSyncEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: FIELD_AGENT_KYC_SYNC_STATUS.PENDING,
            firstWaitingAt,
            claimedAt: null,
            claimedBy: null,
          },
        }
      );
      return { result: "waiting" };
    }

    // PROCESSED (transitioned, or already-consistent no-op)
    await FieldAgentKycSyncEvent.updateOne(
      { _id: event._id },
      { $set: { status: FIELD_AGENT_KYC_SYNC_STATUS.PROCESSED, processedAt: new Date() } }
    );
    return { result: "processed" };
  } catch (err) {
    const nextStatus =
      event.attempts >= MAX_ATTEMPTS_BEFORE_FAILED
        ? FIELD_AGENT_KYC_SYNC_STATUS.FAILED
        : FIELD_AGENT_KYC_SYNC_STATUS.PENDING;

    await FieldAgentKycSyncEvent.updateOne(
      { _id: event._id },
      { $set: { status: nextStatus, lastError: err.message, claimedAt: null, claimedBy: null } }
    ).catch((updateErr) => {
      logger.error(`${JOB_NAME} failed to record failure for event ${event._id}`, { message: updateErr.message });
    });

    logger.error(`${JOB_NAME} failed to apply event ${event._id}`, {
      message: err.message,
      transitionType: event.transitionType,
    });

    return { result: "error", error: err.message };
  }
}

//////////////////////////////////////////////////////////////
// 🚀 CONSUMER TICK
//////////////////////////////////////////////////////////////

async function runConsumerTick() {
  if (consumerRunning) return;
  consumerRunning = true;

  try {
    recordStart(JOB_NAME, { intervalMs: CONSUMER_INTERVAL_MS });

    let processed = 0, superseded = 0, waiting = 0, failed = 0;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const event = await claimOneEvent();
      if (!event) break;

      const { result } = await processClaimedEvent(event);
      if (result === "processed") processed++;
      else if (result === "superseded") superseded++;
      else if (result === "waiting") waiting++;
      else failed++;
    }

    if (processed + superseded + waiting + failed > 0) {
      logger.info(`${JOB_NAME} tick complete`, { processed, superseded, waiting, failed, worker: WORKER_ID });
    }
    recordSuccess(JOB_NAME);
  } catch (err) {
    logger.error(`${JOB_NAME} tick failed`, { message: err.message });
    recordFailure(JOB_NAME, err);
  } finally {
    consumerRunning = false;
  }
}

//////////////////////////////////////////////////////////////
// 🔎 RECONCILIATION TICK — per-decision-occurrence, bounded window
//////////////////////////////////////////////////////////////

async function runReconciliationTick() {
  const windowStart = new Date(Date.now() - RECONCILIATION_WINDOW_MS);

  // Small candidate set via the existing applicantType_1 index — Field
  // Agent population is a small fraction of the 5M-salon Owner
  // population this system targets.
  const fieldAgentKycs = await KYC.find({ applicantType: "FIELD_AGENT" }).select("_id ownerId").lean();
  if (fieldAgentKycs.length === 0) return { discovered: 0 };

  const idList = fieldAgentKycs.map((k) => k._id);
  const ownerByKycId = new Map(fieldAgentKycs.map((k) => [String(k._id), k.ownerId]));

  // Bounded recent window, existing {kycId,createdAt} index — never a
  // full-collection scan, never blind replay of old history.
  const logs = await VerificationLog.find({
    kycId: { $in: idList },
    action: { $in: ["KYC_INITIATED", "ADMIN_APPROVED", "ADMIN_REJECTED"] },
    createdAt: { $gte: windowStart },
  })
    .select("_id kycId action")
    .lean();

  let discovered = 0;

  for (const logRow of logs) {
    const ownerId = ownerByKycId.get(String(logRow.kycId));
    if (!ownerId) continue; // defensive — should never happen given the candidate query above

    if (logRow.action === "KYC_INITIATED") {
      const res = await FieldAgentKycSyncEvent.updateOne(
        { kycRef: logRow.kycId, transitionType: FIELD_AGENT_KYC_SYNC_TRANSITION.FIRST_TOUCH_TO_KYC_PENDING },
        {
          $setOnInsert: {
            userRef: ownerId,
            expectedFromStatus: APPLICATION_STATUS.SUBMITTED,
            toStatus: APPLICATION_STATUS.KYC_PENDING,
            source: FIELD_AGENT_KYC_SYNC_SOURCE.RECONCILIATION,
            sourceLogId: logRow._id,
          },
        },
        { upsert: true }
      );
      if (res.upsertedCount > 0) discovered++;
      continue;
    }

    // ADMIN_APPROVED / ADMIN_REJECTED — identity is sourceLogId alone
    // (this SPECIFIC decision occurrence), never {kycRef,transitionType}.
    const transitionType =
      logRow.action === "ADMIN_APPROVED"
        ? FIELD_AGENT_KYC_SYNC_TRANSITION.APPROVAL_TO_TRAINING_PENDING
        : FIELD_AGENT_KYC_SYNC_TRANSITION.REJECTION_TO_KYC_REJECTED;
    const toStatus = logRow.action === "ADMIN_APPROVED" ? APPLICATION_STATUS.TRAINING_PENDING : APPLICATION_STATUS.KYC_REJECTED;

    const res = await FieldAgentKycSyncEvent.updateOne(
      { sourceLogId: logRow._id },
      {
        $setOnInsert: {
          kycRef: logRow.kycId,
          userRef: ownerId,
          transitionType,
          expectedFromStatus: APPLICATION_STATUS.KYC_PENDING,
          toStatus,
          source: FIELD_AGENT_KYC_SYNC_SOURCE.RECONCILIATION,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount > 0) discovered++;
  }

  if (discovered > 0) {
    logger.info(`${RECONCILIATION_JOB_NAME} discovered and recreated ${discovered} missing sync event(s)`);
  }

  return { discovered };
}

async function runReconciliationTickWrapped() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;

  try {
    recordStart(RECONCILIATION_JOB_NAME, { intervalMs: RECONCILIATION_INTERVAL_MS });
    await runReconciliationTick();
    recordSuccess(RECONCILIATION_JOB_NAME);
  } catch (err) {
    logger.error(`${RECONCILIATION_JOB_NAME} tick failed`, { message: err.message });
    recordFailure(RECONCILIATION_JOB_NAME, err);
  } finally {
    reconciliationRunning = false;
  }
}

//////////////////////////////////////////////////////////////
// 🚀 EXPORTED STARTER
//////////////////////////////////////////////////////////////

export const startFieldAgentKycSyncJob = () => {
  runConsumerTick();
  runReconciliationTickWrapped();

  consumerIntervalHandle = setInterval(runConsumerTick, CONSUMER_INTERVAL_MS);
  reconciliationIntervalHandle = setInterval(runReconciliationTickWrapped, RECONCILIATION_INTERVAL_MS);

  logger.info(`${JOB_NAME} Started`, {
    consumerIntervalMs: CONSUMER_INTERVAL_MS,
    reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
    worker: WORKER_ID,
  });

  return {
    stop: () => {
      if (consumerIntervalHandle) clearInterval(consumerIntervalHandle);
      if (reconciliationIntervalHandle) clearInterval(reconciliationIntervalHandle);
      logger.info(`${JOB_NAME} Stopped`);
    },
  };
};

// Exported for the disposable-script verification methodology this
// project uses — never imported by any route/controller.
export const _internal = {
  claimOneEvent,
  applyEvent,
  processClaimedEvent,
  runConsumerTick,
  runReconciliationTick,
};
