/**
 * BARBER ENGINE V1
 * backend/modules/payout/constants/genericPayoutRequest.constants.js
 *
 * STEP 6.3 — Generic PayoutRequest Engine. This module's own
 * vocabulary — a NEW, standalone bounded context (modules/payout/),
 * deliberately NOT an extension of models/PayoutRequest.js (SALON-only,
 * "Phase 7 — 10/10 FROZEN" per that file's own controller header) and
 * NOT a modification of modules/fieldAgent/models/FieldAgentPayoutRequest.js
 * (FIELD_AGENT-only, its own "Option A: no persisted wallet" design,
 * now superseded for ACQUISITION_AGENT/TERRITORY_PARTNER by the real,
 * persisted wallet STEP 6.2 already built). Mirrors both existing
 * models' proven enum/status shape without reusing their code.
 */

// The three wallet-owner kinds STEP 6.2's Unified Wallet Engine already
// supports (SalonEarnings.WALLET_ENTITY_TYPE / WalletLedger.
// LEDGER_OWNER_TYPE) — this engine's own entityType is deliberately the
// SAME three values, nothing more, nothing less.
export const PAYOUT_ENTITY_TYPE = Object.freeze({
  SALON: "SALON",
  ACQUISITION_AGENT: "ACQUISITION_AGENT",
  TERRITORY_PARTNER: "TERRITORY_PARTNER",
});

// Same status vocabulary as models/PayoutRequest.js /
// FieldAgentPayoutRequest.js, for future-compatibility — but STEP 6.3
// ITSELF only ever creates REQUESTED rows ("No admin approval, no
// payout processing yet"). PROCESSING/PAID/FAILED/REJECTED/CANCELLED
// exist here only so a later step doesn't need a schema migration to
// use them.
export const GENERIC_PAYOUT_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

// Statuses that count as "open" — blocks a new request for the same
// entity. Mirrors PayoutRequest.OPEN_PAYOUT_STATUSES /
// FieldAgentPayoutRequest.FIELD_AGENT_PAYOUT_OPEN_STATUSES exactly.
// Only REQUESTED can ever occur in this step (nothing here ever
// transitions a row to PROCESSING yet) — PROCESSING is listed for the
// same forward-compatibility reason as the status enum above.
export const OPEN_GENERIC_PAYOUT_STATUSES = Object.freeze([
  GENERIC_PAYOUT_STATUS.REQUESTED,
  GENERIC_PAYOUT_STATUS.PROCESSING,
]);

// STEP 6.4 — RAZORPAY_ROUTE added, additive only. MANUAL is kept
// unchanged (reserved for any future manual-fallback path); this step
// itself always selects RAZORPAY_ROUTE (auto dispatch, no admin
// approval — see genericPayoutDispatch.service.js).
export const GENERIC_PAYOUT_PROVIDER = Object.freeze({
  MANUAL: "MANUAL",
  RAZORPAY_ROUTE: "RAZORPAY_ROUTE",
});
