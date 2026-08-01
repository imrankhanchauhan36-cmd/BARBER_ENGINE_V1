//////////////////////////////////////////////////////////////
// CHAIR AVAILABILITY ENGINE — CONSTANTS (PHASE 1, BACKEND ONLY)
//
// Single source of truth for the enums this module uses. Kept
// separate from ChairAvailabilityOverride.js so the model, the
// validator, and the service can all import the same values
// without risking drift.
//////////////////////////////////////////////////////////////

// ── STATUS ──────────────────────────────────────────────────
// ACTIVE   — currently blocking the chair for its window.
// CANCELLED — soft-cancelled by the owner; kept (not deleted)
//             for audit trail. A cancelled block is invisible
//             to the Chair Timeline read path.
export const CHAIR_AVAILABILITY_STATUS = Object.freeze({
  ACTIVE:    "ACTIVE",
  CANCELLED: "CANCELLED",
});

export const CHAIR_AVAILABILITY_STATUS_VALUES = Object.values(CHAIR_AVAILABILITY_STATUS);

// ── TYPE ─────────────────────────────────────────────────────
// Purely descriptive/reporting metadata — the Chair Timeline read
// path never branches on this. Every type means the same thing
// operationally: "this chair is unavailable in this window."
// New types can be appended here in future phases (owner-facing
// UI / reporting only) WITHOUT touching the Slot Engine, Chair
// Timeline, or Auto Assignment.
export const CHAIR_AVAILABILITY_TYPE = Object.freeze({
  MANUAL:              "MANUAL",              // owner manually blocked the chair
  MAINTENANCE:         "MAINTENANCE",         // reserved — Phase 2+
  CLEANING:            "CLEANING",            // reserved — Phase 2+
  VIP_RESERVATION:     "VIP_RESERVATION",     // reserved — Phase 2+
  MACHINE_RESERVATION: "MACHINE_RESERVATION", // reserved — Phase 2+
  TRAINING:            "TRAINING",            // reserved — Phase 2+
  EMERGENCY:           "EMERGENCY",           // reserved — Phase 2+
});

export const CHAIR_AVAILABILITY_TYPE_VALUES = Object.values(CHAIR_AVAILABILITY_TYPE);

// ── OVERLAP VALIDATION ─────────────────────────────────────────
// Same "real, non-terminal commitment" status set used by the
// Holiday Override engine (salon.holiday.controller.js) when
// deciding whether a date can be turned into a holiday. Reused
// here verbatim for consistency — a chair block must be blocked
// by exactly the same class of booking a holiday already is.
export const ACTIVE_BOOKING_STATUSES = Object.freeze([
  "HOLD",
  "CONFIRMED",
  "CHECKED_IN",
  "ONGOING",
]);
