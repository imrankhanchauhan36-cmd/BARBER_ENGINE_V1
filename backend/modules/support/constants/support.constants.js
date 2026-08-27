/**
 * BARBER ENGINE V1
 * backend/modules/support/constants/support.constants.js
 *
 * Phase C — Support Core. Shared enums so the model schemas,
 * services, and controllers never duplicate an allow-list.
 */

// ── Ticket lifecycle (frozen — Phase B §6 / Phase C §E) ─────────────
export const TICKET_STATUS = Object.freeze({
  OPEN: "OPEN",
  TRIAGED: "TRIAGED",
  QUEUED: "QUEUED",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
  REOPENED: "REOPENED",
});

// Valid transitions — the state-machine's single source of truth.
// OPEN -> RESOLVED exists only for a future SYSTEM-triggered
// self-service/Help-Center deflection (Phase H); no Phase C caller
// uses it yet, but the transition itself is part of the frozen
// lifecycle and must not silently reject a correctly-authorized
// SYSTEM actor later.
export const VALID_TRANSITIONS = Object.freeze({
  [TICKET_STATUS.OPEN]: [TICKET_STATUS.TRIAGED, TICKET_STATUS.RESOLVED],
  [TICKET_STATUS.TRIAGED]: [TICKET_STATUS.QUEUED],
  [TICKET_STATUS.QUEUED]: [TICKET_STATUS.ASSIGNED],
  // ASSIGNED -> QUEUED added Phase F.3.2 — represents an agent being
  // unassigned with no immediate replacement (Phase F §9). Queue/Team/
  // Agent didn't exist when this map was originally frozen in Phase C,
  // so this edge was never anticipated; additive only, every other
  // transition above and below is unchanged.
  [TICKET_STATUS.ASSIGNED]: [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.QUEUED],
  [TICKET_STATUS.IN_PROGRESS]: [TICKET_STATUS.WAITING_FOR_USER, TICKET_STATUS.RESOLVED],
  [TICKET_STATUS.WAITING_FOR_USER]: [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.RESOLVED],
  [TICKET_STATUS.RESOLVED]: [TICKET_STATUS.CLOSED],
  [TICKET_STATUS.CLOSED]: [TICKET_STATUS.REOPENED],
  [TICKET_STATUS.REOPENED]: [TICKET_STATUS.QUEUED, TICKET_STATUS.IN_PROGRESS],
});

export const REQUESTER_TYPE = Object.freeze({
  SALON_OWNER: "SALON_OWNER",
  USER: "USER",
});

export const PRIORITY = Object.freeze({
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

// Small, app-validated list per Phase B §5 (not its own collection —
// too lightweight to justify one). Extend here, not in a new model.
export const SUPPORTED_LANGUAGES = Object.freeze(["en", "hi"]);

export const ROUTING_SNAPSHOT_SOURCE = Object.freeze({
  SALON_TERRITORY: "SALON_TERRITORY",
  NONE: "NONE",
});

// ── Conversation ──────────────────────────────────────────────────
export const CHANNEL = Object.freeze({
  IN_APP: "IN_APP",
  WHATSAPP: "WHATSAPP",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  SMS: "SMS",
});

export const CONVERSATION_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
});

// ── Message ───────────────────────────────────────────────────────
export const MESSAGE_VISIBILITY = Object.freeze({
  CUSTOMER_VISIBLE: "CUSTOMER_VISIBLE",
  INTERNAL: "INTERNAL",
  SYSTEM: "SYSTEM",
});

export const SENDER_TYPE = Object.freeze({
  CUSTOMER: "CUSTOMER",
  AGENT: "AGENT",
  SYSTEM: "SYSTEM",
});

// ── Audit ─────────────────────────────────────────────────────────
export const ACTOR_TYPE = Object.freeze({
  CUSTOMER: "CUSTOMER",
  AGENT: "AGENT",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
});

// Phase C only ever writes CREATED, STATUS_CHANGED, REOPENED,
// CUSTOMER_REPLY — the remaining values are reserved by the frozen
// Phase B spec for later phases (assignment, SLA, escalation) so the
// enum doesn't need to change shape when those phases land.
export const AUDIT_ACTION = Object.freeze({
  CREATED: "CREATED",
  ASSIGNED: "ASSIGNED",
  REASSIGNED: "REASSIGNED",
  QUEUE_CHANGED: "QUEUE_CHANGED",
  TEAM_CHANGED: "TEAM_CHANGED",
  PRIORITY_CHANGED: "PRIORITY_CHANGED",
  STATUS_CHANGED: "STATUS_CHANGED",
  INTERNAL_NOTE: "INTERNAL_NOTE",
  CUSTOMER_REPLY: "CUSTOMER_REPLY",
  SLA_WARNING: "SLA_WARNING",
  SLA_BREACHED: "SLA_BREACHED",
  ESCALATED: "ESCALATED",
  RESOLVED: "RESOLVED",
  REOPENED: "REOPENED",
  CLOSED: "CLOSED",

  // Added Phase F.3.2 — the assignment-lifecycle taxonomy gap flagged
  // by Phase F.2's own report and ratified in the Phase F.3 audit.
  // UNASSIGNED/COMPLETED are per-SupportAssignment-row outcomes;
  // NO_AGENT_AVAILABLE is the ticket-level "queued, nobody eligible"
  // outcome. No other value here is renamed or reused differently.
  UNASSIGNED: "UNASSIGNED",
  NO_AGENT_AVAILABLE: "NO_AGENT_AVAILABLE",
  COMPLETED: "COMPLETED",

  // Added Phase H Step 7 (H.4) — the first real business-mutating
  // Support action (ISSUE_REFUND). REFUND_DENIED covers both a
  // request blocked by the fresh verification gate and one that
  // passed the gate but failed during execution — the `reason` field
  // on the audit event distinguishes which, matching the existing
  // reason-based convention already used across this audit trail.
  REFUND_ISSUED: "REFUND_ISSUED",
  REFUND_DENIED: "REFUND_DENIED",
});

// ── Routing + Coverage (Phase E.1 — schema foundation only; the
// resolution/evaluation algorithm these enums support is designed but
// not coded until Phase E.2) ─────────────────────────────────────────
export const SCOPE_LEVEL = Object.freeze({
  COUNTRY: "COUNTRY",
  STATE: "STATE",
  DISTRICT: "DISTRICT",
  CITY: "CITY",
  AREA: "AREA",
});

export const FALLBACK_BEHAVIOR = Object.freeze({
  CONTINUE_TO_PARENT: "CONTINUE_TO_PARENT",
  CENTRAL_SUPPORT: "CENTRAL_SUPPORT",
});

// ── Queue + Team + Agent (Phase F.1 — schema foundation only; no
// assignment/matching logic ships until a later Phase F sub-phase) ──
export const ASSIGNMENT_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  REASSIGNED: "REASSIGNED",
  UNASSIGNED: "UNASSIGNED",
  COMPLETED: "COMPLETED",
});

export const ASSIGNMENT_REASON = Object.freeze({
  ROUTING_ENGINE: "ROUTING_ENGINE",
  MANUAL: "MANUAL",
  REASSIGNMENT: "REASSIGNMENT",
  FALLBACK: "FALLBACK",
});

// OFFLINE is the default — presence must never assume AVAILABLE
// without a live signal (fail-safe, Phase F §11). AVAILABLE/BUSY are
// designed to be driven by a future Redis presence layer; ON_LEAVE/
// DISABLED are durable, admin/agent-set states persisted here today.
export const AGENT_AVAILABILITY_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  BUSY: "BUSY",
  OFFLINE: "OFFLINE",
  ON_LEAVE: "ON_LEAVE",
  DISABLED: "DISABLED",
});
