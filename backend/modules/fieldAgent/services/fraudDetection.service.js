/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fraudDetection.service.js
 *
 * FA-7.2 — the first detection engine on top of FA-7.1's FraudSignal
 * foundation. READS AcquisitionReferral/AcquisitionClaim (frozen
 * FA-5.3) READ-ONLY; writes exclusively via the existing, frozen
 * fraudSignal.service.js#recordSignal — never duplicates that
 * idempotency logic. Produces advisory evidence only: no suspension,
 * no status mutation, no rejection of any referral/claim, no write of
 * any kind to AcquisitionReferral, AcquisitionClaim, FieldAgent,
 * Salon, or User.
 *
 * Detection logic is stateless — no persistent watermark, no change
 * streams. Both functions can be called repeatedly (by a scheduled
 * job, by a manual re-run, or concurrently by two overlapping ticks)
 * and always converge on the same set of persisted signals, because
 * every write goes through recordSignal()'s dedupeKey-based
 * idempotency — never a duplicate.
 *
 * ── REFERRAL_VELOCITY ──────────────────────────────────────────────
 * Detects unusually high AcquisitionReferral creation volume by one
 * Field Agent inside a single CLOSED hour bucket [bucketStart,
 * bucketEnd). The current/open hour is never processed — the caller
 * (fraudDetection.job.js) is responsible for only ever passing a
 * bucket that has already fully elapsed. `sourceEventRef` is the most
 * recently created referral inside the bucket for that agent — a real,
 * concrete document, since the signal itself is an aggregate over many
 * referrals and FraudSignal.sourceEventRef must reference one.
 *
 * Severity is a TECHNICAL escalation curve relative to whatever
 * threshold is configured (see fraudDetection.constants.js) — not a
 * separate invented business number: exactly-at-threshold is LOW,
 * up to 2x threshold is MEDIUM, beyond that is HIGH. This scales
 * correctly once the real threshold is approved, without needing its
 * own separate sign-off.
 *
 * ── WITHDRAW_RECLAIM_CYCLE ─────────────────────────────────────────
 * A COUNT-based pattern (not time-bucketed) over a Salon's full
 * AcquisitionClaim history: repeated ACTIVE->ENDED churn on the SAME
 * salon, regardless of which Field Agent(s) were involved (a cycling
 * pattern may involve the same agent repeatedly or different agents
 * churning through it — see FraudSignal's own SUBJECT_TYPE.SALON
 * design rationale in fraudSignal.constants.js). The trigger is
 * always an actual ENDED claim, never a newly-created ACTIVE one.
 *
 * Discovery is bounded via two of the collection's already-existing
 * indexes (no new index required for this detector): `distinct()`
 * filtered to `status:"ENDED"` is served by the existing
 * `{status:1,createdAt:-1}` index (a bounded scan over the ended
 * subset, not the whole 5M-scale collection); each candidate salon's
 * full ordered history is then fetched via the existing
 * `{salonRef:1,createdAt:-1}` index — the exact query shape that index
 * already exists to serve.
 *
 * No persistent watermark: every tick re-evaluates the full current
 * ended-claims picture. This is a deliberate, disclosed trade-off
 * (per the approved plan's own "No persistent watermark is required
 * in V1" instruction) — re-attempting recordSignal() for an
 * already-signaled milestone claim is a safe, cheap, idempotent
 * no-op; the cost is a handful of avoided-duplicate-insert attempts
 * per tick, never a correctness risk, and the ended-claims working
 * set is bounded by acquisition churn, not by salon count.
 */

import AcquisitionReferral from "../models/AcquisitionReferral.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import { recordSignal } from "./fraudSignal.service.js";
import { SIGNAL_TYPE, SUBJECT_TYPE, SIGNAL_SEVERITY } from "../constants/fraudSignal.constants.js";
import { CLAIM_STATUS } from "../constants/acquisitionClaim.constants.js";

const mapVelocitySeverity = (observedCount, threshold) => {
  if (observedCount >= threshold * 2) return SIGNAL_SEVERITY.HIGH;
  if (observedCount > threshold) return SIGNAL_SEVERITY.MEDIUM;
  return SIGNAL_SEVERITY.LOW;
};

const mapCycleSeverity = (cycleCount, threshold) => {
  if (cycleCount >= threshold + 2) return SIGNAL_SEVERITY.HIGH;
  if (cycleCount > threshold) return SIGNAL_SEVERITY.MEDIUM;
  return SIGNAL_SEVERITY.LOW;
};

// ─── A. REFERRAL_VELOCITY ───────────────────────────────────────────
export const detectReferralVelocity = async ({ bucketStart, bucketEnd, threshold }) => {
  // $match on createdAt alone is served by the {createdAt:1} index
  // created via scripts/migrations/01_createFraudDetectionIndexes.js
  // (additive, does not modify AcquisitionReferral.js). $group by
  // fieldAgentRef is an in-memory hash stage bounded to one closed
  // hour's referral volume, not the full collection.
  const groups = await AcquisitionReferral.aggregate([
    { $match: { createdAt: { $gte: bucketStart, $lt: bucketEnd } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: "$fieldAgentRef", count: { $sum: 1 }, lastReferralId: { $last: "$_id" } } },
  ]);

  const results = [];
  for (const group of groups) {
    if (group.count < threshold) continue; // below threshold — no signal

    const fieldAgentRef = group._id;
    const dedupeKey = `${SIGNAL_TYPE.REFERRAL_VELOCITY}:${fieldAgentRef}:${bucketStart.toISOString()}`;

    const result = await recordSignal({
      signalType: SIGNAL_TYPE.REFERRAL_VELOCITY,
      subjectType: SUBJECT_TYPE.FIELD_AGENT,
      subjectRef: fieldAgentRef,
      fieldAgentRef,
      severity: mapVelocitySeverity(group.count, threshold),
      evidence: {
        bucketStart: bucketStart.toISOString(),
        bucketEnd: bucketEnd.toISOString(),
        observedCount: group.count,
        thresholdUsed: threshold,
      },
      sourceEventRef: group.lastReferralId,
      dedupeKey,
    });
    results.push(result);
  }
  return results;
};

// ─── B. WITHDRAW_RECLAIM_CYCLE ──────────────────────────────────────
export const detectWithdrawReclaimCycle = async ({ threshold }) => {
  // Bounded discovery — served by the existing {status:1,createdAt:-1}
  // index (filters to the ENDED subset, not the whole collection).
  const candidateSalonRefs = await AcquisitionClaim.distinct("salonRef", { status: CLAIM_STATUS.ENDED });

  const results = [];
  for (const salonRef of candidateSalonRefs) {
    // Full per-salon history, newest first — served by the existing
    // {salonRef:1,createdAt:-1} index, exactly the shape it exists for.
    const history = await AcquisitionClaim.find({ salonRef })
      .sort({ createdAt: -1 })
      .select("_id status createdAt fieldAgentRef")
      .lean();

    const endedAscending = history.filter((c) => c.status === CLAIM_STATUS.ENDED).reverse();
    if (endedAscending.length < threshold) continue; // below cycle threshold — no signal

    // The Nth qualifying ENDED claim onward — each is its own
    // independent trigger (escalating churn produces escalating
    // signals, not one signal that silently absorbs further cycles).
    const qualifying = endedAscending.slice(threshold - 1);
    for (let i = 0; i < qualifying.length; i++) {
      const claim = qualifying[i];
      const cycleCount = threshold + i;
      const dedupeKey = `${SIGNAL_TYPE.WITHDRAW_RECLAIM_CYCLE}:${salonRef}:${claim._id}`;

      const result = await recordSignal({
        signalType: SIGNAL_TYPE.WITHDRAW_RECLAIM_CYCLE,
        subjectType: SUBJECT_TYPE.SALON,
        subjectRef: salonRef,
        fieldAgentRef: claim.fieldAgentRef,
        severity: mapCycleSeverity(cycleCount, threshold),
        evidence: {
          salonRef: String(salonRef),
          triggeringClaimRef: String(claim._id),
          cycleCount,
          thresholdUsed: threshold,
        },
        sourceEventRef: claim._id,
        dedupeKey,
      });
      results.push(result);
    }
  }
  return results;
};

// ─── ORCHESTRATION — one closed hourly bucket, both detectors ───────
export const runDetectionForClosedBucket = async ({
  bucketStart,
  bucketEnd,
  referralVelocityThreshold,
  withdrawReclaimThreshold,
}) => {
  const referralVelocitySignals = await detectReferralVelocity({
    bucketStart,
    bucketEnd,
    threshold: referralVelocityThreshold,
  });
  const withdrawReclaimSignals = await detectWithdrawReclaimCycle({ threshold: withdrawReclaimThreshold });

  return { referralVelocitySignals, withdrawReclaimSignals };
};
