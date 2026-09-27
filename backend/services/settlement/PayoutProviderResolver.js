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
import CashfreePayoutProvider, { CASHFREE_PROVIDER_NAME } from "./providers/CashfreePayoutProvider.js";
import RazorpayXPayoutProvider, { RAZORPAY_ROUTE_PROVIDER_NAME } from "./providers/RazorpayXPayoutProvider.js";
import { AppError } from "../../utils/response.js";

const PROVIDERS = Object.freeze({
  [PAYOUT_PROVIDER.MANUAL]: ManualProvider,
  // FA-P4-D Step 1 — CashfreePayoutProvider (Field Agent payouts).
  [CASHFREE_PROVIDER_NAME]: CashfreePayoutProvider,
  // STEP 6.4 — RazorpayXPayoutProvider (Generic PayoutRequest — SALON /
  // ACQUISITION_AGENT / TERRITORY_PARTNER). This is a DIFFERENT string
  // ("RAZORPAY_ROUTE") from models/PayoutRequest.js's own aspirational
  // PAYOUT_PROVIDER.RAZORPAYX value below — that SALON-specific enum
  // value is intentionally still NOT registered (SALON's own payout
  // flow, controllers/payout.controller.js, is untouched by this step;
  // see PayoutProvider.js header). Resolving PAYOUT_PROVIDER.RAZORPAYX
  // today still throws loudly rather than silently falling back to
  // ManualProvider — only GenericPayoutRequest's own
  // GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE value resolves to a real
  // provider now.
  [RAZORPAY_ROUTE_PROVIDER_NAME]: RazorpayXPayoutProvider,
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
