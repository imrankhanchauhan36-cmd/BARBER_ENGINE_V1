/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyTestDatabaseSafetyGuard.mjs
 *
 * Phase 5.4.3A/C — offline tests for config/testDb.js's safety guard,
 * hardened in 5.4.3C for URI-parsing correctness and confirmation
 * binding. Pure unit check: NO MongoDB connection, NO provider call,
 * NO mongoose import anywhere in this file. connectTestDB() is never
 * called. All synthetic env/URI values below are fixture placeholders
 * (example.com / localhost / RFC-reserved-style names) — never a real
 * connection string, host, credential, or any other sensitive value.
 *
 * Most assertions call assertTestDatabaseSafe(syntheticEnv) with an
 * injected, isolated env object — never mutating the real
 * process.env. Only the ensureProvidersUnconfigured() tests touch
 * real process.env, and only for three placeholder keys plus one
 * unrelated control key, fully restored in a finally block.
 *
 * Run:  cd backend && node scripts/unit/verifyTestDatabaseSafetyGuard.mjs
 */

import {
    assertTestDatabaseSafe,
    computeTestDatabaseConfirmationToken,
    ensureProvidersUnconfigured,
} from "../../config/testDb.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

// ─── Synthetic fixture URIs only — never real ────────────────────
const SINGLE_HOST_TEST_URI = "mongodb://localhost:27017/zemish_test_fixture_db";
const APP_URI = "mongodb://localhost:27017/zemish_app_fixture_db";
const ATLAS_STYLE_TEST_URI = "mongodb+srv://testuser:testpass@cluster0.example.mongodb.net/zemish_test_fixture_db?retryWrites=true&w=majority&appName=Example";
const ATLAS_STYLE_NO_CREDS_URI = "mongodb+srv://cluster0.example.mongodb.net/zemish_test_fixture_db";
const MULTI_HOST_TEST_URI = "mongodb://host1.example.com:27017,host2.example.com:27017,host3.example.com:27017/zemish_test_fixture_db?replicaSet=rs0";
const ALLOWLIST = "zemish_test_fixture_db,another_allowed_fixture_db";

const buildValidEnv = (testUri) => ({
  TEST_MONGODB_URI: testUri,
  MONGODB_URI: APP_URI,
  TEST_DATABASE_NAME_ALLOWLIST: ALLOWLIST,
  CONFIRM_TEST_DATABASE: computeTestDatabaseConfirmationToken(testUri),
  NODE_ENV: "development",
});

// Substrings that must NEVER appear in any thrown error message.
// Deliberately excludes the bare "mongodb://"/"mongodb+srv://" scheme
// prefixes — testDb.js's own error text legitimately names the
// EXPECTED generic format, which is not a leak of any specific value.
const SENSITIVE_SUBSTRINGS = [
  "zemish_test_fixture_db",
  "zemish_app_fixture_db",
  "another_allowed_fixture_db",
  "localhost",
  "27017",
  "cluster0.example.mongodb.net",
  "host1.example.com",
  "host2.example.com",
  "host3.example.com",
  "testuser",
  "testpass",
];

const assertThrowsWithoutLeaking = (label, env, expectedMessageFragment) => {
  let threw = false;
  let message = "";
  try {
    assertTestDatabaseSafe(env);
  } catch (err) {
    threw = true;
    message = err.message;
  }
  check(`${label}: throws`, threw, message);
  if (expectedMessageFragment) {
    check(`${label}: error message matches expected reason`, message.includes(expectedMessageFragment), message);
  }
  const leaked = SENSITIVE_SUBSTRINGS.some((s) => message.includes(s));
  check(`${label}: error message does not leak the URI/host/port/database name/credentials`, !leaked, message);
};

const run = () => {
  // ════════════════════════════════════════════════════════
  // PART A — valid configurations pass, across multiple real-shaped
  // (but entirely synthetic) URI forms
  // ════════════════════════════════════════════════════════
  for (const [label, uri] of [
    ["Single-host mongodb://", SINGLE_HOST_TEST_URI],
    ["Atlas-style mongodb+srv:// with credentials", ATLAS_STYLE_TEST_URI],
    ["Atlas-style mongodb+srv:// without credentials", ATLAS_STYLE_NO_CREDS_URI],
    ["Multi-host mongodb:// with replicaSet query param", MULTI_HOST_TEST_URI],
  ]) {
    let result, threw = false;
    try {
      result = assertTestDatabaseSafe(buildValidEnv(uri));
    } catch (err) {
      threw = true;
      rows.push(`   (unexpected throw for ${label}: ${err.message})`);
    }
    check(`A. ${label}: valid configuration does not throw`, threw === false);
    check(`A. ${label}: returns true`, result === true);
  }

  // ════════════════════════════════════════════════════════
  // PART B — missing / equal / malformed URI, allow-list, confirmation,
  // and production checks (base cases, using the single-host fixture)
  // ════════════════════════════════════════════════════════
  const baseValidEnv = buildValidEnv(SINGLE_HOST_TEST_URI);

  assertThrowsWithoutLeaking(
    "B. Missing TEST_MONGODB_URI",
    { ...baseValidEnv, TEST_MONGODB_URI: undefined },
    "TEST_MONGODB_URI is not set"
  );

  assertThrowsWithoutLeaking(
    "B. TEST_MONGODB_URI equal to MONGODB_URI",
    { ...baseValidEnv, MONGODB_URI: SINGLE_HOST_TEST_URI },
    "identical to MONGODB_URI"
  );

  assertThrowsWithoutLeaking(
    "B. Malformed URI (not a mongodb URI at all)",
    { ...baseValidEnv, TEST_MONGODB_URI: "not-a-valid-uri-at-all" },
    "could not be parsed"
  );
  assertThrowsWithoutLeaking(
    "B. Malformed URI (wrong scheme)",
    { ...baseValidEnv, TEST_MONGODB_URI: "postgres://localhost:5432/zemish_test_fixture_db" },
    "could not be parsed"
  );
  assertThrowsWithoutLeaking(
    "B. Malformed URI (no path segment at all)",
    { ...baseValidEnv, TEST_MONGODB_URI: "mongodb://host1.example.com,host2.example.com", CONFIRM_TEST_DATABASE: computeTestDatabaseConfirmationToken("mongodb://host1.example.com,host2.example.com") },
    "could not be parsed"
  );
  assertThrowsWithoutLeaking(
    "B. Malformed URI (empty authority)",
    { ...baseValidEnv, TEST_MONGODB_URI: "mongodb:///zemish_test_fixture_db", CONFIRM_TEST_DATABASE: computeTestDatabaseConfirmationToken("mongodb:///zemish_test_fixture_db") },
    "could not be parsed"
  );

  assertThrowsWithoutLeaking(
    "B. Missing TEST_DATABASE_NAME_ALLOWLIST",
    { ...baseValidEnv, TEST_DATABASE_NAME_ALLOWLIST: undefined },
    "TEST_DATABASE_NAME_ALLOWLIST is not set"
  );
  assertThrowsWithoutLeaking(
    "B. Non-matching TEST_DATABASE_NAME_ALLOWLIST",
    { ...baseValidEnv, TEST_DATABASE_NAME_ALLOWLIST: "some_completely_different_db" },
    "does not exactly match"
  );
  assertThrowsWithoutLeaking(
    "B. Allow-list contains only a similar-looking, non-exact name",
    { ...baseValidEnv, TEST_DATABASE_NAME_ALLOWLIST: "zemish_test_fixture_db_v2" },
    "does not exactly match"
  );

  assertThrowsWithoutLeaking(
    "B. Missing CONFIRM_TEST_DATABASE",
    { ...baseValidEnv, CONFIRM_TEST_DATABASE: undefined },
    "does not match the confirmation token"
  );
  assertThrowsWithoutLeaking(
    "B. CONFIRM_TEST_DATABASE is the old literal \"true\" (no longer accepted)",
    { ...baseValidEnv, CONFIRM_TEST_DATABASE: "true" },
    "does not match the confirmation token"
  );

  assertThrowsWithoutLeaking(
    "B. NODE_ENV is production (even with everything else valid)",
    { ...baseValidEnv, NODE_ENV: "production" },
    "NODE_ENV is \"production\""
  );

  // ════════════════════════════════════════════════════════
  // PART C — confirmation binding: a URI change invalidates a
  // previously-valid confirmation token (the core Phase 5.4.3C fix)
  // ════════════════════════════════════════════════════════
  {
    const tokenForOriginalUri = computeTestDatabaseConfirmationToken(SINGLE_HOST_TEST_URI);
    const envWithChangedUri = {
      ...baseValidEnv,
      TEST_MONGODB_URI: MULTI_HOST_TEST_URI, // the target changed...
      CONFIRM_TEST_DATABASE: tokenForOriginalUri, // ...but the confirmation is stale, for the OLD uri
    };
    let threw = false, message = "";
    try {
      assertTestDatabaseSafe(envWithChangedUri);
    } catch (err) {
      threw = true;
      message = err.message;
    }
    check("C. A confirmation token computed for the OLD URI is rejected after TEST_MONGODB_URI changes", threw && message.includes("does not match the confirmation token"), message);

    // Re-confirming with a FRESH token for the NEW uri succeeds.
    const freshEnv = { ...envWithChangedUri, CONFIRM_TEST_DATABASE: computeTestDatabaseConfirmationToken(MULTI_HOST_TEST_URI) };
    let threwAfterRefresh = false;
    try {
      assertTestDatabaseSafe(freshEnv);
    } catch {
      threwAfterRefresh = true;
    }
    check("C. A freshly-computed token for the NEW URI is accepted", threwAfterRefresh === false);
  }

  // ════════════════════════════════════════════════════════
  // PART D — ensureProvidersUnconfigured — affects only the six
  // keys (ZEMISH dual-environment pass added the three
  // CASHFREE_VERIFICATION_* keys alongside the original three),
  // restores test-process state in finally
  // ════════════════════════════════════════════════════════
  {
    const originalCashfreeId = process.env.CASHFREE_CLIENT_ID;
    const originalCashfreeSecret = process.env.CASHFREE_CLIENT_SECRET;
    const originalCashfreeVerificationEnv = process.env.CASHFREE_VERIFICATION_ENV;
    const originalCashfreeVerificationId = process.env.CASHFREE_VERIFICATION_CLIENT_ID;
    const originalCashfreeVerificationSecret = process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
    const originalSurepass = process.env.SUREPASS_TOKEN;
    const originalUnrelated = process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY;

    try {
      process.env.CASHFREE_CLIENT_ID = "placeholder-not-real";
      process.env.CASHFREE_CLIENT_SECRET = "placeholder-not-real";
      process.env.CASHFREE_VERIFICATION_ENV = "SANDBOX";
      process.env.CASHFREE_VERIFICATION_CLIENT_ID = "placeholder-not-real";
      process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = "placeholder-not-real";
      process.env.SUREPASS_TOKEN = "placeholder-not-real";
      process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY = "should-not-be-touched";

      ensureProvidersUnconfigured();

      check("D. ensureProvidersUnconfigured: CASHFREE_CLIENT_ID removed", process.env.CASHFREE_CLIENT_ID === undefined);
      check("D. ensureProvidersUnconfigured: CASHFREE_CLIENT_SECRET removed", process.env.CASHFREE_CLIENT_SECRET === undefined);
      check("D. ensureProvidersUnconfigured: CASHFREE_VERIFICATION_ENV removed", process.env.CASHFREE_VERIFICATION_ENV === undefined);
      check("D. ensureProvidersUnconfigured: CASHFREE_VERIFICATION_CLIENT_ID removed", process.env.CASHFREE_VERIFICATION_CLIENT_ID === undefined);
      check("D. ensureProvidersUnconfigured: CASHFREE_VERIFICATION_CLIENT_SECRET removed", process.env.CASHFREE_VERIFICATION_CLIENT_SECRET === undefined);
      check("D. ensureProvidersUnconfigured: SUREPASS_TOKEN removed", process.env.SUREPASS_TOKEN === undefined);
      check("D. ensureProvidersUnconfigured: an unrelated key is left untouched", process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY === "should-not-be-touched");
    } finally {
      if (originalCashfreeId !== undefined) process.env.CASHFREE_CLIENT_ID = originalCashfreeId; else delete process.env.CASHFREE_CLIENT_ID;
      if (originalCashfreeSecret !== undefined) process.env.CASHFREE_CLIENT_SECRET = originalCashfreeSecret; else delete process.env.CASHFREE_CLIENT_SECRET;
      if (originalCashfreeVerificationEnv !== undefined) process.env.CASHFREE_VERIFICATION_ENV = originalCashfreeVerificationEnv; else delete process.env.CASHFREE_VERIFICATION_ENV;
      if (originalCashfreeVerificationId !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_ID = originalCashfreeVerificationId; else delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
      if (originalCashfreeVerificationSecret !== undefined) process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = originalCashfreeVerificationSecret; else delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
      if (originalSurepass !== undefined) process.env.SUREPASS_TOKEN = originalSurepass; else delete process.env.SUREPASS_TOKEN;
      if (originalUnrelated !== undefined) process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY = originalUnrelated; else delete process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY;
    }

    check("D. Test-process environment fully restored after ensureProvidersUnconfigured test", [
      process.env.CASHFREE_CLIENT_ID === originalCashfreeId || (originalCashfreeId === undefined && process.env.CASHFREE_CLIENT_ID === undefined),
      process.env.CASHFREE_CLIENT_SECRET === originalCashfreeSecret || (originalCashfreeSecret === undefined && process.env.CASHFREE_CLIENT_SECRET === undefined),
      process.env.CASHFREE_VERIFICATION_ENV === originalCashfreeVerificationEnv || (originalCashfreeVerificationEnv === undefined && process.env.CASHFREE_VERIFICATION_ENV === undefined),
      process.env.CASHFREE_VERIFICATION_CLIENT_ID === originalCashfreeVerificationId || (originalCashfreeVerificationId === undefined && process.env.CASHFREE_VERIFICATION_CLIENT_ID === undefined),
      process.env.CASHFREE_VERIFICATION_CLIENT_SECRET === originalCashfreeVerificationSecret || (originalCashfreeVerificationSecret === undefined && process.env.CASHFREE_VERIFICATION_CLIENT_SECRET === undefined),
      process.env.SUREPASS_TOKEN === originalSurepass || (originalSurepass === undefined && process.env.SUREPASS_TOKEN === undefined),
      process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY === originalUnrelated || (originalUnrelated === undefined && process.env.ZEMISH_UNIT_TEST_UNRELATED_KEY === undefined),
    ].every(Boolean));
  }

  console.log(rows.join("\n"));
  console.log(`\nTEST DATABASE SAFETY GUARD: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
