//////////////////////////////////////////////////////////////
// PROFESSIONAL ↔ CHAIR ASSIGNMENT ENGINE — CONSTANTS (PHASE 3)
//
// Single source of truth for the status enum, shared by the model
// and the validator so they can never drift — same convention as
// constants/chairAvailability.constants.js.
//////////////////////////////////////////////////////////////

// ACTIVE    — currently a live, in-force assignment.
// CANCELLED — soft-cancelled by the owner; kept (never deleted) for
//             historical/audit purposes. A cancelled assignment is
//             invisible to every live conflict check.
export const ASSIGNMENT_STATUS = Object.freeze({
  ACTIVE:    "ACTIVE",
  CANCELLED: "CANCELLED",
});

export const ASSIGNMENT_STATUS_VALUES = Object.values(ASSIGNMENT_STATUS);

// C4 Phase 2 — additive, backward-compatible attribution only. Never
// read by checkConflicts(), the Slot Engine, or Booking — it exists
// purely so an operator/owner can tell why a row exists. Existing rows
// created before this field existed have no `source` at all in the
// database (no migration/backfill was run) and are treated as MANUAL
// by the model's own default whenever they're loaded/re-saved; every
// NEW row defaults to MANUAL unless the (Phase 2) materializer
// explicitly passes TEMPLATE.
export const ASSIGNMENT_SOURCE = Object.freeze({
  MANUAL:   "MANUAL",
  TEMPLATE: "TEMPLATE",
});

export const ASSIGNMENT_SOURCE_VALUES = Object.values(ASSIGNMENT_SOURCE);

// Safety cap on a single multi-day create request — prevents an
// accidental/abusive request (e.g. a mistyped 10-year range) from
// generating an unbounded number of rows in one call. Not a business
// rule from the spec, a scale guard only; raise if a real product
// need for a longer range ever appears.
export const MAX_ASSIGNMENT_RANGE_DAYS = 62;
