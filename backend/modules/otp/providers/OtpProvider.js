/**
 * BARBER ENGINE V1
 * backend/modules/otp/providers/OtpProvider.js
 *
 * OTP-1 PART A — the provider interface every SMS delivery backend
 * must implement. This codebase generates, hashes, stores, and
 * verifies the OTP itself (see otp.service.js) — a provider's ONLY
 * job is delivering an already-generated OTP value over SMS. No
 * provider implementation may generate or verify an OTP on our
 * behalf.
 *
 * Every implementation's sendOtp() must resolve (never reject) with
 * the shape documented below, even on failure — callers branch on
 * `result.success`, they never catch a provider-thrown error. This
 * mirrors the pre-OTP-1 services/sms.service.js contract exactly, so
 * otp.service.js's provider-dispatch code stays simple.
 */

export class OtpProvider {
  /**
   * @param {string} phone - bare 10-digit Indian mobile number (no
   *   country code, no "+") — normalization happens upstream, in the
   *   controller, before this is ever called.
   * @param {string} otp - the already-generated OTP value to deliver.
   * @param {{ purpose?: string }} [context] - non-authoritative,
   *   delivery-only context (e.g. for providers with per-template
   *   routing in the future). Never used to generate or verify.
   * @returns {Promise<{
   *   success: boolean,
   *   provider: string,
   *   messageId: string|null,
   *   latencyMs: number,
   *   error: string|null,
   * }>}
   */
  // eslint-disable-next-line no-unused-vars
  async sendOtp(phone, otp, context = {}) {
    throw new Error(`${this.constructor.name} must implement sendOtp()`);
  }

  /** @returns {string} stable provider identifier, e.g. "msg91". */
  get name() {
    throw new Error(`${this.constructor.name} must implement the name getter`);
  }
}
