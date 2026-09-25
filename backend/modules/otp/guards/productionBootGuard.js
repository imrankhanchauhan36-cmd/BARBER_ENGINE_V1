/**
 * BARBER ENGINE V1
 * backend/modules/otp/guards/productionBootGuard.js
 *
 * OTP-1 REVISION 4 — boot-time (not runtime/route-level) refusal to
 * start with an unsafe OTP configuration in production.
 *
 * This codebase already has an equivalent guard in server.js (checked
 * before connectDB()/app.listen()), unmodified and untouched by this
 * phase. This file is a SECOND, independent, OTP-module-owned copy of
 * the same fail-closed property, added because this phase's own scope
 * is explicitly restricted to "the OTP module only" — server.js cannot
 * be edited to add a defense-in-depth check there, so the OTP module
 * enforces its own safety unconditionally, without relying on
 * server.js's cooperation.
 *
 * MECHANISM — this file's check runs at IMPORT TIME (module
 * evaluation), not inside any request handler or route. Every OTP
 * controller imports otp.service.js, which imports this file, which
 * therefore runs this check the moment the process's import graph is
 * evaluated — before app.listen() is ever reached, since ES module
 * imports are fully resolved before any of app.js's/server.js's own
 * top-level code runs. This is boot validation, not a runtime route
 * check, exactly as required.
 *
 * WHY process.exit(1), NOT throw — verified empirically against this
 * exact codebase, not assumed: utils/logger.js configures Winston with
 * `exitOnError: false` plus global exceptionHandlers/rejectionHandlers
 * — meaning an uncaught throw ANYWHERE in this application is
 * intercepted, logged, and the process is deliberately kept alive
 * (confirmed by spawning `node server.js` under the unsafe combo and
 * observing it stay up well past both a throw-based guard's crash
 * point). server.js's OWN pre-existing guard already anticipates this
 * — it calls `process.exit(1)` directly rather than throwing, for
 * exactly this reason. This guard does the same, so it actually
 * terminates the process instead of silently logging and continuing.
 *
 * The check itself is byte-identical in intent to server.js's own:
 * refuse if NODE_ENV is literally "production" AND ALLOW_FIXED_OTP is
 * literally "true". Development keeps fixed-OTP support unaffected —
 * this only ever exits for that one specific combination.
 */

export const assertProductionOtpSafety = () => {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_FIXED_OTP === "true") {
    // eslint-disable-next-line no-console
    console.error(
      "❌ FATAL OTP CONFIGURATION ERROR — refusing to start.\n" +
      "   NODE_ENV=production while ALLOW_FIXED_OTP=true.\n" +
      "   The fixed-OTP development bypass (modules/otp/services/otp.service.js) must never be enabled in production.\n" +
      "   Unset ALLOW_FIXED_OTP (or set it to \"false\") and restart.\n" +
      "   (This is the OTP module's own boot guard — see server.js for the platform's equivalent, independent check.)"
    );
    process.exit(1);
  }
};

// Runs once, at import time — see this file's own header for why this
// achieves "boot validation only, prevent Express from starting"
// without any change to server.js.
assertProductionOtpSafety();
