/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/territoryAssignmentOverlap.service.js
 *
 * FA-7.4 — the TERRITORY_ASSIGNMENT_CYCLING detector. READS
 * CommercialTerritory/TerritoryAssignment (frozen FA-5.2) READ-ONLY;
 * writes exclusively via the existing, frozen fraudSignal.service.js
 * #recordSignal — never duplicates that idempotency logic. Produces
 * advisory evidence only: no suspension, no status mutation, no
 * rejection of any assignment, no write of any kind to
 * CommercialTerritory, TerritoryAssignment, FieldAgent, or User.
 *
 * PURPOSE: the TerritoryAssignment analogue of FA-7.3's
 * CROSS_AGENT_SALON_CYCLING — a Commercial Territory whose ENDED
 * assignment history shows genuinely partner-driven churn (PARTNER_EXIT)
 * across at least 2 distinct Field Agents. A Territory Partner
 * relationship is a bigger commitment (license term, ongoing
 * commission) than a single salon claim, so this closes a gap: salon-
 * claim churn was already visible to the fraud layer (FA-7.3), but
 * Territory Partner churn was not.
 *
 * BUSINESS RULES (FA-7.4 lock, verbatim):
 *   - Only ENDED assignments count. An ACTIVE assignment is never a
 *     trigger.
 *   - endReason ADMIN_REASSIGNED and TERRITORY_RETIRED are EXCLUDED
 *     entirely — neither ending event contributes to the agent set or
 *     the qualifying count at all. ADMIN_REASSIGNED is deliberate
 *     administrative intervention (identical reasoning to FA-7.3's own
 *     ADMIN_REASSIGNED exclusion); TERRITORY_RETIRED is a purely
 *     structural/administrative wind-down with zero agent behavior
 *     behind it (set only by commercialTerritory.service.js's own
 *     retireTerritory auto-vacate step, never partner-initiated).
 *   - endReason PARTNER_EXIT is INCLUDED — the only genuinely
 *     agent-driven ending event.
 *   - Distinct-partner threshold is locked at 2
 *     (TERRITORY_ASSIGNMENT_DISTINCT_PARTNER_THRESHOLD below) — a
 *     genuine, approved business number, not a placeholder.
 *   - No time window in V1 — the full persisted qualifying history for
 *     a territory is evaluated every run.
 *   - The same Field Agent appearing across multiple ended assignments
 *     for the same territory counts only once toward the distinct-
 *     partner threshold (a Set, not a count of assignments).
 *
 * DISCOVERY (explicit instruction, not a design choice made here):
 * TerritoryAssignment.distinct('territoryRef', {status:'ENDED'}) is
 * deliberately NOT used — neither of TerritoryAssignment's two
 * partial-unique indexes covers status:"ENDED" (both partial filters
 * are status:"ACTIVE" only), so that query would not be efficiently
 * served. Instead, candidate territories are discovered by iterating
 * the CommercialTerritory master collection directly — inherently
 * bounded by nationwide territory count (not salon count), so a full
 * scan of that small collection is acceptable and requires no new
 * index. Each candidate's full assignment history is then fetched via
 * TerritoryAssignment's existing {territoryRef:1,effectiveFrom:-1}
 * index — exactly the shape it already exists to serve.
 *
 * DETECTION SHAPE: walk each territory's qualifying (ENDED,
 * PARTNER_EXIT-only) assignments in chronological (effectiveFrom
 * ascending) order, accumulating the set of distinct fieldAgentRef
 * values seen so far. The first qualifying assignment at which that
 * set's size reaches the threshold becomes a trigger; every qualifying
 * assignment from that point onward is also its own independent
 * trigger — the identical "Nth qualifying event onward, each its own
 * independent trigger" design already approved for FA-7.2's
 * WITHDRAW_RECLAIM_CYCLE and FA-7.3's CROSS_AGENT_SALON_CYCLING.
 *
 * SUBJECT: unlike CROSS_AGENT_SALON_CYCLING (SALON-subject, since a
 * cycling pattern on one salon may involve the same or different
 * agents), this signal is FIELD_AGENT-subject — subjectRef and
 * fieldAgentRef are both the server-derived triggering assignment's own
 * fieldAgentRef (the agent whose exit crossed or maintained the
 * distinct-partner threshold), per the approved implementation
 * authorization's own worked example.
 *
 * No persistent watermark: every run re-evaluates the full current
 * ended-assignment picture, identical trade-off to WITHDRAW_RECLAIM_CYCLE
 * and CROSS_AGENT_SALON_CYCLING — re-attempting recordSignal() for an
 * already-signaled assignment is a safe, cheap, idempotent no-op via
 * FraudSignal.dedupeKey, never a correctness risk.
 */

import CommercialTerritory from "../models/CommercialTerritory.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import { recordSignal } from "./fraudSignal.service.js";
import { SIGNAL_TYPE, SUBJECT_TYPE, SIGNAL_SEVERITY } from "../constants/fraudSignal.constants.js";
import { ASSIGNMENT_STATUS, ASSIGNMENT_END_REASON } from "../constants/commercialTerritory.constants.js";

// LOCKED business decision (FA-7.4 Business Decision Lock §1) — NOT a
// placeholder. A territory whose qualifying ended-assignment history
// involves at least this many distinct Field Agents is eligible for
// the signal.
export const TERRITORY_ASSIGNMENT_DISTINCT_PARTNER_THRESHOLD = 2;

const mapTerritoryCyclingSeverity = (distinctPartnerCount, threshold) => {
  if (distinctPartnerCount >= threshold + 2) return SIGNAL_SEVERITY.HIGH;
  if (distinctPartnerCount > threshold) return SIGNAL_SEVERITY.MEDIUM;
  return SIGNAL_SEVERITY.LOW;
};

// ─── TERRITORY_ASSIGNMENT_CYCLING ────────────────────────────────────
export const detectTerritoryAssignmentCycling = async ({
  distinctPartnerThreshold = TERRITORY_ASSIGNMENT_DISTINCT_PARTNER_THRESHOLD,
} = {}) => {
  // Bounded discovery via the small, admin-curated CommercialTerritory
  // master collection — see file header for why TerritoryAssignment's
  // own ENDED subset is not used for discovery.
  const territories = await CommercialTerritory.find({}).select("_id").lean();

  const results = [];
  for (const { _id: territoryRef } of territories) {
    // Full per-territory history, newest first — served by the
    // existing {territoryRef:1,effectiveFrom:-1} index, exactly the
    // shape it already exists to serve.
    const history = await TerritoryAssignment.find({ territoryRef })
      .sort({ effectiveFrom: -1 })
      .select("_id status endReason fieldAgentRef effectiveFrom")
      .lean();

    // Chronological order, ENDED only, PARTNER_EXIT only — both
    // ADMIN_REASSIGNED and TERRITORY_RETIRED are entirely excluded
    // (see file header). An ACTIVE assignment is never present here.
    const qualifyingAscending = history
      .filter((a) => a.status === ASSIGNMENT_STATUS.ENDED && a.endReason === ASSIGNMENT_END_REASON.PARTNER_EXIT)
      .reverse();

    const seenAgents = new Set();
    for (let i = 0; i < qualifyingAscending.length; i++) {
      const assignment = qualifyingAscending[i];
      seenAgents.add(String(assignment.fieldAgentRef));

      if (seenAgents.size < distinctPartnerThreshold) continue; // below threshold — no signal yet

      const distinctPartnerCount = seenAgents.size;
      const qualifyingAssignmentCount = i + 1;
      const dedupeKey = `${SIGNAL_TYPE.TERRITORY_ASSIGNMENT_CYCLING}:${territoryRef}:${assignment._id}`;

      const result = await recordSignal({
        signalType: SIGNAL_TYPE.TERRITORY_ASSIGNMENT_CYCLING,
        subjectType: SUBJECT_TYPE.FIELD_AGENT,
        subjectRef: assignment.fieldAgentRef,
        fieldAgentRef: assignment.fieldAgentRef,
        severity: mapTerritoryCyclingSeverity(distinctPartnerCount, distinctPartnerThreshold),
        evidence: {
          territoryRef: String(territoryRef),
          triggeringAssignmentRef: String(assignment._id),
          distinctPartnerCount,
          qualifyingAssignmentCount,
        },
        sourceEventRef: assignment._id,
        dedupeKey,
      });
      results.push(result);
    }
  }
  return results;
};
