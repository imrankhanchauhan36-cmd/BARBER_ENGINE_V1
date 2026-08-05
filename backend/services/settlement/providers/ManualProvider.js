/**
 * BARBER ENGINE V1
 * backend/services/settlement/providers/ManualProvider.js
 * Manual Payout Provider — Phase 4A, lifecycle contract Phase 4B
 *
 * Extracted verbatim from the pre-Phase-4A inline logic in
 * adminPayout.controller.js's approvePayout — no behavior change since.
 *
 * The admin has already transferred funds outside this system (bank
 * app, NEFT, IMPS, whatever) and is confirming that transfer here by
 * typing the resulting UTR themselves. This provider performs no
 * external I/O and cannot itself fail or go async — it always
 * completes immediately with status:SUCCESS, exactly the same trust
 * model the system has always used. It never touches
 * WalletBalanceService or the database — see PayoutProvider.js for
 * why that responsibility stays in SettlementEngine.
 */

import { SETTLEMENT_STATUS } from "../SettlementEnums.js";

const ManualProvider = Object.freeze({
  name: "MANUAL",

  /** @param {import("../PayoutProvider.js").PayoutProviderExecuteParams} params */
  execute: async ({ utr }) => {
    return {
      status:            SETTLEMENT_STATUS.SUCCESS,
      success:           true, // kept for backward compatibility — always agrees with status
      retryable:         false, // not meaningful on a non-FAILED result, but always present per contract
      utr:               utr || null,
      providerPayoutId:  null,
      providerResponse:  null,
      failureCode:       null,
      failureReason:     null,
    };
  },
});

export default ManualProvider;
