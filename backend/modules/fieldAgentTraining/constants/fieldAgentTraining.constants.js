/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/constants/fieldAgentTraining.constants.js
 *
 * FA-3.3 — Field Agent Training Engine. Self-contained vocabulary for
 * this module only. Never imports from, and never redefines, anything
 * in modules/fieldAgent/* (FA-2) or modules/kyc/* (FA-3.1/3.2) — the
 * one cross-module dependency this module has (FA-2's
 * assertValidTransition/setApplicationStatus + APPLICATION_STATUS) is
 * imported directly from fieldAgent's own frozen files at the call
 * site, not mirrored here.
 */

// DRAFT -> PUBLISHED -> RETIRED. Published versions are immutable
// (enforced in trainingContent.service.js, never here). At most one
// PUBLISHED version exists at a time — enforced via a partial unique
// index on TrainingVersion, same idiom as FieldAgentApplication's
// {userRef} partial-unique-on-nonTerminal index.
export const TRAINING_VERSION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Exactly the 10 mandatory curriculum modules approved for FA-3.3, in
// mandatory delivery order. Fixed, stable keys — never renamed. A
// TrainingVersion is not publishable unless all 10 exist with
// required content (see trainingContent.service.js#publishVersion).
export const MODULE_KEY = Object.freeze({
  FOUNDATION: "FOUNDATION",
  USER_APP: "USER_APP",
  SALON_APP: "SALON_APP",
  SALON_ACQUISITION: "SALON_ACQUISITION",
  SALON_ONBOARDING: "SALON_ONBOARDING",
  BOOKING_OPERATIONS: "BOOKING_OPERATIONS",
  KYC_FINANCE_POLICY: "KYC_FINANCE_POLICY",
  TROUBLESHOOTING_SUPPORT: "TROUBLESHOOTING_SUPPORT",
  FIELD_VISIT_EDUCATION: "FIELD_VISIT_EDUCATION",
  COMPLIANCE_CONDUCT: "COMPLIANCE_CONDUCT",
});

// Curriculum-mandated order — index in this array IS the required
// `order` value for each module within a version.
export const MODULE_KEY_ORDER = Object.freeze([
  MODULE_KEY.FOUNDATION,
  MODULE_KEY.USER_APP,
  MODULE_KEY.SALON_APP,
  MODULE_KEY.SALON_ACQUISITION,
  MODULE_KEY.SALON_ONBOARDING,
  MODULE_KEY.BOOKING_OPERATIONS,
  MODULE_KEY.KYC_FINANCE_POLICY,
  MODULE_KEY.TROUBLESHOOTING_SUPPORT,
  MODULE_KEY.FIELD_VISIT_EDUCATION,
  MODULE_KEY.COMPLIANCE_CONDUCT,
]);

// Approved 4-value set only — do not add arbitrary content types.
export const CONTENT_TYPE = Object.freeze({
  LESSON: "LESSON",
  KNOWLEDGE_CHECK: "KNOWLEDGE_CHECK",
  PRACTICAL_SCENARIO: "PRACTICAL_SCENARIO",
  REFERENCE: "REFERENCE",
});

// v1 approved languages. Extensible: adding a regional language later
// means adding a code here + authoring translations, never a schema
// or completion-logic change (see TrainingContent.js's translations
// array + fieldAgentTraining.service.js's language-fallback resolver).
export const LANGUAGE_CODE = Object.freeze({
  EN: "en",
  HI: "hi",
});

export const SUPPORTED_LANGUAGE_CODES = Object.freeze(Object.values(LANGUAGE_CODE));
export const DEFAULT_LANGUAGE_CODE = LANGUAGE_CODE.EN;

// Per-content-item progress states (FieldAgentTraining's embedded
// contentProgress). NOT_STARTED is implicit (no array entry yet).
export const CONTENT_PROGRESS_STATUS = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
});

export const MODULE_PROGRESS_STATUS = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
});

export const FIELD_AGENT_TRAINING_STATUS = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
});

// TrainingAuditEvent vocabulary — mirrors FieldAgentAuditEvent's own
// {actorType,action} shape exactly (modules/fieldAgent/models/
// FieldAgentAuditEvent.js), as a separate collection for this
// module's bounded context.
export const TRAINING_AUDIT_ACTOR_TYPE = Object.freeze({
  AGENT: "AGENT",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

export const TRAINING_AUDIT_ENTITY_TYPE = Object.freeze({
  TRAINING_VERSION: "TRAINING_VERSION",
  TRAINING_MODULE: "TRAINING_MODULE",
  TRAINING_CONTENT: "TRAINING_CONTENT",
  FIELD_AGENT_TRAINING: "FIELD_AGENT_TRAINING",
});

export const TRAINING_AUDIT_ACTION = Object.freeze({
  VERSION_CREATED: "VERSION_CREATED",
  VERSION_PUBLISHED: "VERSION_PUBLISHED",
  VERSION_RETIRED: "VERSION_RETIRED",
  MODULE_CREATED: "MODULE_CREATED",
  MODULE_UPDATED: "MODULE_UPDATED",
  CONTENT_CREATED: "CONTENT_CREATED",
  CONTENT_UPDATED: "CONTENT_UPDATED",
  CONTENT_DELETED: "CONTENT_DELETED",
  ENROLLMENT_CREATED: "ENROLLMENT_CREATED",
  ENROLLMENT_SUPERSEDED: "ENROLLMENT_SUPERSEDED",
  CONTENT_COMPLETED: "CONTENT_COMPLETED",
  MODULE_COMPLETED: "MODULE_COMPLETED",
  TRAINING_COMPLETED: "TRAINING_COMPLETED",
  MEDIA_ACCESS_GRANTED: "MEDIA_ACCESS_GRANTED",
  ADMIN_PROGRESS_OVERRIDE: "ADMIN_PROGRESS_OVERRIDE",
});

// Admin override marker — every ADMIN_PROGRESS_OVERRIDE audit row must
// carry exactly one of these, per the approved plan's
// RECOMMENDED/REQUIRES_APPROVAL split.
export const ADMIN_OVERRIDE_CLASS = Object.freeze({
  RECOMMENDED: "RECOMMENDED",
  REQUIRES_APPROVAL: "REQUIRES_APPROVAL",
});

// Short-lived signed Cloudinary delivery — media is uploaded with
// type:"authenticated" (never public), and every playback URL handed
// to an agent is minted per-request with this TTL, then audited via
// MEDIA_ACCESS_GRANTED. 10 minutes is generous enough for a lesson
// video to load and play without needing re-signing mid-playback,
// short enough that a leaked URL stops working quickly.
export const SIGNED_MEDIA_URL_TTL_SECONDS = 600;

export const HELP_ELIGIBLE_MODULE_KEYS = Object.freeze([
  MODULE_KEY.SALON_ONBOARDING,
  MODULE_KEY.BOOKING_OPERATIONS,
  MODULE_KEY.KYC_FINANCE_POLICY,
  MODULE_KEY.TROUBLESHOOTING_SUPPORT,
  MODULE_KEY.COMPLIANCE_CONDUCT,
]);
