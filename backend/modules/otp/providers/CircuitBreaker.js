/**
 * BARBER ENGINE V1
 * backend/modules/otp/providers/CircuitBreaker.js
 *
 * OTP-1.1 CORRECTION 2 — a lightweight, dependency-free circuit
 * breaker wrapping the MSG91 provider specifically (see
 * providers/index.js#resolveProvider, the only place this class is
 * instantiated). No external library — a small in-process state
 * machine, isolated entirely inside the provider layer. Nothing
 * outside modules/otp/providers/ knows this exists: it implements the
 * same OtpProvider interface as every other provider, so
 * otp.service.js needs zero changes to benefit from it.
 *
 * STATE MACHINE
 *
 *   CLOSED ──(5 consecutive failures)──▶ OPEN
 *   OPEN ──(60s elapsed)──▶ HALF_OPEN
 *   HALF_OPEN ──(trial succeeds)──▶ CLOSED
 *   HALF_OPEN ──(trial fails)──▶ OPEN (timer restarts)
 *
 * CLOSED   — normal operation, every request reaches MSG91.
 * OPEN     — MSG91 is never called; every request short-circuits
 *            immediately with a provider-unavailable result, in the
 *            exact same {success, provider, messageId, latencyMs,
 *            error} shape a real attempt would have returned, so
 *            otp.service.js's existing failure handling (and the
 *            generic client-facing "Could not send OTP" message) is
 *            completely unaffected — the API structure is preserved.
 * HALF_OPEN — exactly ONE trial request is allowed through; every
 *            other concurrent request arriving while that trial is
 *            still in flight is short-circuited exactly like OPEN.
 *
 * CONCURRENCY: Node.js is single-threaded per process — the
 * check-and-transition inside canAttempt()/recordSuccess()/
 * recordFailure() below runs to completion before any other JS
 * callback can interleave, so the HALF_OPEN "exactly one trial" rule
 * cannot race within one process. This breaker is IN-MEMORY and
 * PROCESS-LOCAL, not Redis-shared — a deliberate choice matching the
 * explicit instruction ("do not introduce external libraries... keep
 * implementation lightweight"). In a horizontally-scaled deployment,
 * each instance maintains its own breaker independently — "5
 * consecutive failures" is per-instance, not platform-global. This is
 * the same accepted scope limitation jobs/jobHeartbeat.js's own
 * in-memory registry already documents for this codebase, not a new
 * risk category.
 *
 * OBSERVABILITY: getState() returns {provider, state, failureCount,
 * lastFailureAt, lastRecoveryAt} for LOGGING ONLY. Never returned in
 * any HTTP response — otp.service.js's controllers only ever forward
 * a generic "Could not send OTP" message to clients regardless of the
 * underlying provider result, so these fields have no client-facing
 * path to leak through even if a caller forgot to strip them.
 */

import logger from "../../../utils/logger.js";
import { OtpProvider } from "./OtpProvider.js";
import { CIRCUIT_BREAKER_STATE, CIRCUIT_BREAKER_FAILURE_THRESHOLD, CIRCUIT_BREAKER_OPEN_DURATION_MS } from "../constants/otp.constants.js";

export class CircuitBreaker extends OtpProvider {
  constructor(innerProvider, { failureThreshold = CIRCUIT_BREAKER_FAILURE_THRESHOLD, openDurationMs = CIRCUIT_BREAKER_OPEN_DURATION_MS } = {}) {
    super();
    this.inner = innerProvider;
    this.failureThreshold = failureThreshold;
    this.openDurationMs = openDurationMs;

    this.state = CIRCUIT_BREAKER_STATE.CLOSED;
    this.failureCount = 0;
    this.lastFailureAt = null;
    this.lastRecoveryAt = null;
    this.openedAt = null;
    this._halfOpenTrialInFlight = false;
  }

  get name() {
    return this.inner.name;
  }

  /** Read-only snapshot for logging — see this file's own header. */
  getState() {
    return {
      provider: this.inner.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureAt: this.lastFailureAt,
      lastRecoveryAt: this.lastRecoveryAt,
    };
  }

  // Decides whether THIS call may reach the real provider. Synchronous
  // and side-effecting (may transition OPEN -> HALF_OPEN) — see the
  // file header's concurrency note for why this is race-free.
  _canAttempt() {
    if (this.state === CIRCUIT_BREAKER_STATE.CLOSED) return true;

    if (this.state === CIRCUIT_BREAKER_STATE.OPEN) {
      if (Date.now() - this.openedAt >= this.openDurationMs) {
        this.state = CIRCUIT_BREAKER_STATE.HALF_OPEN;
        this._halfOpenTrialInFlight = true;
        logger.warn(`[CircuitBreaker:${this.inner.name}] OPEN duration elapsed — allowing one HALF_OPEN trial request`, this.getState());
        return true;
      }
      return false;
    }

    // HALF_OPEN: a trial is already in flight (the request that just
    // transitioned OPEN -> HALF_OPEN above) — every other concurrent
    // caller is blocked until that trial resolves via recordSuccess()
    // or recordFailure() below.
    return false;
  }

  _recordSuccess() {
    const wasOpenOrHalfOpen = this.state !== CIRCUIT_BREAKER_STATE.CLOSED;
    this.failureCount = 0;
    this.state = CIRCUIT_BREAKER_STATE.CLOSED;
    this._halfOpenTrialInFlight = false;
    if (wasOpenOrHalfOpen) {
      this.lastRecoveryAt = new Date();
      logger.info(`[CircuitBreaker:${this.inner.name}] recovered — CLOSED`, this.getState());
    }
  }

  _recordFailure() {
    this.failureCount += 1;
    this.lastFailureAt = new Date();

    if (this.state === CIRCUIT_BREAKER_STATE.HALF_OPEN) {
      // Trial failed — back to OPEN, timer restarts.
      this.state = CIRCUIT_BREAKER_STATE.OPEN;
      this.openedAt = Date.now();
      this._halfOpenTrialInFlight = false;
      logger.warn(`[CircuitBreaker:${this.inner.name}] HALF_OPEN trial failed — OPEN again`, this.getState());
      return;
    }

    if (this.state === CIRCUIT_BREAKER_STATE.CLOSED && this.failureCount >= this.failureThreshold) {
      this.state = CIRCUIT_BREAKER_STATE.OPEN;
      this.openedAt = Date.now();
      logger.error(`[CircuitBreaker:${this.inner.name}] ${this.failureCount} consecutive failures — OPEN`, this.getState());
    }
  }

  /**
   * Same OtpProvider.sendOtp(phone, otp, context) contract as every
   * other provider — always resolves, never throws, identical result
   * shape whether the real provider was called or the breaker
   * short-circuited.
   */
  async sendOtp(phone, otp, context = {}) {
    if (!this._canAttempt()) {
      return {
        success: false,
        provider: this.inner.name,
        messageId: null,
        latencyMs: 0,
        error: "PROVIDER_CIRCUIT_OPEN",
      };
    }

    const result = await this.inner.sendOtp(phone, otp, context);
    if (result.success) {
      this._recordSuccess();
    } else {
      this._recordFailure();
    }
    return result;
  }
}
