/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyCashfreeVerificationConfig.mjs
 *
 * ZEMISH dual-environment Cashfree pass — focused, offline,
 * zero-dependency test for resolveCashfreeVerificationConfig()
 * (modules/kyc/providers/cashfreeVerificationConfig.js), the single
 * source of truth cashfree.provider.js and verification.service.js's
 * cashfreeConfigured() both now use.
 *
 * NO database, NO HTTP server, NO live provider call — every scenario
 * below passes a synthetic {CASHFREE_VERIFICATION_*, CASHFREE_*} env
 * object directly into the resolver (its `env` parameter defaults to
 * process.env but accepts an injected object for exactly this reason)
 * — nothing here ever touches the real process.env.
 *
 * Covers Phase C items 1-5. Item 6 (existing provider-selection/
 * manual-review/onboarding-gate regression) is covered by re-running
 * the existing suite — see this file's own run instructions below for
 * the full command list used to confirm that.
 *
 * Run:  cd backend && node scripts/unit/verifyCashfreeVerificationConfig.mjs
 */

import { resolveCashfreeVerificationConfig } from "../../modules/kyc/providers/cashfreeVerificationConfig.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const run = () => {
  // ── 1. Sandbox selects ONLY Sandbox credentials and endpoint ──
  {
    const result = resolveCashfreeVerificationConfig({
      CASHFREE_VERIFICATION_ENV: "SANDBOX",
      CASHFREE_VERIFICATION_CLIENT_ID: "sandbox-id-fixture",
      CASHFREE_VERIFICATION_CLIENT_SECRET: "sandbox-secret-fixture",
    });
    check("1. SANDBOX: configured === true", result.configured === true);
    check("1. SANDBOX: baseUrl is the real sandbox Verification Suite URL", result.baseUrl === "https://sandbox.cashfree.com/verification");
    check("1. SANDBOX: baseUrl is NOT the production URL", result.baseUrl !== "https://api.cashfree.com/verification");
    check("1. SANDBOX: clientId is the sandbox fixture value, unmixed", result.clientId === "sandbox-id-fixture");
    check("1. SANDBOX: clientSecret is the sandbox fixture value, unmixed", result.clientSecret === "sandbox-secret-fixture");
    check("1. SANDBOX: environment echoed back exactly", result.environment === "SANDBOX");
  }

  // ── 2. Production selects ONLY Production credentials and endpoint ──
  {
    const result = resolveCashfreeVerificationConfig({
      CASHFREE_VERIFICATION_ENV: "PRODUCTION",
      CASHFREE_VERIFICATION_CLIENT_ID: "production-id-fixture",
      CASHFREE_VERIFICATION_CLIENT_SECRET: "production-secret-fixture",
    });
    check("2. PRODUCTION: configured === true", result.configured === true);
    check("2. PRODUCTION: baseUrl is the real production Verification Suite URL", result.baseUrl === "https://api.cashfree.com/verification");
    check("2. PRODUCTION: baseUrl is NOT the sandbox URL", result.baseUrl !== "https://sandbox.cashfree.com/verification");
    check("2. PRODUCTION: clientId is the production fixture value, unmixed", result.clientId === "production-id-fixture");
    check("2. PRODUCTION: clientSecret is the production fixture value, unmixed", result.clientSecret === "production-secret-fixture");
    check("2. PRODUCTION: environment echoed back exactly", result.environment === "PRODUCTION");
  }

  // ── 3. Missing credentials fail safely (configured:false, no baseUrl) ──
  {
    const noId = resolveCashfreeVerificationConfig({
      CASHFREE_VERIFICATION_ENV: "PRODUCTION",
      CASHFREE_VERIFICATION_CLIENT_SECRET: "production-secret-fixture",
    });
    check("3. Missing CLIENT_ID: configured === false", noId.configured === false);
    check("3. Missing CLIENT_ID: baseUrl is null (never a best-guess URL)", noId.baseUrl === null);
    check("3. Missing CLIENT_ID: clientSecret is null (never leaked through on a failed resolve)", noId.clientSecret === null);
    check("3. Missing CLIENT_ID: reason identifies the cause", noId.reason === "missing_credentials");

    const noSecret = resolveCashfreeVerificationConfig({
      CASHFREE_VERIFICATION_ENV: "SANDBOX",
      CASHFREE_VERIFICATION_CLIENT_ID: "sandbox-id-fixture",
    });
    check("3. Missing CLIENT_SECRET: configured === false", noSecret.configured === false);
    check("3. Missing CLIENT_SECRET: baseUrl is null", noSecret.baseUrl === null);
    check("3. Missing CLIENT_SECRET: clientId is null (never leaked through on a failed resolve)", noSecret.clientId === null);

    const neither = resolveCashfreeVerificationConfig({ CASHFREE_VERIFICATION_ENV: "PRODUCTION" });
    check("3. Missing both credentials: configured === false", neither.configured === false);
    check("3. Missing both credentials: baseUrl is null", neither.baseUrl === null);

    const empty = resolveCashfreeVerificationConfig({});
    check("3. Completely empty env: configured === false, does not throw", empty.configured === false);
  }

  // ── 4. Invalid environment values fail safely — NEVER defaults to
  // Sandbox or Production, regardless of whether credentials are
  // present. This is the core "fail closed" guarantee. ──
  {
    const scenarios = [
      ["undefined (never set)", undefined],
      ["empty string", ""],
      ["lowercase \"sandbox\"", "sandbox"],
      ["lowercase \"production\"", "production"],
      ["a typo, \"PRODUCTON\"", "PRODUCTON"],
      ["an unrelated value, \"STAGING\"", "STAGING"],
      ["numeric-looking string \"1\"", "1"],
    ];
    for (const [label, value] of scenarios) {
      const result = resolveCashfreeVerificationConfig({
        CASHFREE_VERIFICATION_ENV: value,
        CASHFREE_VERIFICATION_CLIENT_ID: "some-id-fixture",
        CASHFREE_VERIFICATION_CLIENT_SECRET: "some-secret-fixture",
      });
      check(`4. Invalid CASHFREE_VERIFICATION_ENV (${label}), even WITH valid credentials present: configured === false`, result.configured === false);
      check(`4. Invalid CASHFREE_VERIFICATION_ENV (${label}): baseUrl is null, never silently defaults to either real URL`, result.baseUrl === null);
      check(`4. Invalid CASHFREE_VERIFICATION_ENV (${label}): reason identifies the cause`, result.reason === "invalid_environment");
    }
  }

  // ── 5. Verification Suite configuration is isolated from Payouts
  // configuration — the resolver must be completely blind to
  // CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET / CASHFREE_ENV (the
  // variables cashfreePayoutClient.js reads), in both directions. ──
  {
    // Payouts variables present, Verification Suite variables absent
    // — must NOT be picked up as a substitute.
    const payoutOnly = resolveCashfreeVerificationConfig({
      CASHFREE_CLIENT_ID: "payout-id-should-never-be-read-here",
      CASHFREE_CLIENT_SECRET: "payout-secret-should-never-be-read-here",
      CASHFREE_ENV: "PRODUCTION",
    });
    check("5. Payouts vars alone (no CASHFREE_VERIFICATION_*): configured === false — Payouts credentials are never substituted in", payoutOnly.configured === false);
    check("5. Payouts vars alone: clientId is null, never silently reused from CASHFREE_CLIENT_ID", payoutOnly.clientId === null);

    // Both sets present with DIFFERENT values — the resolver must
    // return only the Verification Suite ones, never the Payouts ones,
    // proving there is no accidental fallback/mixing either way.
    const bothPresent = resolveCashfreeVerificationConfig({
      CASHFREE_CLIENT_ID: "payout-id-fixture",
      CASHFREE_CLIENT_SECRET: "payout-secret-fixture",
      CASHFREE_ENV: "SANDBOX",
      CASHFREE_VERIFICATION_ENV: "PRODUCTION",
      CASHFREE_VERIFICATION_CLIENT_ID: "verification-id-fixture",
      CASHFREE_VERIFICATION_CLIENT_SECRET: "verification-secret-fixture",
    });
    check("5. Both sets present, different values: clientId is the Verification Suite one, not the Payouts one", bothPresent.clientId === "verification-id-fixture");
    check("5. Both sets present, different values: clientSecret is the Verification Suite one, not the Payouts one", bothPresent.clientSecret === "verification-secret-fixture");
    check("5. Both sets present, different values: environment/baseUrl follow CASHFREE_VERIFICATION_ENV (PRODUCTION), not CASHFREE_ENV (SANDBOX)", bothPresent.environment === "PRODUCTION" && bothPresent.baseUrl === "https://api.cashfree.com/verification");
  }

  console.log(rows.join("\n"));
  console.log(`\nCASHFREE VERIFICATION CONFIG: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
