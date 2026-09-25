/**
 * BARBER ENGINE V1
 * backend/modules/otp/providers/AwsSnsProvider.js
 *
 * OTP-1 PART A — interface-compatible stub only. Not implemented, per
 * the explicit instruction to implement only MSG91 functionally.
 * Selecting SMS_PROVIDER=aws_sns returns a clean, normalized failure
 * (never throws, never silently no-ops as a false success) so
 * otp.service.js's caller-facing contract stays identical regardless
 * of which provider is configured.
 */

import logger from "../../../utils/logger.js";
import { OtpProvider } from "./OtpProvider.js";

export class AwsSnsProvider extends OtpProvider {
  get name() {
    return "aws_sns";
  }

  async sendOtp(phone) {
    const startedAt = Date.now();
    logger.warn('SMS_PROVIDER="aws_sns" configured but not implemented yet', { phone });
    return {
      success: false,
      provider: this.name,
      messageId: null,
      latencyMs: Date.now() - startedAt,
      error: "SMS_PROVIDER_NOT_IMPLEMENTED",
    };
  }
}
