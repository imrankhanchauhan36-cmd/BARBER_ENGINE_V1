/**
 * BARBER ENGINE V1
 * backend/services/settlement/PayoutProviderResolver.js
 * Payout Provider Resolver — Phase 4A
 *
 * Single place that maps PayoutRequest.payoutProvider -> a concrete
 * provider implementation. Adding a new provider later (RazorpayX,
 * Cashfree, a bank API, ...) means adding one new file under
 * providers/ and one new entry in PROVIDERS below — SettlementEngine
 * and every controller stay untouched.
 */

import { PAYOUT_PROVIDER } from "../../models/PayoutRequest.js";
import ManualProvider from "./providers/ManualProvider.js";
import { AppError } from "../../utils/response.js";

const PROVIDERS = Object.freeze({
  [PAYOUT_PROVIDER.MANUAL]: ManualProvider,
  // PAYOUT_PROVIDER.RAZORPAYX intentionally NOT registered yet —
  // Phase 4A is architecture only (see PayoutProvider.js header).
  // Resolving it today throws loudly below rather than silently
  // falling back to ManualProvider, so an unimplemented provider can
  // never be mistaken for a working one.
});

const PayoutProviderResolver = Object.freeze({
  /**
   * @param {string} payoutProvider - PayoutRequest.payoutProvider value
   * @returns {import("./providers/ManualProvider.js").default}
   */
  resolve: (payoutProvider) => {
    const provider = PROVIDERS[payoutProvider];
    if (!provider) {
      throw new AppError(
        `No settlement provider implemented for "${payoutProvider}"`,
        501,
        "NOT_IMPLEMENTED"
      );
    }
    return provider;
  },
});

export default PayoutProviderResolver;
