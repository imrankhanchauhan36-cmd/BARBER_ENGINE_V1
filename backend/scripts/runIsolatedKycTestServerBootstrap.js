/**
 * BARBER ENGINE V1
 * backend/scripts/runIsolatedKycTestServerBootstrap.js
 *
 * ZEMISH isolated Cashfree Sandbox test server (2026-10-11) — supplies
 * the three config/testDb.js variables (TEST_MONGODB_URI,
 * TEST_DATABASE_NAME_ALLOWLIST, CONFIRM_TEST_DATABASE) IN MEMORY, for
 * this one process only, then launches runIsolatedKycTestServer.js's
 * own unmodified run() explicitly.
 *
 * NOT RUN BY THIS CHANGE. Creating this file connects to nothing,
 * starts nothing, and calls nothing — it only exists on disk until a
 * human deliberately runs it:
 *   cd backend && node scripts/runIsolatedKycTestServerBootstrap.js
 *
 * WHY A SEPARATE FILE, NOT INLINE ENV VARS ON THE COMMAND LINE — the
 * confirmation token (CONFIRM_TEST_DATABASE) must never be typed as a
 * literal shell argument (it would land in shell history) and never
 * printed to a terminal. Defining TEST_URI once, here, and deriving
 * both TEST_MONGODB_URI and the token from that SAME constant in this
 * same process means they can never disagree — the exact property
 * assertTestDatabaseSafe()'s own confirmation-binding check
 * (config/testDb.js) exists to enforce, now satisfied by construction
 * rather than by a human copying a value correctly.
 *
 * TEST_URI is fixed to the dedicated, already-verified local replica
 * set (127.0.0.1:27018, "rs-zemish-kyc-test") and a dedicated database
 * name ("zemish_kyc_isolated_test") — never Atlas, never the existing
 * local MongoDB instance on 27017, never any other database.
 *
 * Startup order:
 *   1. Define TEST_URI once (a plain local constant, not a secret —
 *      it's a loopback address and a database/replica-set name, no
 *      credential of any kind).
 *   2. Set process.env.TEST_MONGODB_URI / TEST_DATABASE_NAME_ALLOWLIST
 *      from it, and process.env.CONFIRM_TEST_DATABASE from
 *      computeTestDatabaseConfirmationToken(TEST_URI) — the EXISTING,
 *      unmodified helper. All three assignments are in-memory only,
 *      for this process alone; nothing here ever touches .env, a
 *      shell startup file, or any other process's environment.
 *   3. Import { run } from ./runIsolatedKycTestServer.js — this alone
 *      does NOT start anything (that file's own direct-entry guard
 *      means importing it never auto-invokes run()).
 *   4. Explicitly call `await run()` — only now does
 *      assertTestDatabaseSafe() run (inside connectTestDB(), inside
 *      run()), reading exactly the three values this file just set,
 *      exactly as it would for any other caller. No bypass, no new
 *      code path, no weakening of any of its five conditions.
 *
 * Never prints or persists the token or the URI. MONGODB_URI and every
 * other existing/production variable are never read or touched here.
 */

import { computeTestDatabaseConfirmationToken } from "../config/testDb.js";
import { run } from "./runIsolatedKycTestServer.js";

// Single source of truth, defined once — TEST_MONGODB_URI and the
// confirmation token below are both derived from this exact same
// constant, so they can never drift apart. Not a secret: a loopback
// address plus a database/replica-set name, no credential of any kind.
const TEST_URI = "mongodb://127.0.0.1:27018/zemish_kyc_isolated_test?replicaSet=rs-zemish-kyc-test";

process.env.TEST_MONGODB_URI = TEST_URI;
process.env.TEST_DATABASE_NAME_ALLOWLIST = "zemish_kyc_isolated_test";
process.env.CONFIRM_TEST_DATABASE = computeTestDatabaseConfirmationToken(TEST_URI);
// ^ In-memory only. Never logged, never written to any file, never
// passed as a command-line argument — so it cannot land in shell
// history either.

await run();
