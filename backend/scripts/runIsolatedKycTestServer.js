/**
 * BARBER ENGINE V1
 * backend/scripts/runIsolatedKycTestServer.js
 *
 * ZEMISH isolated Cashfree Sandbox test server (2026-10-11) — lets a
 * developer later exercise one real KYC endpoint (e.g. PAN
 * verification) against a genuinely separate test database, WITHOUT
 * starting the normal backend (server.js) or any of its ~15
 * background jobs, Socket.IO, or graceful-shutdown machinery — none
 * of that is imported here, at all.
 *
 * NOT RUN BY THIS CHANGE. Creating/editing this file connects to
 * nothing, starts nothing, and calls nothing — it only exists on disk
 * until a human deliberately runs it:
 *   cd backend && node scripts/runIsolatedKycTestServer.js
 *
 * `run` is exported, and its own auto-invocation at the bottom of this
 * file is guarded behind a direct-entry check (process.argv[1] via
 * pathToFileURL(), compared against import.meta.url) — so merely
 * IMPORTING this file (e.g. from runIsolatedKycTestServerBootstrap.js,
 * or any static-review tool) never triggers it; only running it
 * directly does, exactly as before this guard existed.
 *
 * ─── Startup order ───────────────────────────────────────────────────
 *   1. Load env (dotenv/config) — same as every other entry point.
 *      Nothing read from it is ever printed.
 *   2. Call the EXISTING, UNMODIFIED connectTestDB() from
 *      config/testDb.js. That function calls assertTestDatabaseSafe()
 *      FIRST, before it even imports mongoose — so the safety
 *      assertion is guaranteed to run, and to pass, before any
 *      database connection is opened. This script adds no bypass, no
 *      second confirmation path, and no weakening of any of
 *      testDb.js's five fail-closed conditions (see that file's own
 *      header): TEST_MONGODB_URI must be explicit and different from
 *      MONGODB_URI, its database name must exact-match
 *      TEST_DATABASE_NAME_ALLOWLIST, CONFIRM_TEST_DATABASE must equal
 *      the SHA-256 token bound to that exact URI, and NODE_ENV must
 *      not be "production". If any condition fails, connectTestDB()
 *      throws and this script exits non-zero before anything else
 *      happens — no database connection, no server, nothing.
 *   3. ONLY after that connection succeeds: set
 *      process.env.SKIP_REDIS_AUTOCONNECT = "true" — IN THIS PROCESS'S
 *      OWN MEMORY ONLY. Never written to .env, never set globally,
 *      never touches any EAS/Render configuration — it affects
 *      nothing outside this one running script process. This is what
 *      config/redis.js's own opt-out guard (a separate, already-
 *      reviewed change) checks for.
 *   4. Dynamically import app.js — only now, after both step 2 and
 *      step 3 have completed. Because the Redis flag is already set
 *      by the time app.js's module body (and therefore
 *      config/redis.js's module body) is evaluated, the existing
 *      eager `redis.connect()` call is skipped for this process, exactly
 *      as that change intends. app.js is never imported before this
 *      point, and server.js is never imported at all, anywhere in
 *      this file — so none of its ~15 background jobs or Socket.IO
 *      ever load.
 *   5. Create a plain http.createServer(app) and listen on port 6061
 *      — distinct from the real dev server's 6060, so both can run
 *      side by side without colliding.
 *   6. Log a clear "ISOLATED TEST MODE" startup banner. No credential
 *      or connection-string value is ever read for logging, and
 *      nothing here interpolates one.
 *
 * ─── Why every DB operation the PAN endpoint triggers uses the TEST
 * database, not MONGODB_URI ────────────────────────────────────────
 * Confirmed by inspection, not assumed: config/db.js (the real
 * MONGODB_URI connector) is imported ONLY by server.js — nowhere in
 * app.js's entire import graph (every route, controller, service,
 * middleware file it pulls in) does anything call connectDB() or
 * mongoose.connect() a second time (grepped for both call forms
 * across app.js/routes//controllers//modules//middlewares/ and found
 * zero real calls — the one hit was a code comment, not a call).
 * Mongoose keeps exactly one default connection per process; every
 * model in this codebase (KYC, User, Session, etc.) is defined via
 * that same default connection. Since step 2 above establishes that
 * default connection to TEST_MONGODB_URI before app.js is ever
 * imported in step 4, every model query any route handler issues
 * afterward — including verifyOwnerPANHandler's own getOrCreateKYC/
 * User lookups — transparently operates against the test database.
 * Nothing in app.js's routes/controllers was read, inspected only.
 *
 * ─── Authentication note (inspected, nothing seeded by this change) ──
 * middlewares/auth.middleware.js's `protect` verifies a JWT (signed
 * with JWT_ACCESS_SECRET/JWT_SECRET — unrelated to which database is
 * connected) and then looks up the decoded user id via the User model
 * — i.e. through the same default connection, so it will resolve
 * against whatever disposable test owner document a LATER, separately
 * authorized step inserts into the test database. This script creates
 * or seeds no such record itself — it only connects.
 *
 * ─── What this script does NOT do ───────────────────────────────────
 * Never imports server.js (so no jobs, no Socket.IO, no shutdown
 * handlers ever load). Never imports app.js before the test DB
 * connection succeeds. Makes no Cashfree/provider call of any kind.
 * Writes no database data — connectTestDB() only opens a connection;
 * nothing in this file issues a single read or write, and it creates
 * no user/KYC record. Never prints, logs, or otherwise exposes
 * TEST_MONGODB_URI, MONGODB_URI, JWT secrets, or any other credential/
 * connection-string value — only the static, non-interpolated
 * messages below.
 */

import "dotenv/config";
import http from "http";
import { pathToFileURL } from "url";
import { connectTestDB } from "../config/testDb.js";

const TEST_SERVER_PORT = 6061;

export const run = async () => {
  console.log("── ZEMISH isolated KYC test server ──");
  console.log("Step 1/3: Verifying test database safety and connecting (config/testDb.js, unmodified)...");

  let mongooseInstance;
  try {
    mongooseInstance = await connectTestDB();
  } catch (err) {
    // err.message is always one of testDb.js's own static, non-
    // interpolated strings — never a URI, host, or credential value.
    console.error(`❌ Refusing to proceed: ${err.message}`);
    process.exit(1);
    return;
  }

  console.log("✅ Connected to the isolated test database (safety assertion passed — see config/testDb.js).");

  console.log("Step 2/3: Disabling Redis auto-connect for THIS process only, then loading the app...");
  // In-memory only — this line never touches .env, never sets the
  // flag for any other process, and config/redis.js's own existing
  // eager-connect behavior is completely unaffected for the real
  // dev server or production, which never set this.
  process.env.SKIP_REDIS_AUTOCONNECT = "true";

  // Dynamic, and deliberately placed AFTER both the test-DB connect
  // above and the flag above — app.js (and therefore config/redis.js)
  // is not evaluated until this line.
  const { default: app } = await import("../app.js");

  console.log("Step 3/3: Starting the HTTP server (no server.js, no background jobs, no Socket.IO)...");

  const httpServer = http.createServer(app);
  httpServer.listen(TEST_SERVER_PORT, () => {
    console.log("");
    console.log("────────────────────────────────────────────────");
    console.log("🧪 ISOLATED TEST MODE");
    console.log(`🚀 Listening on http://localhost:${TEST_SERVER_PORT}`);
    console.log("🗄️  Database:  isolated TEST_MONGODB_URI (never MONGODB_URI)");
    console.log("🧠 Redis:     auto-connect skipped for this process");
    console.log("⚙️  Jobs:      none started (server.js was never imported)");
    console.log("────────────────────────────────────────────────");
  });

  // Idempotency guard — a second SIGINT/SIGTERM while shutdown is
  // already in progress must not start a second httpServer.close()/
  // mongoose.close() sequence or schedule a second force-timer.
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n⚠️  ${signal} received — closing isolated test server...`);

    // Bounded fallback — same 15s policy as server.js's own shutdown
    // (see that file's own "Force-kill if graceful shutdown hangs"
    // comment). .unref() so the timer alone can never keep this
    // process alive. This can only ever call process.exit() on THIS
    // script's own process — it has no handle to, and cannot stop or
    // modify, either mongod OS process (the existing instance on
    // 27017 or the dedicated isolated one on 27018); process.exit()
    // is process-local by definition.
    const forceShutdownTimer = setTimeout(() => {
      console.error("❌ Shutdown timed out after 15s — forcing exit");
      process.exit(1);
    }, 15_000).unref();

    httpServer.close(async () => {
      try {
        await mongooseInstance.connection.close();
        console.log("✅ Test database connection closed. Exiting.");
      } finally {
        // Graceful path completed — the force fallback above is no
        // longer needed.
        clearTimeout(forceShutdownTimer);
        process.exit(0);
      }
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

// Direct-entry guard — only self-invoke when THIS file is the one Node
// was actually asked to run (`node scripts/runIsolatedKycTestServer.js`),
// never when it's merely imported as a module (e.g. by
// runIsolatedKycTestServerBootstrap.js, a static-review tool, or a
// future test). pathToFileURL() (not manual `file://${...}` string
// concatenation) correctly handles spaces/special characters/platform
// path separators in process.argv[1], so this comparison is robust
// regardless of where the repo happens to be checked out.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
