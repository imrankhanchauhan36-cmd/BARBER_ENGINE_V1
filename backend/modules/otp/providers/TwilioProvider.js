/**
 * BARBER ENGINE V1
 * backend/modules/otp/providers/TwilioProvider.js
 *
 * OTP-1 PART A — interface-compatible stub, ported from the pre-OTP-1
 * services/sms.service.js "twilio" case (which was already a
 * not-implemented stub, not a functional integration — behavior here
 * is unchanged). Selecting SMS_PROVIDER=twilio returns a clean,
 * normalized failure, never throws.
 */

import logger from "../../../utils/logger.js";
import { OtpProvider } from "./OtpProvider.js";

export class TwilioProvider extends OtpProvider {
  get name() {
    return "twilio";
  }

  async sendOtp(phone) {
    const startedAt = Date.now();
    // TODO: wire up a real Twilio client once credentials are available —
    // see the pre-OTP-1 services/sms.service.js "twilio" case for the
    // shape this previously sketched out.
    logger.warn('SMS_PROVIDER="twilio" configured but not implemented yet', { phone });
    return {
      success: false,
      provider: this.name,
      messageId: null,
      latencyMs: Date.now() - startedAt,
      error: "SMS_PROVIDER_NOT_IMPLEMENTED",
    };
  }
}
