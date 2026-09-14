/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/fieldAgentEarning.constants.js
 *
 * FA-9 — Field Agent Earning/Commission Engine vocabulary. Deliberately
 * a SEPARATE file from every other field-agent constants file (same
 * "new sub-domain gets its own constants file" precedent), since this
 * covers the earning ledger/progress/job, not policy authoring itself.
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): nothing in this file
 * defines a business rate/target — those remain exclusively in
 * CommercialPolicyVersion (FA-8) and CommercialPolicyOverride (FA-9).
 * This file only names the ENGINE's own vocabulary (entitlement types,
 * outcomes, job cadence).
 */

// A completed Booking can produce at most one POSITIVE earning row —
// either ACQUISITION or TERRITORY_PARTNER, never both (FA-9 Business
// Decision Lock §7, Issue 2 correction). Never simultaneous for one
// booking.
export const EARNING_ENTITLEMENT_TYPE = Object.freeze({
  ACQUISITION: "ACQUISITION",
  TERRITORY_PARTNER: "TERRITORY_PARTNER",
});

// Every processed entitlement attempt produces exactly one of these —
// a booking is never silently left with no outcome once evaluated.
// ZERO_TARGET_REACHED: an ACTIVE AcquisitionClaim existed but its
//   target capacity was already fully consumed before this booking.
// ZERO_AGENT_INELIGIBLE: the entitled agent's User.accountStatus was
//   not ACTIVE at processing time (suspended/blocked) — historically
//   valid entitlement is preserved elsewhere; only THIS booking's new
//   credit is withheld.
export const EARNING_CREDIT_OUTCOME = Object.freeze({
  CREDITED: "CREDITED",
  ZERO_TARGET_REACHED: "ZERO_TARGET_REACHED",
  ZERO_AGENT_INELIGIBLE: "ZERO_AGENT_INELIGIBLE",
});

// Which policy lineage a ledger row's policyVersionRef points into —
// a bare-ObjectId + discriminator idiom (mirrors FraudSignal's own
// proven pattern) rather than a Mongoose polymorphic ref, since the
// ref can point into either CommercialPolicyVersion (FA-8) or
// CommercialPolicyOverride (FA-9).
export const POLICY_SOURCE = Object.freeze({
  NATIONAL: "NATIONAL",
  AREA_OVERRIDE: "AREA_OVERRIDE",
});

export const ACQUISITION_PROGRESS_STATUS = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  TARGET_REACHED: "TARGET_REACHED",
});

// FA-9 CORRECTIVE (Finding A-1) — FieldAgentEarningPolicyGap's own
// vocabulary. BOOKING_POLICY_GAP: a completed Booking had no
// applicable policy at Booking.completedAt. CLAIM_PROGRESS_GAP: an
// AcquisitionClaim had no applicable policy at claim.createdAt, so its
// AcquisitionEarningProgress/target could not yet be snapshotted.
export const GAP_TYPE = Object.freeze({
  BOOKING_POLICY_GAP: "BOOKING_POLICY_GAP",
  CLAIM_PROGRESS_GAP: "CLAIM_PROGRESS_GAP",
});

export const GAP_STATUS = Object.freeze({
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
});

// Bounded per-tick reprocessing of OPEN gaps — independent of, and
// much smaller than, the main discovery batch, so a growing gap
// backlog never dominates a tick's cost.
export const GAP_RECONCILE_BATCH_SIZE = 50;

// One-time historical backfill batch size (see
// fieldAgentEarning.job.js#reconcileHistoricalGaps) — deliberately
// small and looped, never a single unbounded query.
export const GAP_BACKFILL_BATCH_SIZE = 500;

// ─── Background job cadence/safety ──────────────────────────────────
// Plain setInterval, no cron dependency — matches every existing job
// in this codebase (ratingOutbox/holdExpiry/reminder/etc.).
export const EARNING_JOB_INTERVAL_MS = 30 * 1000;

// Bounded batch per tick — index-backed, never a global scan (see
// Booking's new partial {status,completedAt,_id} index).
export const EARNING_JOB_BATCH_SIZE = 200;

// Clock-skew defense only (FA-9 Issue 3 correction, §C/§M) — never
// query bookings completed within this trailing window, giving any
// in-flight completion on a slightly-behind app-server clock time to
// land before the discovery cursor is asked to consider that instant
// "safely scanned."
export const EARNING_JOB_GRACE_PERIOD_MS = 3 * 60 * 1000;

// Fixed singleton document id for FieldAgentEarningJobCheckpoint.
export const EARNING_JOB_CHECKPOINT_ID = "FIELD_AGENT_EARNING_CURSOR";

// Bounded retry ceiling for per-booking transactions. Higher than
// commercialPolicy.service.js's MAX_PUBLISH_ATTEMPTS (5) deliberately —
// this document (AcquisitionEarningProgress, one per claim) can see
// genuinely higher write contention than a policy publish, since many
// concurrent bookings for the same salon/claim can complete around the
// same time. Combined with jittered backoff between attempts (see
// fieldAgentEarning.service.js's own retry loop) to avoid a retry
// storm under heavy contention.
export const MAX_EARNING_TRANSACTION_ATTEMPTS = 10;
export const EARNING_TRANSACTION_RETRY_BASE_DELAY_MS = 15;
