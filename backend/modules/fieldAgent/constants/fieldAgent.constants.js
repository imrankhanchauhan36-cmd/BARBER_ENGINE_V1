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
  // Phase 2 (KYC Defer) — TRAINING_PENDING added alongside the existing
  // KYC_PENDING target. submitApplication() now advances straight to
  // TRAINING_PENDING for every new submission (KYC no longer gates
  // Training); KYC_PENDING is kept in this list ONLY so it remains a
  // structurally valid (if now-unused-by-new-code) transition — nothing
  // else in this map, and no other file, changed.
  [APPLICATION_STATUS.SUBMITTED]: [
    APPLICATION_STATUS.KYC_PENDING,
    APPLICATION_STATUS.TRAINING_PENDING,
    APPLICATION_STATUS.WITHDRAWN,
  ],
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
  // Phase 2 (KYC Defer) — additive only. Written by submitApplication()
  // immediately after its own APPLICATION_SUBMITTED event, recording the
  // second, same-call hop from SUBMITTED straight to TRAINING_PENDING.
  KYC_DEFERRED_TO_TRAINING: "KYC_DEFERRED_TO_TRAINING",
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
  // FA-5.1 — additive only, approved in the FA-5 Architecture Decision
  // Lock §12/§16. Written by
  // modules/fieldAgent/services/commercialModel.service.js
  // (selectCommercialPath), entityType FIELD_AGENT, actorType ADMIN.
  // COMMERCIAL_POLICY_* are written by
  // modules/fieldAgent/services/commercialPolicy.service.js, entityType
  // COMMERCIAL_POLICY_VERSION — mirrors TEST_VERSION_PUBLISHED/
  // TEST_VERSION_RETIRED exactly (see that pair's own comment above).
  COMMERCIAL_MODEL_SELECTED: "COMMERCIAL_MODEL_SELECTED",
  COMMERCIAL_POLICY_CREATED: "COMMERCIAL_POLICY_CREATED",
  COMMERCIAL_POLICY_PUBLISHED: "COMMERCIAL_POLICY_PUBLISHED",
  COMMERCIAL_POLICY_RETIRED: "COMMERCIAL_POLICY_RETIRED",
  // FA-5.2 — additive only, per the FA-5.2 hardened implementation
  // plan §10/§12. Written by
  // modules/fieldAgent/services/commercialTerritory.service.js
  // (assignPartner/vacatePartner/retireTerritory's auto-vacate step),
  // entityType COMMERCIAL_TERRITORY, actorType ADMIN, inside the same
  // transaction as the CommercialTerritory/TerritoryAssignment write
  // itself — mirrors COMMERCIAL_MODEL_SELECTED's own transactional
  // discipline. Territory lifecycle events (created/updated/activated/
  // suspended/retired) use the existing fire-and-forget AdminAuditLog
  // convention instead (see utils/auditActions.js) — same split
  // already proven between AreaServiceability (AdminAuditLog) and
  // this module's own FieldAgentAuditEvent.
  TERRITORY_PARTNER_ASSIGNED: "TERRITORY_PARTNER_ASSIGNED",
  TERRITORY_PARTNER_VACATED: "TERRITORY_PARTNER_VACATED",
  // FA-5.3 — additive only. Written by
  // modules/fieldAgent/services/acquisitionClaim.service.js.
  // Referral issuance/cancellation are agent-initiated (actorType
  // AGENT); redemption is owner-initiated (actorType SYSTEM, since no
  // OWNER value exists in AUDIT_ACTOR_TYPE and none is invented here —
  // see that service's own header for the full reasoning); claim
  // ending is actorType AGENT (self-withdrawal) or ADMIN (reject/
  // reassign) depending on who actually called the endpoint.
  ACQUISITION_REFERRAL_CREATED: "ACQUISITION_REFERRAL_CREATED",
  ACQUISITION_REFERRAL_CONSUMED: "ACQUISITION_REFERRAL_CONSUMED",
  ACQUISITION_REFERRAL_CANCELLED: "ACQUISITION_REFERRAL_CANCELLED",
  ACQUISITION_CLAIM_CREATED: "ACQUISITION_CLAIM_CREATED",
  ACQUISITION_CLAIM_ENDED: "ACQUISITION_CLAIM_ENDED",
  // FA-11.1 — additive only. Written by
  // modules/fieldAgent/services/performancePolicy.service.js, entityType
  // PERFORMANCE_POLICY_VERSION, actorType ADMIN — mirrors
  // COMMERCIAL_POLICY_CREATED/PUBLISHED/RETIRED exactly (see that
  // trio's own comment above).
  PERFORMANCE_POLICY_CREATED: "PERFORMANCE_POLICY_CREATED",
  PERFORMANCE_POLICY_PUBLISHED: "PERFORMANCE_POLICY_PUBLISHED",
  PERFORMANCE_POLICY_RETIRED: "PERFORMANCE_POLICY_RETIRED",
  // FA-14 — additive only. Written by
  // modules/fieldAgent/services/fieldAgentPayout.service.js, entityType
  // FIELD_AGENT_PAYOUT_REQUEST, inside the same transaction as the
  // FieldAgentPayoutRequest document's own status write. actorType AGENT
  // for REQUESTED/CANCELLED (agent-initiated); actorType ADMIN for
  // APPROVED/REJECTED/PAID/FAILED/RETRIED (admin-initiated, manual
  // payout only — no automatic/RazorpayX provider in this phase).
  FIELD_AGENT_PAYOUT_REQUESTED: "FIELD_AGENT_PAYOUT_REQUESTED",
  FIELD_AGENT_PAYOUT_APPROVED: "FIELD_AGENT_PAYOUT_APPROVED",
  FIELD_AGENT_PAYOUT_REJECTED: "FIELD_AGENT_PAYOUT_REJECTED",
  FIELD_AGENT_PAYOUT_CANCELLED: "FIELD_AGENT_PAYOUT_CANCELLED",
  FIELD_AGENT_PAYOUT_PAID: "FIELD_AGENT_PAYOUT_PAID",
  FIELD_AGENT_PAYOUT_FAILED: "FIELD_AGENT_PAYOUT_FAILED",
  FIELD_AGENT_PAYOUT_RETRIED: "FIELD_AGENT_PAYOUT_RETRIED",
});

// FieldAgentAuditEvent.entityType vocabulary — a free-form string
// field on that frozen model (no schema enum), so this exists only so
// every write site uses the identical literal. "APPLICATION" was
// always FieldAgentAuditEvent's own implicit schema default (FA-2
// never had to name it explicitly); "FIELD_AGENT" is new in FA-4.1.
// "COMMERCIAL_POLICY_VERSION" is new in FA-5.1.
// "COMMERCIAL_TERRITORY" is new in FA-5.2.
// "ACQUISITION_REFERRAL"/"ACQUISITION_CLAIM" are new in FA-5.3.
// "PERFORMANCE_POLICY_VERSION" is new in FA-11.1.
// "FIELD_AGENT_PAYOUT_REQUEST" is new in FA-14.
export const AUDIT_ENTITY_TYPE = Object.freeze({
  APPLICATION: "APPLICATION",
  FIELD_AGENT: "FIELD_AGENT",
  COMMERCIAL_POLICY_VERSION: "COMMERCIAL_POLICY_VERSION",
  COMMERCIAL_TERRITORY: "COMMERCIAL_TERRITORY",
  ACQUISITION_REFERRAL: "ACQUISITION_REFERRAL",
  ACQUISITION_CLAIM: "ACQUISITION_CLAIM",
  PERFORMANCE_POLICY_VERSION: "PERFORMANCE_POLICY_VERSION",
  FIELD_AGENT_PAYOUT_REQUEST: "FIELD_AGENT_PAYOUT_REQUEST",
});

// FA-4.1 — the FieldAgent operational profile's own status, DELIBERATELY
// separate from both User.accountStatus (generic, cross-domain account
// state) and FieldAgentApplication.status (the pre-approval application
// lifecycle, terminates at APPROVED).
//
// FA-5.1 — ACTIVE is now added, per the FA-5 Architecture Decision Lock
// §12: a FieldAgent whose commercialPath is ACQUISITION_AGENT moves
// straight to ACTIVE the moment that path is selected (no further
// commercial gate exists for that path in V1 — see
// commercialModel.service.js). A FieldAgent whose commercialPath is
// TERRITORY_PARTNER stays PENDING_ACTIVATION in FA-5.1 — Territory
// Partner activation requires a License + exclusive Territory
// Assignment, neither of which exists until a later FA-5 phase. This
// enum value is purely additive; no existing PENDING_ACTIVATION
// profile is ever automatically transitioned by adding it. Do not add
// AT_RISK/SUSPENDED/BLOCKED/DEACTUATED here until an approved later
// phase actually needs them.
export const FIELD_AGENT_OPERATIONAL_STATUS = Object.freeze({
  PENDING_ACTIVATION: "PENDING_ACTIVATION",
  ACTIVE: "ACTIVE",
});

// FA-5.1 — the FieldAgent's chosen commercial relationship with
// ZEMISH, per the FA-5 Architecture Decision Lock §5/§12. Server-
// controlled only (never client-suppliable), set exactly once by an
// INDIA admin via commercialModel.service.js#selectCommercialPath.
// null (the schema default — this is NOT part of this enum's own
// value set) means "not yet selected", which remains valid
// indefinitely for any PENDING_ACTIVATION profile.
export const COMMERCIAL_PATH = Object.freeze({
  ACQUISITION_AGENT: "ACQUISITION_AGENT",
  TERRITORY_PARTNER: "TERRITORY_PARTNER",
});

export const FIELD_AGENT_OTP_ROLE = "FIELD_AGENT";
