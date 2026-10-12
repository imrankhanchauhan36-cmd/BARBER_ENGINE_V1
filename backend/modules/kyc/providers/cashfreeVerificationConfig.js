/**
 * BARBER ENGINE V1
 * backend/modules/kyc/providers/cashfreeVerificationConfig.js
 *
 * ZEMISH dual-environment Cashfree pass — isolated, dependency-free
 * config resolver for the KYC Verification Suite / Secure ID product
 * ONLY. Deliberately reads a SEPARATE set of environment variables
 * from Cashfree Payouts (services/settlement/cashfree/
 * cashfreePayoutClient.js), which keeps its own CASHFREE_CLIENT_ID /
 * CASHFREE_CLIENT_SECRET / CASHFREE_ENV, completely untouched by this
 * file — see that file's own header for why a Verification Suite
 * credential must never be assumed valid for Payouts (Cashfree issues
 * credentials per product).
 *
 * Variables read (Verification Suite only):
 *   CASHFREE_VERIFICATION_ENV             "SANDBOX" | "PRODUCTION"
 *   CASHFREE_VERIFICATION_CLIENT_ID
 *   CASHFREE_VERIFICATION_CLIENT_SECRET
 *
 * FAILS CLOSED, deliberately: an unrecognized/missing
 * CASHFREE_VERIFICATION_ENV, or a missing client id/secret, returns
 * `configured:false` and a null baseUrl — this NEVER silently
 * defaults to Sandbox or Production. Every caller (cashfree.provider.js,
 * verification.service.js's cashfreeConfigured()) must treat
 * `configured:false` exactly like "provider not available" — fall
 * through to the next configured provider / manual review — and must
 * never attempt a request with a best-guess base URL or credential.
 *
 * Never logs or echoes clientSecret — the returned object carries it
 * only so the caller can attach it to a request header; nothing in
 * this file prints it, and `reason`/`environment` never embed it.
 */

const VALID_ENVIRONMENTS = Object.freeze(["SANDBOX", "PRODUCTION"]);

const BASE_URLS = Object.freeze({
  SANDBOX:    "https://sandbox.cashfree.com/verification",
  PRODUCTION: "https://api.cashfree.com/verification",
});

export const resolveCashfreeVerificationConfig = (env = process.env) => {
  const rawEnv = env.CASHFREE_VERIFICATION_ENV;

  if (!VALID_ENVIRONMENTS.includes(rawEnv)) {
    return {
      configured: false,
      reason: "invalid_environment",
      environment: null,
      baseUrl: null,
      clientId: null,
      clientSecret: null,
    };
  }

  const clientId = env.CASHFREE_VERIFICATION_CLIENT_ID;
  const clientSecret = env.CASHFREE_VERIFICATION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      configured: false,
      reason: "missing_credentials",
      environment: rawEnv,
      baseUrl: null,
      clientId: null,
      clientSecret: null,
    };
  }

  return {
    configured: true,
    reason: null,
    environment: rawEnv,
    baseUrl: BASE_URLS[rawEnv],
    clientId,
    clientSecret,
  };
};
