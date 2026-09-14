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
export const SIGNAL_TYPE = Object.freeze({
  REFERRAL_VELOCITY: "REFERRAL_VELOCITY",
  WITHDRAW_RECLAIM_CYCLE: "WITHDRAW_RECLAIM_CYCLE",
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
