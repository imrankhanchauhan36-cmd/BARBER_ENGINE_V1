/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/compliance.constants.js
 *
 * FA-12.1 — Field Agent Compliance/Penalty domain vocabulary. A
 * separate file from fieldAgent.constants.js, same "new sub-domain
 * gets its own constants file" precedent as commercialPolicy.constants.js /
 * performance.constants.js relative to that shared file.
 *
 * LOCKED (FA-12 business decision lock):
 * - This taxonomy is INDEPENDENT of CommercialPolicyVersion.obligations/
 *   performanceFactors/coverageRules. Those may be cited as supporting
 *   context inside a piece of evidence, but never define or constrain
 *   this enum — a future CommercialPolicyVersion change must never
 *   reinterpret or invalidate a historical compliance category.
 * - Every category here was individually verified against real
 *   authoritative evidence in the repository (FA-12 audit). Categories
 *   with no authoritative source (CUSTOMER_COMPLAINT, FINANCIAL_ANOMALY,
 *   CONTRACTUAL_BREACH) are deliberately excluded — do not add them
 *   without a fresh audit proving a real evidence source exists.
 */

// FA-12 audit finding: TerritoryAssignment.endReason /
// AcquisitionClaim.endedReason values (PARTNER_EXIT, TERRITORY_RETIRED,
// ADMIN_REASSIGNED, ADMIN_REJECTED, AGENT_WITHDRAWN) are NEUTRAL
// lifecycle facts, not evidence of wrongdoing on their own — hence
// "...CONCERN", never "...BREACH", for this category specifically.
export const FA12_VIOLATION_CATEGORY = Object.freeze({
  KYC_ELIGIBILITY_LAPSE: "KYC_ELIGIBILITY_LAPSE",
  FRAUD_SIGNAL_SUPPORTED_REVIEW: "FRAUD_SIGNAL_SUPPORTED_REVIEW",
  ADMIN_OBSERVED_POLICY_BREACH: "ADMIN_OBSERVED_POLICY_BREACH",
  TERRITORY_CLAIM_LIFECYCLE_CONCERN: "TERRITORY_CLAIM_LIFECYCLE_CONCERN",
});

// What kind of authoritative reference a piece of evidence points to.
// ADMIN_NARRATIVE means the evidence IS the admin's own written
// account — there is no other system-detected fact behind it.
export const FA12_EVIDENCE_SOURCE_TYPE = Object.freeze({
  FRAUD_SIGNAL: "FRAUD_SIGNAL",
  KYC_STATUS: "KYC_STATUS",
  TERRITORY_ASSIGNMENT: "TERRITORY_ASSIGNMENT",
  ACQUISITION_CLAIM: "ACQUISITION_CLAIM",
  ADMIN_NARRATIVE: "ADMIN_NARRATIVE",
});

// DRAFT -> ... case lifecycle. Locked: no automatic SUSPENDED/BLOCKED
// status exists here — any real-world enforcement is a separate,
// manual action through the existing User.accountStatus mechanism,
// never a case status.
export const FA12_CASE_STATUS = Object.freeze({
  OPEN: "OPEN",
  UNDER_REVIEW: "UNDER_REVIEW",
  WARNING_ISSUED: "WARNING_ISSUED",
  ESCALATED: "ESCALATED",
  DISMISSED: "DISMISSED",
  RESOLVED: "RESOLVED",
});

// Terminal states from which an INDIA_ADMIN-only "reopen" transition
// (FA-12.2) returns a case to UNDER_REVIEW. Not enforced here — this
// is the domain-foundation's own documentation of the allowed lifecycle
// shape for FA-12.2 to implement against.
export const FA12_CASE_TERMINAL_STATUSES = Object.freeze([
  FA12_CASE_STATUS.WARNING_ISSUED,
  FA12_CASE_STATUS.ESCALATED,
  FA12_CASE_STATUS.DISMISSED,
  FA12_CASE_STATUS.RESOLVED,
]);

// Statuses that count as "active" for the at-most-one-active-case-per
// (fieldAgentRef,category) invariant — see FieldAgentComplianceCase.js's
// own activeCaseMarker field for how this is enforced at the index level.
export const FA12_CASE_ACTIVE_STATUSES = Object.freeze([FA12_CASE_STATUS.OPEN, FA12_CASE_STATUS.UNDER_REVIEW]);

export const FA12_CASE_DECISION_OUTCOME = Object.freeze({
  WARNING_ISSUED: "WARNING_ISSUED",
  ESCALATED_FOR_ENFORCEMENT: "ESCALATED_FOR_ENFORCEMENT",
  DISMISSED: "DISMISSED",
  NO_ACTION: "NO_ACTION",
});

// FieldAgentComplianceAuditEvent.entityType vocabulary.
export const FA12_AUDIT_ENTITY_TYPE = Object.freeze({
  FIELD_AGENT_COMPLIANCE_EVIDENCE: "FIELD_AGENT_COMPLIANCE_EVIDENCE",
  FIELD_AGENT_COMPLIANCE_CASE: "FIELD_AGENT_COMPLIANCE_CASE",
});

// FA-12's only actor type — this system has no AGENT/SYSTEM actor,
// unlike the broader FieldAgentAuditEvent.AUDIT_ACTOR_TYPE it mirrors
// the shape of. Every FA-12 action is an admin decision or admin-filed
// evidence.
export const FA12_AUDIT_ACTOR_TYPE = Object.freeze({
  ADMIN: "ADMIN",
});

// Exactly the FA-12.1-approved action set — do not invent unrelated
// actions. CASE_* actions map 1:1 to the case lifecycle transitions
// FA-12.2 will implement.
export const FA12_AUDIT_ACTION = Object.freeze({
  EVIDENCE_FILED: "EVIDENCE_FILED",
  EVIDENCE_ATTACHED_TO_CASE: "EVIDENCE_ATTACHED_TO_CASE",
  CASE_OPENED: "CASE_OPENED",
  CASE_UNDER_REVIEW: "CASE_UNDER_REVIEW",
  CASE_WARNING_ISSUED: "CASE_WARNING_ISSUED",
  CASE_ESCALATED: "CASE_ESCALATED",
  CASE_DISMISSED: "CASE_DISMISSED",
  CASE_RESOLVED: "CASE_RESOLVED",
  CASE_REOPENED: "CASE_REOPENED",
});

export const EVIDENCE_DESCRIPTION_MAX_LENGTH = 2000;
export const AUDIT_REASON_MAX_LENGTH = 500;
