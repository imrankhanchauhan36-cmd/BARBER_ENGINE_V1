/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/fraudSignal.constants.js
 *
 * FA-7.1 — FraudSignal vocabulary. Deliberately a SEPARATE file from
 * fieldAgent.constants.js/commercialTerritory.constants.js/
 * acquisitionClaim.constants.js — same "new sub-domain gets its own
 * constants file" precedent already established by every prior FA-5
 * phase.
 *
 * Closed to exactly the vocabulary FA-7.1 needs today. No speculative
 * signal types, subject types, or severities — FA-7.2 (Detection
 * Engine) extends SIGNAL_TYPE additively when a new, separately
 * approved detector is built; this file does not anticipate that.
 */

// The two detectors approved for FA-7.2 — defined here only because
// FraudSignal.signalType must be a closed enum from day one. FA-7.1
// itself contains no detection logic that produces either value.
//
// FA-7.3 — CROSS_AGENT_SALON_CYCLING added additively (explicit, narrow
// frozen-boundary exception authorized for FA-7.3 only). Cannot reuse
// WITHDRAW_RECLAIM_CYCLE's dedupeKey namespace: that signal is already
// keyed to the identical triggering claim a cross-agent detector would
// use, so a second recordSignal() call under that same type would just
// return FA-7.2's own already-persisted (and differently-shaped)
// document, immutably, never carrying the distinct-agent evidence this
// detector needs. No detection logic for this value exists in this
// file — see modules/fieldAgent/services/crossAgentOverlap.service.js.
//
// FA-7.4 — TERRITORY_ASSIGNMENT_CYCLING added additively (same narrow,
// explicit frozen-boundary exception pattern, authorized for FA-7.4
// only). The TerritoryAssignment analogue of CROSS_AGENT_SALON_CYCLING:
// a Commercial Territory whose ENDED, PARTNER_EXIT-only assignment
// history involves >= 2 distinct Field Agents. Needs its own type for
// the identical reason CROSS_AGENT_SALON_CYCLING did — a differently-
// shaped evidence payload keyed to a differently-shaped triggering
// event. No detection logic for this value exists in this file — see
// modules/fieldAgent/services/territoryAssignmentOverlap.service.js.
export const SIGNAL_TYPE = Object.freeze({
  REFERRAL_VELOCITY: "REFERRAL_VELOCITY",
  WITHDRAW_RECLAIM_CYCLE: "WITHDRAW_RECLAIM_CYCLE",
  CROSS_AGENT_SALON_CYCLING: "CROSS_AGENT_SALON_CYCLING",
  TERRITORY_ASSIGNMENT_CYCLING: "TERRITORY_ASSIGNMENT_CYCLING",
});

// What a signal is fundamentally ABOUT, for future "all signals
// touching X" queries — deliberately just these two, not a
// speculative four-way (REFERRAL/CLAIM/SALON/FIELD_AGENT) enum.
// WITHDRAW_RECLAIM_CYCLE is SALON-subject (a cycling pattern on one
// salon may involve the same agent repeatedly or different agents
// churning through it — anchoring on the salon captures both;
// anchoring on the agent would miss the latter). REFERRAL_VELOCITY is
// FIELD_AGENT-subject (it is inherently about one agent's issuance
// rate).
export const SUBJECT_TYPE = Object.freeze({
  FIELD_AGENT: "FIELD_AGENT",
  SALON: "SALON",
});

// Suspiciousness/severity of the OBSERVATION only — never "confirmed
// fraud". Only an authorized admin decision (a future FraudCase
// concept, not built in FA-7.1) may classify an investigation
// outcome. See FraudSignal.js's own header for the full false-positive
// safety reasoning.
export const SIGNAL_SEVERITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});
