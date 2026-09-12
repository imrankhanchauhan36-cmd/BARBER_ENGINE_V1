/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/fieldAgent.constants.js
 *
 * FA-2 — Field Agent Application Engine.
 *
 * Only the vocabulary FA-2 itself needs is defined here. Later phases
 * (FA-3 KYC, FA-4 admin approval, FA-5 zone, ...) extend this same
 * object with additional values as they land — additive, never a
 * breaking redefinition of what already exists.
 */

// Full FA-1-approved application lifecycle. FA-2 only ever transitions
// applications through DRAFT -> SUBMITTED -> WITHDRAWN itself (no
// KYC/training/test/admin logic exists yet), but the complete enum +
// transition map is defined now so FA-3/FA-4 can reuse this exact
// state machine unmodified instead of redefining it later.
export const APPLICATION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  KYC_PENDING: "KYC_PENDING",
  KYC_REJECTED: "KYC_REJECTED",
  TRAINING_PENDING: "TRAINING_PENDING",
  TEST_PENDING: "TEST_PENDING",
  TEST_FAILED: "TEST_FAILED",
  ADMIN_REVIEW: "ADMIN_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
});

export const TERMINAL_APPLICATION_STATUSES = Object.freeze([
  APPLICATION_STATUS.APPROVED,
  APPLICATION_STATUS.REJECTED,
  APPLICATION_STATUS.WITHDRAWN,
]);

// Explicit adjacency map — never inferred. Mirrors the exact pattern
// already proven in modules/support/constants/support.constants.js's
// own VALID_TRANSITIONS. Some target states below (KYC_PENDING onward)
// are not reachable via any FA-2 endpoint yet (no KYC/training/test/
// admin service exists to drive them) — they are declared here only so
// the state machine is complete and FA-3/FA-4 do not need to touch
// this map's shape, only call it.
export const VALID_APPLICATION_TRANSITIONS = Object.freeze({
  [APPLICATION_STATUS.DRAFT]: [APPLICATION_STATUS.SUBMITTED, APPLICATION_STATUS.WITHDRAWN],
  [APPLICATION_STATUS.SUBMITTED]: [APPLICATION_STATUS.KYC_PENDING, APPLICATION_STATUS.WITHDRAWN],
  [APPLICATION_STATUS.KYC_PENDING]: [
    APPLICATION_STATUS.KYC_REJECTED,
    APPLICATION_STATUS.TRAINING_PENDING,
    APPLICATION_STATUS.WITHDRAWN,
  ],
  [APPLICATION_STATUS.KYC_REJECTED]: [APPLICATION_STATUS.KYC_PENDING],
  [APPLICATION_STATUS.TRAINING_PENDING]: [APPLICATION_STATUS.TEST_PENDING, APPLICATION_STATUS.WITHDRAWN],
  [APPLICATION_STATUS.TEST_PENDING]: [APPLICATION_STATUS.TEST_FAILED, APPLICATION_STATUS.ADMIN_REVIEW],
  [APPLICATION_STATUS.TEST_FAILED]: [APPLICATION_STATUS.TEST_PENDING],
  [APPLICATION_STATUS.ADMIN_REVIEW]: [APPLICATION_STATUS.APPROVED, APPLICATION_STATUS.REJECTED],
  [APPLICATION_STATUS.APPROVED]: [],
  [APPLICATION_STATUS.REJECTED]: [],
  [APPLICATION_STATUS.WITHDRAWN]: [],
});

// FA-1 §3 / this phase's own instruction: exactly these 5 pre-approval
// states may withdraw — KYC_REJECTED/TEST_FAILED/ADMIN_REVIEW are
// deliberately excluded per the locked spec (a resubmission/retry/
// pending-decision state does not offer withdrawal in v1).
export const WITHDRAWABLE_APPLICATION_STATUSES = Object.freeze([
  APPLICATION_STATUS.DRAFT,
  APPLICATION_STATUS.SUBMITTED,
  APPLICATION_STATUS.KYC_PENDING,
  APPLICATION_STATUS.TRAINING_PENDING,
  APPLICATION_STATUS.TEST_PENDING,
]);

export const GENDER = Object.freeze({
  MALE: "MALE",
  FEMALE: "FEMALE",
  OTHER: "OTHER",
  PREFER_NOT_TO_SAY: "PREFER_NOT_TO_SAY",
});

// FieldAgentAuditEvent vocabulary — FA-2 only ever writes APPLICANT
// actor events for these 4 actions. actorType's ADMIN/AGENT values are
// declared now (not used until FA-4/later) so the schema enum never
// needs to change shape, only gain new ACTION values.
export const AUDIT_ACTOR_TYPE = Object.freeze({
  APPLICANT: "APPLICANT",
  AGENT: "AGENT",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

export const AUDIT_ACTION = Object.freeze({
  APPLICATION_CREATED: "APPLICATION_CREATED",
  APPLICATION_UPDATED: "APPLICATION_UPDATED",
  APPLICATION_SUBMITTED: "APPLICATION_SUBMITTED",
  APPLICATION_WITHDRAWN: "APPLICATION_WITHDRAWN",
});

export const FIELD_AGENT_OTP_ROLE = "FIELD_AGENT";
