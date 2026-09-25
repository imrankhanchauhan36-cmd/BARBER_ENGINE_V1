/**
 * BARBER ENGINE V1
 * backend/modules/otp/guards/msg91EnvGuard.js
 *
 * OTP-2 PART A — fail-fast boot check: if SMS_PROVIDER=msg91 is
 * selected, every credential MSG91Provider needs to actually place a
 * real call (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_SENDER_ID) must
 * be present. Missing any of them today would only surface as a
 * per-request "SMS_PROVIDER_NOT_CONFIGURED" failure the first time
 * someone tries to log in — this guard catches it at boot instead, so
 * a misconfigured production deploy never goes live silently.
 *
 * Mirrors guards/productionBootGuard.js's own established shape:
 * runs at import time (module evaluation, before app.listen()), and
 * calls process.exit(1) directly rather than throwing — verified in
 * OTP-1's own revision phase that this codebase's Winston logger
 * (utils/logger.js, exitOnError:false + global exceptionHandlers)
 * swallows a bare throw and keeps the process alive, so a real
 * process.exit(1) is required to actually terminate boot.
 *
 * Only ever enforces when SMS_PROVIDER is literally "msg91" — every
 * other provider selection ("none", "twilio", "aws_sns", or an unset
 * SMS_PROVIDER) is completely unaffected by this file.
 */

const REQUIRED_MSG91_ENV_VARS = ["MSG91_AUTH_KEY", "MSG91_TEMPLATE_ID", "MSG91_SENDER_ID"];

export const assertMsg91EnvConfigured = () => {
  if (process.env.SMS_PROVIDER !== "msg91") return;

  const missing = REQUIRED_MSG91_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      "❌ FATAL MSG91 CONFIGURATION ERROR — refusing to start.\n" +
      `   SMS_PROVIDER=msg91 but the following required env var(s) are missing or empty: ${missing.join(", ")}.\n` +
      "   Set every one of MSG91_AUTH_KEY / MSG91_TEMPLATE_ID / MSG91_SENDER_ID, or change SMS_PROVIDER to a different value, and restart.\n" +
      "   (This is the OTP module's own MSG91 boot guard — modules/otp/guards/msg91EnvGuard.js.)"
    );
    process.exit(1);
  }
};

// Runs once, at import time — see this file's own header.
assertMsg91EnvConfigured();
