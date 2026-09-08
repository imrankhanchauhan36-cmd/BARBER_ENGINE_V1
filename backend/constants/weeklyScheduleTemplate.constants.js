//////////////////////////////////////////////////////////////
// WEEKLY SCHEDULE TEMPLATE — CONSTANTS (C4 Phase 1)
//
// Single source of truth for the status enum, shared by the model
// and the validator so they can never drift — same convention as
// constants/professionalChairAssignment.constants.js.
//////////////////////////////////////////////////////////////

// ACTIVE    — a live schedule version (past, currently effective, or
//             not-yet-effective). Multiple ACTIVE versions can and do
//             coexist for one salon — one per distinct effectiveFrom.
// CANCELLED — soft-cancelled by the owner; kept (never deleted) for
//             historical/audit purposes. Only a NOT-YET-EFFECTIVE
//             version may be cancelled (see service-level guard) —
//             this enum has no separate "past"/"expired" state
//             because effectiveFrom-based resolution already handles
//             that naturally.
export const TEMPLATE_STATUS = Object.freeze({
  ACTIVE:    "ACTIVE",
  CANCELLED: "CANCELLED",
});

export const TEMPLATE_STATUS_VALUES = Object.values(TEMPLATE_STATUS);

// Fixed, lowercase, Monday-first — matches Salon.timings' own weekday
// key convention exactly (models/Salon.js).
export const WEEKDAYS = Object.freeze([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
