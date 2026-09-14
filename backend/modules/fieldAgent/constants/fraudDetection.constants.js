/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/fraudDetection.constants.js
 *
 * FA-7.2 — Detection Engine vocabulary/configuration. Deliberately a
 * SEPARATE file from fraudSignal.constants.js (FA-7.1's own closed
 * signalType/subjectType/severity vocabulary, untouched here) — same
 * "new sub-domain gets its own constants file" precedent already
 * established by every prior FA-5/FA-7 phase.
 *
 * TECHNICAL DEFAULTS vs BUSINESS THRESHOLDS (do not conflate the two):
 *
 *   TECHNICAL DEFAULTS — detection-granularity implementation details,
 *   freely adjustable later without business sign-off:
 *     - BUCKET_SIZE_MS / JOB_INTERVAL_MS
 *
 *   BUSINESS THRESHOLDS — genuinely undecided, per the FA-7.2 audit's
 *   own §9/§10: no referrals-per-hour count or claim-cycle count is
 *   defined anywhere in this repository or business plan. The two
 *   constants below are PLACEHOLDER values that exist ONLY so the
 *   detectors are technically runnable end-to-end for development and
 *   testing. They are explicitly NOT approved business policy and
 *   MUST be replaced with real, business-approved numbers before this
 *   engine's output is used for anything beyond development testing.
 */

// ── TECHNICAL DEFAULTS ────────────────────────────────────────────
export const BUCKET_SIZE_MS = 60 * 60 * 1000; // 1 closed hour
export const JOB_INTERVAL_MS = 60 * 60 * 1000; // at most hourly, per the approved plan

// ── BUSINESS THRESHOLDS — PLACEHOLDER, NOT APPROVED POLICY ────────
// See file header. Do not treat either value as a locked business
// decision — both remain OPEN per the FA-7.2 audit.
export const REFERRAL_VELOCITY_THRESHOLD_PLACEHOLDER = 50;
export const WITHDRAW_RECLAIM_CYCLE_THRESHOLD_PLACEHOLDER = 3;
