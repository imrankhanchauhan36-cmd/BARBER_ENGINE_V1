/**
 * BARBER ENGINE V1
 * backend/services/settlement/SettlementEngine.js
 * Settlement Engine — Phase 4A, lifecycle upgraded Phase 4B
 *
 * The one place a controller talks to for "make this payout happen."
 * Controllers must never know which provider executed a payout or how
 * — they call SettlementEngine.execute() and get back the outcome to
 * persist onto the PayoutRequest document.
 *
 * execute() does NOT write to PayoutRequest itself — the caller
 * (adminPayout.controller.js) still owns setting payout.status/
 * approvedBy/approvedAt and calling payout.save(), exactly as before,
 * inside the same transaction. This keeps all writes to that document
 * in one place rather than splitting them across files. The controller
 * assigns `payout.status = result.status` generically (unchanged since
 * Phase 4A), so returning PAYOUT_STATUS.PROCESSING here instead of PAID
 * persists correctly with zero controller edits.
 *
 * ── Phase 4B — status-driven lifecycle ────────────────────────────
 * Decisions are now made on `result.status` (SUCCESS/FAILED/PENDING),
 * not the old boolean `result.success`:
 *   SUCCESS → moveToProcessing + completePayout, same as pre-4B (the
 *             only reachable path today — ManualProvider always
 *             returns SUCCESS)
 *   FAILED  → throw ProviderException (same behavior as 4A.1, just
 *             keyed off status instead of !success)
 *   PENDING → moveToProcessing ONLY (funds move AVAILABLE-locked
 *             wallet into PROCESSING, but nothing is marked complete
 *             yet); returns PAYOUT_STATUS.PROCESSING rather than PAID.
 *             No provider produces this today — this is capability,
 *             not new observable behavior. No queue/cron/webhook
 *             resolves a PENDING payout later; that's out of scope
 *             for 4B by design (see task rules) and is left for
 *             whichever future phase adds a real async provider.
 *
 * The WalletBalanceService calls below are unchanged verbatim from
 * Phase 4A — same idempotency keys, same remarks, same parameters.
 */

import { PAYOUT_STATUS } from "../../models/PayoutRequest.js";
import WalletBalanceService from "../WalletBalanceService.js";
import PayoutProviderResolver from "./PayoutProviderResolver.js";
import { assertValidProviderResult } from "./PayoutProvider.js";
import { ProviderException } from "../../errors/ProviderException.js";
import { SETTLEMENT_STATUS, SETTLEMENT_FAILURE_CODE } from "./SettlementEnums.js";

const SettlementEngine = Object.freeze({
  /**
   * @param {Object} params
   * @param {import("mongoose").Document} params.payout
   * @param {import("mongoose").Types.ObjectId|null} params.adminId
   * @param {string|null} params.utr
   * @param {string|null} params.adminNote
   * @param {import("mongoose").ClientSession} params.session
   * @returns {Promise<{status:string, utr:string|null, providerPayoutId:string|null, providerResponse:*}>}
   */
  execute: async ({ payout, adminId, utr, adminNote, session }) => {
    const provider = PayoutProviderResolver.resolve(payout.payoutProvider);

    const result = await provider.execute({ payout, adminId, utr, adminNote, session });
    assertValidProviderResult(result);

    if (result.status === SETTLEMENT_STATUS.FAILED) {
      // Out of scope for Phase 4A/4A.1/4B (no retry/failure engine yet
      // — see PayoutProvider.js header). ManualProvider always returns
      // SUCCESS today, so this branch is unreachable in practice right
      // now; it exists so the contract stays honest for a future
      // provider instead of silently pretending success.
      throw new ProviderException({
        provider:  payout.payoutProvider,
        code:      result.failureCode || SETTLEMENT_FAILURE_CODE.PROVIDER_ERROR,
        message:   result.failureReason || "Payout execution failed",
        status:    502,
        retryable: result.retryable,
      });
    }

    // SUCCESS and PENDING both mean the provider actually accepted the
    // payout for processing — funds move out of LOCKED either way.
    await WalletBalanceService.moveToProcessing({
      salonId:        payout.salonId,
      amountInPaise:  payout.amountInPaise,
      entityType:     "WITHDRAWAL",
      entityId:       payout._id,
      idempotencyKey: `payout:processing:${payout._id}`,
      session,
      triggeredBy:    "ADMIN",
      triggeredById:  adminId,
      remarks:        adminNote || "Admin approved — moved to processing",
    });

    if (result.status === SETTLEMENT_STATUS.PENDING) {
      // Not reachable today (no provider returns PENDING) — see header.
      // Funds sit in PROCESSING; nothing is marked PAID until whatever
      // future mechanism resolves this payout.
      return {
        status:           PAYOUT_STATUS.PROCESSING,
        utr:              result.utr,
        providerPayoutId: result.providerPayoutId,
        providerResponse: result.providerResponse,
      };
    }

    // status === SUCCESS — the only reachable path today.
    await WalletBalanceService.completePayout({
      salonId:        payout.salonId,
      amountInPaise:  payout.amountInPaise,
      entityType:     "WITHDRAWAL",
      entityId:       payout._id,
      idempotencyKey: `payout:complete:${payout._id}`,
      session,
      triggeredBy:    "ADMIN",
      triggeredById:  adminId,
      remarks:        result.utr ? `UTR: ${result.utr}` : "Manual payout confirmed",
    });

    return {
      status:           PAYOUT_STATUS.PAID,
      utr:              result.utr,
      providerPayoutId: result.providerPayoutId,
      providerResponse: result.providerResponse,
    };
  },
});

export default SettlementEngine;
