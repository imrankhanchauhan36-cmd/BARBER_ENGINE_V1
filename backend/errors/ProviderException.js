/**
 * BARBER ENGINE V1
 * backend/errors/ProviderException.js
 * Provider Exception — Phase 4A.1, retryable added Phase 4B
 *
 * Dedicated error type for settlement-provider failures (thrown by
 * SettlementEngine, not by providers themselves — see
 * services/settlement/PayoutProvider.js's contract: a provider
 * reports failure by returning {status:FAILED, failureCode,
 * failureReason, retryable}, not by throwing).
 *
 * Extends AppError rather than plain Error: utils/response.js's
 * Errors.* factories all produce AppError instances, and
 * middlewares/errorHandler.js only special-cases `err instanceof
 * AppError` (plus a few framework error types) — everything else
 * falls through to a generic 500 regardless of any `.status`
 * property attached to it. Extending AppError means
 * ProviderException is handled correctly (real status code, real
 * error code in the response) instead of silently becoming a 500.
 */

import { AppError } from "../utils/response.js";

export class ProviderException extends AppError {
  /**
   * @param {Object} params
   * @param {string} params.provider - e.g. "MANUAL", "RAZORPAYX"
   * @param {string} params.code - machine-readable failure code, e.g. "BANK_DOWN"
   * @param {string} params.message - human-readable message
   * @param {number} [params.status=502] - HTTP status to respond with
   * @param {boolean} [params.retryable=false] - carried through from the provider's result so a
   *   future retry mechanism can read it — no retry logic is implemented by this class itself,
   *   same "carry the signal, don't act on it yet" pattern already used by the frontend's
   *   shared/api/client.js response interceptor.
   */
  constructor({ provider, code, message, status = 502, retryable = false }) {
    super(message, status, code);
    this.provider = provider;
    // Explicit alias — AppError already exposes this as `statusCode`,
    // but the task contract for this class names it `status`.
    this.status = status;
    this.retryable = retryable;
  }
}

export default ProviderException;
