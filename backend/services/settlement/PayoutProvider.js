/**
 * BARBER ENGINE V1
 * backend/services/settlement/PayoutProvider.js
 * Payout Provider Contract — Phase 4A, hardened Phase 4A.1, lifecycle Phase 4B
 *
 * Every settlement provider (ManualProvider today; RazorpayXProvider,
 * CashfreeProvider, a future bank-API provider, etc. later) must
 * implement a single async `execute(params)` method matching the
 * shapes documented below.
 *
 * A provider must NEVER touch WalletBalanceService, PayoutRequest.save(),
 * or any other DB write directly — that stays centralized in
 * SettlementEngine so every provider gets the same idempotency/ledger/
 * transaction-safety guarantees for free, instead of each provider
 * having to reimplement them (and risk getting them wrong).
 *
 * A provider reports its outcome by RETURNING {status, failureCode,
 * failureReason, retryable} — never by throwing. SettlementEngine is
 * the only layer that throws (a ProviderException), so every
 * provider's failure is handled identically regardless of which
 * provider it was.
 *
 * ── Phase 4B — status supersedes success ─────────────────────────
 * `status` (SETTLEMENT_STATUS.SUCCESS/FAILED/PENDING) is now the
 * authoritative field SettlementEngine branches on. `success` is kept
 * for backward compatibility — it must always agree with `status`
 * (success === true iff status === SUCCESS) and the validator enforces
 * that agreement rather than trusting a provider to set both correctly.
 *
 * @typedef {Object} PayoutProviderExecuteParams
 * @property {import("mongoose").Document} payout - the PayoutRequest document (not yet saved with a final status)
 * @property {import("mongoose").Types.ObjectId|null} adminId - admin performing the approval
 * @property {string|null} utr - UTR entered by the admin (manual flow) or null
 * @property {string|null} adminNote - optional admin remark
 * @property {import("mongoose").ClientSession} session - the caller's active transaction session; a provider must never start its own
 *
 * @typedef {Object} PayoutProviderResult
 * @property {string} status - one of SETTLEMENT_STATUS.SUCCESS | FAILED | PENDING — see SettlementEnums.js
 * @property {boolean} success - kept for backward compatibility; must equal (status === SUCCESS)
 * @property {boolean} retryable - whether a FAILED result is safe to retry; meaningless (but still required) when status !== FAILED
 * @property {string|null} utr
 * @property {string|null} providerPayoutId
 * @property {*} providerResponse
 * @property {string|null} failureCode - MUST always be present. null unless status === FAILED. See SettlementEnums.SETTLEMENT_FAILURE_CODE
 * @property {string|null} failureReason - null unless status === FAILED; human-readable detail on failure
 */

import { Errors } from "../../utils/response.js";
import { SETTLEMENT_STATUS } from "./SettlementEnums.js";

const REQUIRED_RESULT_KEYS = [
  "status", "success", "retryable",
  "utr", "providerPayoutId", "providerResponse",
  "failureCode", "failureReason",
];

const VALID_STATUSES = Object.values(SETTLEMENT_STATUS);

/**
 * Runtime contract check — a future provider returning the wrong
 * shape fails loudly at the point of the mistake, not three files
 * downstream inside SettlementEngine or the controller. Uses the
 * existing Errors.internal() factory (an AppError) rather than a
 * plain Error, so this is actually handled correctly by
 * middlewares/errorHandler.js instead of falling through to its
 * generic, message-discarding 500 branch.
 * @param {PayoutProviderResult} result
 */
export const assertValidProviderResult = (result) => {
  if (!result || typeof result !== "object") {
    throw Errors.internal("Payout provider must return a result object");
  }
  for (const key of REQUIRED_RESULT_KEYS) {
    if (!(key in result)) {
      throw Errors.internal(`Payout provider result is missing required field "${key}"`);
    }
  }
  if (!VALID_STATUSES.includes(result.status)) {
    throw Errors.internal(`Payout provider result "status" must be one of ${VALID_STATUSES.join(", ")}`);
  }
  if (typeof result.success !== "boolean") {
    throw Errors.internal('Payout provider result "success" must be a boolean');
  }
  if (typeof result.retryable !== "boolean") {
    throw Errors.internal('Payout provider result "retryable" must be a boolean');
  }

  // ✅ Phase 4B — success is now derived from status; a provider can't
  // report them inconsistently (e.g. status:FAILED with success:true).
  const expectedSuccess = result.status === SETTLEMENT_STATUS.SUCCESS;
  if (result.success !== expectedSuccess) {
    throw Errors.internal(`Payout provider result "success" (${result.success}) does not match "status" (${result.status})`);
  }

  // ✅ Phase 4A.1 rule, now keyed off status rather than success: a
  // non-FAILED result can't carry a failure code/reason, and a FAILED
  // result must carry both.
  if (result.status === SETTLEMENT_STATUS.FAILED) {
    if (!result.failureCode || !result.failureReason) {
      throw Errors.internal('Payout provider result with status:FAILED must include both failureCode and failureReason');
    }
  } else if (result.failureCode !== null || result.failureReason !== null) {
    throw Errors.internal(`Payout provider result with status:${result.status} cannot have a non-null failureCode/failureReason`);
  }
};
