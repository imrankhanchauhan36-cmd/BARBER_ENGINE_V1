/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/crossAgentOverlap.service.js
 *
 * FA-7.3 — the CROSS_AGENT_SALON_CYCLING detector. READS AcquisitionClaim
 * (frozen FA-5.3) READ-ONLY; writes exclusively via the existing, frozen
 * fraudSignal.service.js#recordSignal — never duplicates that idempotency
 * logic. Produces advisory evidence only: no suspension, no status
 * mutation, no rejection of any claim, no write of any kind to
 * AcquisitionClaim, FieldAgent, Salon, or User.
 *
 * PURPOSE (per the FA-7.3 audit's own Detector C finding): FA-7.2's
 * WITHDRAW_RECLAIM_CYCLE already flags repeated ACTIVE->ENDED churn on a
 * salon regardless of which agent(s) were involved. It does not record
 * whether that churn involved one agent repeatedly (not suspicious on
 * its own — an agent legitimately re-acquiring their own withdrawn
 * salon) or several different agents cycling through it (a materially
 * different, separately worth-recording pattern). This detector answers
 * exactly that narrower question — it does not replace or duplicate
 * WITHDRAW_RECLAIM_CYCLE, which remains unmodified and untouched.
 *
 * BUSINESS RULES (FA-7.3 lock, verbatim):
 *   - Only ENDED claims count. An ACTIVE claim is never a trigger.
 *   - endedReason ADMIN_REASSIGNED claims are EXCLUDED entirely — that
 *     claim-ending event does not contribute to the agent set or the
 *     qualifying count at all (deliberate administrative intervention,
 *     never agent-driven churn).
 *   - endedReason AGENT_WITHDRAWN and ADMIN_REJECTED are INCLUDED.
 *   - Distinct-agent threshold is locked at 2 (CROSS_AGENT_DISTINCT_AGENT_THRESHOLD
 *     below) — a genuine, approved business number, NOT a placeholder
 *     (unlike FA-7.2's REFERRAL_VELOCITY_THRESHOLD_PLACEHOLDER/
 *     WITHDRAW_RECLAIM_CYCLE_THRESHOLD_PLACEHOLDER).
 *   - No time window in V1 — the full persisted qualifying history for a
 *     salon is evaluated every run, exactly as instructed ("do not
 *     invent a 24h/7d/30d/90d window").
 *   - Simultaneous competing ACTIVE claims are never a trigger for this
 *     or any signal — FA-5.3's own partial-unique-ACTIVE index already
 *     makes that state structurally impossible.
 *
 * DETECTION SHAPE: walk each salon's qualifying (ENDED, non-
 * ADMIN_REASSIGNED) claims in chronological (createdAt ascending) order,
 * accumulating the set of distinct fieldAgentRef values seen so far. The
 * first qualifying claim at which that set's size reaches the threshold
 * becomes a trigger; EVERY qualifying claim from that point onward is
 * also its own independent trigger (escalating churn produces
 * escalating-but-non-duplicate signals) — this is the exact same
 * "Nth qualifying claim onward, each its own independent trigger"
 * design FA-7.2's own WITHDRAW_RECLAIM_CYCLE already uses and was
 * already approved for, applied here to a distinct-agent-count
 * threshold instead of a raw count threshold.
 *
 * Discovery is bounded via the same two of AcquisitionClaim's
 * already-existing indexes FA-7.2 already proved at scale (no new index
 * required): `distinct()` filtered to `status:"ENDED"` is served by the
 * existing `{status:1,createdAt:-1}` index; each candidate salon's full
 * ordered history is fetched via the existing `{salonRef:1,createdAt:-1}`
 * index.
 *
 * No persistent watermark: every run re-evaluates the full current
 * ended-claims picture, identical trade-off to WITHDRAW_RECLAIM_CYCLE —
 * re-attempting recordSignal() for an already-signaled claim is a safe,
 * cheap, idempotent no-op via FraudSignal.dedupeKey, never a correctness
 * risk.
 */

import AcquisitionClaim from "../models/AcquisitionClaim.js";
import { recordSignal } from "./fraudSignal.service.js";
import { SIGNAL_TYPE, SUBJECT_TYPE, SIGNAL_SEVERITY } from "../constants/fraudSignal.constants.js";
import { CLAIM_STATUS, CLAIM_END_REASON } from "../constants/acquisitionClaim.constants.js";

// LOCKED business decision (FA-7.3 Business Decision Lock §4) — NOT a
// placeholder. A salon whose qualifying ended-claim history involves at
// least this many distinct Field Agents is eligible for the signal.
export const CROSS_AGENT_DISTINCT_AGENT_THRESHOLD = 2;

const mapCrossAgentSeverity = (distinctAgentCount, threshold) => {
  if (distinctAgentCount >= threshold + 2) return SIGNAL_SEVERITY.HIGH;
  if (distinctAgentCount > threshold) return SIGNAL_SEVERITY.MEDIUM;
  return SIGNAL_SEVERITY.LOW;
};

// ─── CROSS_AGENT_SALON_CYCLING ───────────────────────────────────────
export const detectCrossAgentSalonCycling = async ({
  distinctAgentThreshold = CROSS_AGENT_DISTINCT_AGENT_THRESHOLD,
} = {}) => {
  // Bounded discovery — served by the existing {status:1,createdAt:-1}
  // index (filters to the ENDED subset, not the whole collection).
  const candidateSalonRefs = await AcquisitionClaim.distinct("salonRef", { status: CLAIM_STATUS.ENDED });

  const results = [];
  for (const salonRef of candidateSalonRefs) {
    // Full per-salon history, newest first — served by the existing
    // {salonRef:1,createdAt:-1} index, exactly the shape it exists for.
    const history = await AcquisitionClaim.find({ salonRef })
      .sort({ createdAt: -1 })
      .select("_id status endedReason fieldAgentRef createdAt")
      .lean();

    // Chronological order, ENDED only, ADMIN_REASSIGNED entirely
    // excluded (that claim-ending event never contributes — see file
    // header). An ACTIVE claim is never present here.
    const qualifyingAscending = history
      .filter((c) => c.status === CLAIM_STATUS.ENDED && c.endedReason !== CLAIM_END_REASON.ADMIN_REASSIGNED)
      .reverse();

    const seenAgents = new Set();
    for (let i = 0; i < qualifyingAscending.length; i++) {
      const claim = qualifyingAscending[i];
      seenAgents.add(String(claim.fieldAgentRef));

      if (seenAgents.size < distinctAgentThreshold) continue; // below threshold — no signal yet

      const distinctAgentCount = seenAgents.size;
      const qualifyingCycleCount = i + 1;
      const dedupeKey = `${SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING}:${salonRef}:${claim._id}`;

      const result = await recordSignal({
        signalType: SIGNAL_TYPE.CROSS_AGENT_SALON_CYCLING,
        subjectType: SUBJECT_TYPE.SALON,
        subjectRef: salonRef,
        fieldAgentRef: claim.fieldAgentRef,
        severity: mapCrossAgentSeverity(distinctAgentCount, distinctAgentThreshold),
        evidence: {
          salonRef: String(salonRef),
          triggeringClaimRef: String(claim._id),
          distinctAgentCount,
          qualifyingCycleCount,
        },
        sourceEventRef: claim._id,
        dedupeKey,
      });
      results.push(result);
    }
  }
  return results;
};
