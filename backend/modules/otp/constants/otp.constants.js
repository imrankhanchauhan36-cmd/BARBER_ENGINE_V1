/**
 * BARBER ENGINE V1
 * backend/modules/otp/constants/otp.constants.js
 *
 * Tunables and enums for the centralized OTP engine.
 */

export const OTP_LENGTH = 6;

// Hash TTL and attempt-window are the same 300s used since before
// OTP-1 — unchanged behavior, just relocated.
export const OTP_HASH_TTL_SECONDS = 300;
export const OTP_ATTEMPT_LIMIT = 5;
export const OTP_ATTEMPT_WINDOW_SECONDS = 300;

// OTP-1.1 Correction 1 — TTL of the send-otp idempotency lock
// (otp_lock:{role}:{purpose}:{phone} — see otp.service.js's own
// assertIdempotencyLock). A phone+purpose-scoped floor between two
// sends, independent of and in addition to the IP-based
// express-rate-limit layer already on every route. Prevents rapid
// double-taps/multi-taps from ever reaching MSG91 more than once, and
// closes the "no per-phone throttle on the send side" gap — the IP
// limiter alone is not a per-caller-identity cost control on a real
// (post-migration, billable) SMS send.
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

export const OTP_AUDIT_STATUS = Object.freeze({
  SENT: "SENT",
  SEND_FAILED: "SEND_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  VERIFIED: "VERIFIED",
  VERIFY_FAILED: "VERIFY_FAILED",
});

// Fixed OTP used ONLY when explicitly enabled via ALLOW_FIXED_OTP=true
// — identical value/gating to the pre-OTP-1 implementation. See
// server.js's own boot-time guardrail (unchanged, untouched by OTP-1)
// for why this can never reach a real NODE_ENV=production deploy.
export const DEV_FIXED_OTP = "123456";

// ─── REVISION 1 — ASYNCHRONOUS AUDIT OUTBOX ─────────────────────────
// See modules/otp/models/OtpAuditOutbox.js and
// modules/otp/jobs/otpAuditOutbox.job.js. Mirrors the claim/apply
// state-machine shape already used by jobs/ratingOutbox.job.js.
export const OTP_OUTBOX_STATE = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
});

export const OTP_OUTBOX_POLL_INTERVAL_MS = 5 * 1000; // drain cadence
export const OTP_OUTBOX_BATCH_SIZE = 100; // rows claimed per tick
export const OTP_OUTBOX_STALE_CLAIM_MS = 60 * 1000; // reclaim a crashed worker's PROCESSING rows
export const OTP_OUTBOX_MAX_ATTEMPTS_BEFORE_FAILED = 5; // after this many failed drain attempts, park as FAILED (still retained, never deleted, visible for ops)

// ─── OTP-1.1 CORRECTION 2 — MSG91 CIRCUIT BREAKER ───────────────────
// See modules/otp/providers/CircuitBreaker.js.
export const CIRCUIT_BREAKER_STATE = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5; // consecutive failures before OPEN
export const CIRCUIT_BREAKER_OPEN_DURATION_MS = 60 * 1000; // OPEN -> HALF_OPEN after this long
