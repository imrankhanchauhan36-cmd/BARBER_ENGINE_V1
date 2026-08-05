/**
 * BARBER ENGINE V1
 * backend/services/settlement/SettlementEnums.js
 * Centralized Settlement Enums — Phase 4B
 *
 * Single source of truth for the provider-result lifecycle. Previously
 * (Phase 4A.1) SUCCESS/FAILED/PENDING and the failure-code list existed
 * only as boolean success/failure + documentation-only comments — this
 * makes both real, importable enums instead of ad-hoc strings.
 */

// ─── Provider Result Status ────────────────────────────────
// What a provider's execute() call actually resolved to. Distinct
// from PayoutRequest's own PAYOUT_STATUS (REQUESTED/PROCESSING/PAID/
// ...) — this is the provider-level outcome that SettlementEngine
// translates into a PAYOUT_STATUS.
export const SETTLEMENT_STATUS = Object.freeze({
  SUCCESS: "SUCCESS", // payout completed now (ManualProvider always returns this today)
  FAILED:  "FAILED",  // payout did not go through — not implemented by any provider yet
  PENDING: "PENDING", // payout accepted by the provider but not yet resolved (async gateways, future use) — not implemented by any provider yet
});

// ─── Settlement Failure Codes ──────────────────────────────
// Machine-readable failure reasons. Documentation-only until a real
// async provider exists — no provider produces these yet.
export const SETTLEMENT_FAILURE_CODE = Object.freeze({
  BANK_DOWN:             "BANK_DOWN",
  NETWORK_ERROR:         "NETWORK_ERROR",
  TIMEOUT:               "TIMEOUT",
  ACCOUNT_CLOSED:        "ACCOUNT_CLOSED",
  INVALID_IFSC:          "INVALID_IFSC",
  INSUFFICIENT_BALANCE:  "INSUFFICIENT_BALANCE",
  PROVIDER_ERROR:        "PROVIDER_ERROR", // generic/unknown fallback
});
