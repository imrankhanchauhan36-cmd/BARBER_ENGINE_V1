/**
 * BARBER ENGINE V1
 * backend/config/testDb.js
 * Dedicated Test Database Safety Guard — Phase 5.4.3A (additive, 2026-10-10)
 *
 * NOT YET USED BY ANYTHING. No existing file imports this module. It
 * exists so a FUTURE, separately-authorized test script can connect to
 * a genuinely separate database without silently reusing MONGODB_URI
 * (config/db.js's own target, used by the real application and every
 * existing e2e script). This file does not change config/db.js, does
 * not change any existing script, and is not called by anything yet.
 *
 * DESIGN, per the approved Phase 5.4.3 proposal (hardened 2026-10-10,
 * Phase 5.4.3C — see the two dated notes below for exactly what changed):
 *
 *   assertTestDatabaseSafe(env) — synchronous, pure, zero I/O, does
 *   NOT import mongoose. Fails closed unless ALL five conditions hold:
 *     1. TEST_MONGODB_URI is explicitly provided (never derived from
 *        MONGODB_URI).
 *     2. TEST_MONGODB_URI !== MONGODB_URI (catches the mistake of
 *        pointing both at the same target).
 *     3. The database name parsed from TEST_MONGODB_URI exactly
 *        matches one entry in TEST_DATABASE_NAME_ALLOWLIST (comma-
 *        separated). A name merely containing "test" or "dev" is
 *        NEVER treated as sufficient — only an exact match against an
 *        explicit, human-maintained list counts.
 *     4. CONFIRM_TEST_DATABASE equals the exact confirmation token
 *        this file derives from the CURRENTLY configured
 *        TEST_MONGODB_URI (see the 2026-10-10 hardening note below) —
 *        a separate, deliberate human confirmation signal, independent
 *        of 1-3, specifically so accidentally satisfying 1-3 (e.g.
 *        copying a template .env) still cannot pass this gate alone.
 *     5. NODE_ENV !== "production" — reuses this codebase's own
 *        existing precedent (see scripts/seedSupportTestUsers.js's
 *        identical refusal), as one more defense-in-depth layer, not
 *        the proof.
 *
 *   None of these conditions, individually or together, PROVE the
 *   target database is actually safe/disposable — see this file's own
 *   header reasoning in the approved design report: a name match is a
 *   cheap, necessary, syntactic check, never a sufficient guarantee.
 *   Condition 4 exists precisely because the code cannot verify real
 *   safety, only that a human has explicitly claimed to have done so —
 *   and even that claim is now bound to a specific URI value (below),
 *   not just a free-floating "true."
 *
 *   2026-10-10 HARDENING NOTE 1 — URI PARSING CORRECTNESS. The Phase
 *   5.4.3B provisioning-plan review ran a safe, offline, synthetic-only
 *   check and found that the original WHATWG-URL-based parser WRONGLY
 *   REJECTED a valid, standard mongodb:// URI with multiple
 *   comma-separated hosts (e.g. "mongodb://host1,host2,host3/db") —
 *   Node's URL implementation does not accept a comma inside the
 *   authority segment and throws, even though that is a completely
 *   valid MongoDB connection-string shape. parseDatabaseName() below
 *   was rewritten to a single, manual, scheme-and-slash-based
 *   extraction that never depends on WHATWG URL's authority validation
 *   at all — it only needs to find the first "/" after the scheme to
 *   separate "authority" from "path?query", which is well-defined for
 *   both mongodb:// and mongodb+srv:// regardless of how many hosts
 *   the authority contains. Re-verified against synthetic Atlas-style
 *   (mongodb+srv://), multi-host (mongodb://h1,h2,h3/db?replicaSet=rs0),
 *   and single-host forms — see the offline test suite.
 *
 *   2026-10-10 HARDENING NOTE 2 — CONFIRMATION BINDING. The Phase
 *   5.4.3B review also identified that a static CONFIRM_TEST_DATABASE
 *   ="true" has no binding to the URI it was meant to vouch for: if
 *   TEST_MONGODB_URI is later repointed to a different target, the
 *   stale "true" value would still satisfy the guard without anyone
 *   having re-confirmed the NEW target. Condition 4 now requires
 *   CONFIRM_TEST_DATABASE to equal computeTestDatabaseConfirmationToken
 *   (TEST_MONGODB_URI) — a SHA-256 hex digest of the exact, current URI
 *   string. Changing the URI changes the expected token, so a stale
 *   confirmation value is automatically invalidated the moment the URI
 *   changes, with no extra bookkeeping. The hash is one-way: storing it
 *   in an env var does not store or expose the URI/credentials it was
 *   computed from — it is safe to keep in .env precisely because it
 *   cannot be reversed back into the original string.
 *
 *   WHAT THIS BINDING PROVES, AND WHAT IT DOES NOT: it proves the
 *   currently-configured TEST_MONGODB_URI is byte-for-byte the same
 *   value that was present when a human last computed and set the
 *   confirmation token — i.e. "this specific URI has been deliberately
 *   acknowledged, and has not silently drifted since." It does NOT
 *   prove the human who computed that token actually verified anything
 *   real about the target (separate cluster/project, least-privilege
 *   credentials, absence of real data) — a human could compute a valid
 *   token for an entirely unverified URI. Closing that gap remains
 *   exactly what Phase 5.4.3B's human verification checklist is for;
 *   this mechanism only prevents the narrower, specific failure mode of
 *   a stale confirmation surviving an unnoticed URI change.
 *
 *   REQUIRED FUTURE .env CONFIGURATION (not set by this change — this
 *   phase does not touch .env): whenever a real TEST_MONGODB_URI is
 *   eventually provisioned, CONFIRM_TEST_DATABASE in .env must be set
 *   to the output of computeTestDatabaseConfirmationToken(thatRealUri)
 *   — a human-run, one-time, local computation — never the literal
 *   string "true" anymore.
 *
 *   connectTestDB() — calls assertTestDatabaseSafe() FIRST, before
 *   mongoose is even imported (a dynamic import inside this function,
 *   not a static top-level one), so merely importing this whole module
 *   never pulls in mongoose, and the safety ordering can be confirmed
 *   by static inspection alone: nothing below the assert call can run
 *   unless the assert call returns without throwing. Uses ONLY
 *   TEST_MONGODB_URI — never falls back to MONGODB_URI under any
 *   condition.
 *
 *   ensureProvidersUnconfigured() — deletes exactly six keys
 *   (CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET — Payouts;
 *   CASHFREE_VERIFICATION_ENV, CASHFREE_VERIFICATION_CLIENT_ID,
 *   CASHFREE_VERIFICATION_CLIENT_SECRET — Verification Suite;
 *   SUREPASS_TOKEN) from the current Node process's in-memory
 *   environment only. Never touches .env on disk, never reads or
 *   prints any value, never calls a provider.
 *
 * NEVER print the URI, host, credentials, or parsed database name —
 * every error message below is a static, descriptive string with no
 * interpolated secret/connection data of any kind.
 */

import crypto from "crypto";

const SUPPORTED_SCHEME_PATTERN = /^mongodb(\+srv)?:\/\//i;

/**
 * Parses only the database-name path segment out of a MongoDB
 * connection string, without ever retaining or exposing the rest of
 * the URI. Returns null for anything that cannot be confidently
 * parsed — callers must treat null as "unresolvable," which fails the
 * allow-list check closed, never open.
 *
 * Deliberately does NOT use the WHATWG URL parser (see this file's
 * 2026-10-10 hardening note): Node's URL implementation rejects a
 * comma inside the authority segment, which is exactly what a valid,
 * standard multi-host mongodb:// replica-set string looks like
 * ("mongodb://h1,h2,h3/db"), and would incorrectly treat it as
 * malformed. Instead, this performs a single, well-defined manual
 * split: find the first "/" after the scheme prefix — everything
 * before it is the authority (one or more hosts, optional
 * credentials), everything from that "/" onward is "path?query". This
 * is correct for both mongodb:// and mongodb+srv:// regardless of how
 * many hosts the authority contains, since neither scheme ever permits
 * a literal, unescaped "/" inside the authority itself.
 *
 * @param {string} uri
 * @returns {string|null}
 */
const parseDatabaseName = (uri) => {
  if (typeof uri !== "string") return null;

  const schemeMatch = uri.match(SUPPORTED_SCHEME_PATTERN);
  if (!schemeMatch) return null;

  const afterScheme = uri.slice(schemeMatch[0].length);
  if (afterScheme.length === 0) return null; // scheme with nothing after it at all

  const slashIndex = afterScheme.indexOf("/");
  if (slashIndex === -1) return null; // no path segment at all — no database name given

  const authority = afterScheme.slice(0, slashIndex);
  if (authority.trim().length === 0) return null; // e.g. "mongodb:///db" — no host at all

  const pathAndQuery = afterScheme.slice(slashIndex + 1); // "db?query..." — no leading slash
  const databaseName = pathAndQuery.split("?")[0].split("#")[0].trim();
  return databaseName.length > 0 ? databaseName : null;
};

/**
 * Computes the one-way confirmation token a human must set as
 * CONFIRM_TEST_DATABASE for a given TEST_MONGODB_URI value. A SHA-256
 * hex digest cannot be reversed back into the original URI/credentials
 * — storing this token (e.g. in .env) never exposes the string it was
 * derived from. Exported so a human (or a future setup script) can run
 * this themselves, locally, against their own real URI, without ever
 * sharing that URI with anyone else to get the expected value.
 *
 * @param {string} uri
 * @returns {string} a 64-character lowercase hex SHA-256 digest
 * @throws {TypeError} if `uri` is not a non-empty string
 */
export const computeTestDatabaseConfirmationToken = (uri) => {
  if (typeof uri !== "string" || uri.length === 0) {
    throw new TypeError("computeTestDatabaseConfirmationToken: uri must be a non-empty string");
  }
  return crypto.createHash("sha256").update(uri, "utf8").digest("hex");
};

/**
 * @param {Record<string, string|undefined>} [env] - defaults to
 *   process.env, but accepts an injected object so this function can
 *   be exercised entirely offline, with synthetic values, by tests.
 * @returns {true} only if every condition passes.
 * @throws {Error} a static, non-interpolated message — never the
 *   actual URI, host, credentials, or database name — identifying
 *   exactly which condition failed.
 */
export const assertTestDatabaseSafe = (env = process.env) => {
  const testUri = env.TEST_MONGODB_URI;
  const appUri = env.MONGODB_URI;

  // 1 — explicitly provided, never derived/defaulted.
  if (typeof testUri !== "string" || testUri.trim().length === 0) {
    throw new Error(
      "assertTestDatabaseSafe: TEST_MONGODB_URI is not set. Refusing to proceed — " +
      "a dedicated test database must be explicitly configured; there is no fallback."
    );
  }

  // 2 — must differ from the real application URI.
  if (typeof appUri === "string" && testUri === appUri) {
    throw new Error(
      "assertTestDatabaseSafe: TEST_MONGODB_URI is identical to MONGODB_URI. Refusing to proceed — " +
      "the test database must be a genuinely separate target, not the application's own database."
    );
  }

  // 3 — parse, then exact-match against an explicit allow-list.
  const databaseName = parseDatabaseName(testUri);
  if (databaseName === null) {
    throw new Error(
      "assertTestDatabaseSafe: TEST_MONGODB_URI could not be parsed as a supported MongoDB " +
      "connection string (expected a mongodb:// or mongodb+srv:// URI with a database path segment). " +
      "Refusing to proceed on an unparseable or unsupported URI format."
    );
  }
  const allowList = typeof env.TEST_DATABASE_NAME_ALLOWLIST === "string"
    ? env.TEST_DATABASE_NAME_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (allowList.length === 0) {
    throw new Error(
      "assertTestDatabaseSafe: TEST_DATABASE_NAME_ALLOWLIST is not set or empty. Refusing to proceed — " +
      "the parsed database name must exactly match an explicit, human-maintained allow-list entry; " +
      "a name merely containing \"test\" or \"dev\" is never treated as sufficient on its own."
    );
  }
  if (!allowList.includes(databaseName)) {
    throw new Error(
      "assertTestDatabaseSafe: the database name parsed from TEST_MONGODB_URI does not exactly match " +
      "any entry in TEST_DATABASE_NAME_ALLOWLIST. Refusing to proceed."
    );
  }

  // 4 — a separate, deliberate human confirmation, independent of 1-3,
  // now bound to the EXACT current TEST_MONGODB_URI value (2026-10-10
  // hardening — see file header). A confirmation computed for a
  // DIFFERENT URI value will never match here, so a stale confirmation
  // cannot silently survive a URI change.
  const expectedToken = computeTestDatabaseConfirmationToken(testUri);
  if (env.CONFIRM_TEST_DATABASE !== expectedToken) {
    throw new Error(
      "assertTestDatabaseSafe: CONFIRM_TEST_DATABASE does not match the confirmation token derived " +
      "from the currently configured TEST_MONGODB_URI. Refusing to proceed — this is a deliberate, " +
      "separate human confirmation step bound to the exact URI value; satisfying the URI/allow-list " +
      "checks alone is never sufficient, and a confirmation computed for a previous or different URI " +
      "does not carry over."
    );
  }

  // 5 — defense-in-depth backstop, reusing this codebase's own existing precedent.
  if (env.NODE_ENV === "production") {
    throw new Error(
      "assertTestDatabaseSafe: NODE_ENV is \"production\". Refusing to proceed under any circumstances, " +
      "regardless of any other configured value."
    );
  }

  return true;
};

/**
 * Connects to TEST_MONGODB_URI only, after assertTestDatabaseSafe()
 * has returned without throwing. mongoose is imported dynamically,
 * INSIDE this function, after the assert call — so merely importing
 * this module (or calling assertTestDatabaseSafe directly) never
 * loads mongoose at all, and the ordering below is reviewable by
 * static inspection alone: nothing here can run before the guard does.
 *
 * NOT called anywhere in this phase — no connection is established by
 * adding this file.
 *
 * @returns {Promise<import("mongoose")>}
 */
export const connectTestDB = async () => {
  assertTestDatabaseSafe();

  const { default: mongoose } = await import("mongoose");
  await mongoose.connect(process.env.TEST_MONGODB_URI, { autoIndex: true });
  return mongoose;
};

/**
 * Removes exactly these six keys from the current Node process's
 * own in-memory environment. Never touches .env on disk (no file I/O
 * of any kind occurs here), never reads or logs any value, never
 * calls a provider. Intended for a test process that wants to
 * deterministically exercise a Manual-fallback code path without any
 * network call, mirroring the technique already proven safe elsewhere
 * in this codebase's own test scripts.
 *
 * ZEMISH dual-environment pass — also strips the Verification Suite's
 * own, isolated CASHFREE_VERIFICATION_* keys, so a test run can never
 * accidentally make a live Verification Suite call just because real
 * Production credentials happen to be set in the environment it runs
 * in, exactly the same guarantee this already gave Payouts.
 */
export const ensureProvidersUnconfigured = () => {
  delete process.env.CASHFREE_CLIENT_ID;
  delete process.env.CASHFREE_CLIENT_SECRET;
  delete process.env.CASHFREE_VERIFICATION_ENV;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
  delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  delete process.env.SUREPASS_TOKEN;
};
