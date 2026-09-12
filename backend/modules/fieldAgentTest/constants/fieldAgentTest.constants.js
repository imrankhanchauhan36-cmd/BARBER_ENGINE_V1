/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/constants/fieldAgentTest.constants.js
 *
 * FA-3.4 — Mandatory Test Engine. Self-contained vocabulary for this
 * module only. Never imports from, and never redefines, anything in
 * modules/fieldAgent/* (FA-2) or modules/fieldAgentTraining/* (FA-3.3)
 * — the one cross-module dependency this module has (FA-2's
 * assertValidTransition/setApplicationStatus + APPLICATION_STATUS, and
 * FA-2's FieldAgentAuditEvent + additive AUDIT_ACTION values) is
 * imported directly from fieldAgent's own frozen files at the call
 * site, not mirrored here. SUPPORTED_LANGUAGE_CODES is intentionally
 * duplicated (not imported from fieldAgentTraining) to keep the two
 * Field-Agent-adjacent modules decoupled from each other.
 */

// DRAFT -> PUBLISHED -> RETIRED. Published versions are immutable
// (enforced in testContent.service.js, never here). At most one
// PUBLISHED version exists at a time — enforced via a partial unique
// index on TestVersion, same idiom as TrainingVersion's own.
export const TEST_VERSION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// V1 approved grading shape only — objective, single-correct-answer
// questions. No CHECKLIST shape (unlike TrainingContent's grading) —
// a certification exam question is naturally single-choice, and
// adding a second shape now would be unused complexity.
export const GRADING_TYPE = Object.freeze({
  SINGLE_CHOICE: "SINGLE_CHOICE",
});

export const LANGUAGE_CODE = Object.freeze({
  EN: "en",
  HI: "hi",
});

export const SUPPORTED_LANGUAGE_CODES = Object.freeze(Object.values(LANGUAGE_CODE));
export const DEFAULT_LANGUAGE_CODE = LANGUAGE_CODE.EN;

// FA-3.4.2 — TestAttempt business states. Exactly these three, never
// more (PLAN V2 Correction 2 — no EXPIRED/CANCELLED, no undocumented
// __GRADING__ pseudo-state). The submission-claim mutex
// (submissionClaimedAt, below) is a technical field on TestAttempt,
// never a fourth business status.
export const TEST_ATTEMPT_STATUS = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  PASSED: "PASSED",
  FAILED: "FAILED",
});

// TEST_AUDIT_ENTITY_TYPE — values written into FA-2's own
// FieldAgentAuditEvent.entityType (a free-form string field there, no
// schema change needed). Defined here only so every FA-3.4 write site
// uses the identical literal, never a typo'd ad-hoc string.
export const TEST_AUDIT_ENTITY_TYPE = Object.freeze({
  TEST_VERSION: "TEST_VERSION",
  TEST_QUESTION: "TEST_QUESTION",
  TEST_ATTEMPT: "TEST_ATTEMPT",
});

// ─── LOCKED V1 BUSINESS RULES (FA-3.4 PLAN V2 — approved) ──────────
export const DEFAULT_PASSING_SCORE = 70;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_COOLDOWN_MINUTES = 1440; // 24 hours
export const MIN_PUBLISHABLE_QUESTIONS = 10;

// A passingScore of 0 would let any submission (even a wrong one
// scoring 0) "pass", trivializing grading — same rationale as
// FA-3.3.2.1's PASSING_SCORE_MIN/MAX, reused here at the TestVersion
// (whole-test) level rather than per-content-item.
export const PASSING_SCORE_MIN = 1;
export const PASSING_SCORE_MAX = 100;
export const MAX_ATTEMPTS_MIN = 1;
export const RETRY_COOLDOWN_MINUTES_MIN = 0;

// FA-3.4.2's submission-claim mutex (PLAN V2 Correction 2) — not used
// by FA-3.4.1, declared here now so the constant lives in one place
// once TestAttempt lands.
export const SUBMISSION_CLAIM_STALE_MS = 60000;

// Admin query safety — same MAX_LIST_LIMIT idiom as
// fieldAgentTraining's own hardening.
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = Object.freeze({
  VERSIONS: 50,
});
