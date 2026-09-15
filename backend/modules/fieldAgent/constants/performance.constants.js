/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/performance.constants.js
 *
 * FA-11.1 — Field Agent Performance's own vocabulary. A separate file
 * from fieldAgent.constants.js, same "new sub-domain gets its own
 * constants file" precedent as commercialPolicy.constants.js /
 * fieldAgentEarning.constants.js relative to that shared file.
 *
 * FA-11 audit finding (locked): no authoritative Field Agent linkage
 * exists in SupportTicket, and no complaint/grievance model exists
 * anywhere in the codebase. Both are therefore fixed, explicit
 * "unavailable" states — never silently omitted, never inferred from
 * a shared Salon reference.
 */

// DRAFT -> PUBLISHED -> RETIRED, exactly the CommercialPolicyVersion
// idiom. Published/retired are immutable (enforced in
// performancePolicy.service.js, never here). At most one PUBLISHED
// version exists at a time — enforced via a partial unique index.
export const PERFORMANCE_POLICY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Explicit, validated vocabulary for which evidence dimensions a
// published policy exposes — never an unrestricted arbitrary list.
// Scoring/weights are deliberately absent (FA-11 business decision:
// numeric score is deferred).
export const PERFORMANCE_DIMENSION = Object.freeze({
  ACQUISITION_PRODUCTIVITY: "ACQUISITION_PRODUCTIVITY",
  TERRITORY_PRODUCTIVITY: "TERRITORY_PRODUCTIVITY",
  COMPLIANCE_ELIGIBILITY: "COMPLIANCE_ELIGIBILITY",
  TERRITORY_LIFECYCLE: "TERRITORY_LIFECYCLE",
  FRAUD_ADVISORY_CONTEXT: "FRAUD_ADVISORY_CONTEXT",
  ADMIN_ACTION_CONTEXT: "ADMIN_ACTION_CONTEXT",
});

// Structural bound only (a window must be a positive whole number of
// days) — NOT the business default. The business-approved default of
// 90 days is a value an admin sets when authoring a DRAFT, never
// hard-coded here (same "bounds are structural, defaults are policy"
// discipline as commercialPolicy.constants.js).
export const ROLLING_WINDOW_DAYS_MIN = 1;

export const MAX_DIMENSIONS_PER_POLICY = Object.keys(PERFORMANCE_DIMENSION).length;

// Fixed, exact strings — FA-11 audit locked these as the ONLY
// permitted values for these two fields. Never computed, never
// templated, never overridden per-agent.
export const SUPPORT_RELATIONSHIP_EVIDENCE_UNAVAILABLE_MESSAGE =
  "UNAVAILABLE — no authoritative Field Agent linkage in SupportTicket";
export const COMPLAINT_EVIDENCE_UNAVAILABLE_MESSAGE = "UNAVAILABLE — no complaint/grievance model exists";

// Admin query safety — same MAX_LIST_LIMIT idiom as every other
// admin-list endpoint in this codebase (reserved for FA-11.3's read
// API; harmless to define alongside this domain's other constants
// now).
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 50;
