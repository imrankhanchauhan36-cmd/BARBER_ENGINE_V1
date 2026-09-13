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
  // FA-3.4.1 — additive only, approved in FA-3.4 PLAN V2 §10/§17.
  // TestVersion lifecycle events written by
  // modules/fieldAgentTest/services/testContent.service.js into this
  // same, frozen FieldAgentAuditEvent collection (entityType
  // "TEST_VERSION") rather than a new parallel audit collection.
  TEST_VERSION_PUBLISHED: "TEST_VERSION_PUBLISHED",
  TEST_VERSION_RETIRED: "TEST_VERSION_RETIRED",
  // FA-3.4.3 — additive only, approved in FA-3.4 PLAN V2 §17 and this
  // work package's own explicit instruction. Written by
  // modules/fieldAgentTest/services/fieldAgentTest.service.js
  // (startTestAttempt/submitTestAttempt), inside the same transaction
  // as the TestAttempt write itself (entityType "TEST_ATTEMPT"),
  // actorType AGENT. TEST_STARTED fires only on an actual new
  // TestAttempt document being created, never on the idempotent
  // "return the existing active attempt" path; TEST_SUBMITTED fires
  // only once per successful finalization (see that service's own
  // inline comments for the exact idempotency/concurrency reasoning).
  TEST_STARTED: "TEST_STARTED",
  TEST_SUBMITTED: "TEST_SUBMITTED",
  // FA-4.1 — additive only. Written by
  // modules/fieldAgent/services/fieldAgentProfile.service.js
  // (createFieldAgentProfile), inside the same transaction as the
  // FieldAgent document's own creation. Fires exactly once per actual
  // profile created — never on the idempotent "return the existing
  // profile" recovery path (same idempotency discipline as
  // TEST_STARTED).
  FIELD_AGENT_PROFILE_CREATED: "FIELD_AGENT_PROFILE_CREATED",
  // FA-4.2 — additive only. Written by
  // modules/fieldAgent/services/fieldAgentApproval.service.js
  // (approveApplication/rejectApplication), entityType "APPLICATION",
  // actorType ADMIN, inside the same transaction as the application's
  // own status write (and, for approval, the FieldAgent profile
  // creation — see that service's own header for why one combined
  // transaction is required). Deliberately NO separate
  // "FIELD_AGENT_RESUBMITTED" action: resubmission is the existing,
  // unmodified FA-2 createOrGetDraftApplication path (a REJECTED
  // application is terminal; the same user starts a genuinely new
  // DRAFT application), which already writes APPLICATION_CREATED —
  // adding a redundant second event for the identical fact would
  // duplicate, not extend, the existing audit trail.
  FIELD_AGENT_APPROVED: "FIELD_AGENT_APPROVED",
  FIELD_AGENT_REJECTED: "FIELD_AGENT_REJECTED",
});

// FieldAgentAuditEvent.entityType vocabulary — a free-form string
// field on that frozen model (no schema enum), so this exists only so
// every write site uses the identical literal. "APPLICATION" was
// always FieldAgentAuditEvent's own implicit schema default (FA-2
// never had to name it explicitly); "FIELD_AGENT" is new in FA-4.1.
export const AUDIT_ENTITY_TYPE = Object.freeze({
  APPLICATION: "APPLICATION",
  FIELD_AGENT: "FIELD_AGENT",
});

// FA-4.1 — the FieldAgent operational profile's own status, DELIBERATELY
// separate from both User.accountStatus (generic, cross-domain account
// state) and FieldAgentApplication.status (the pre-approval application
// lifecycle, terminates at APPROVED).
export const FIELD_AGENT_OPERATIONAL_STATUS = Object.freeze({
  PENDING_ACTIVATION: "PENDING_ACTIVATION",
});

export const FIELD_AGENT_OTP_ROLE = "FIELD_AGENT";
