import logger from "../utils/logger.js";

const SMS_PROVIDER = process.env.SMS_PROVIDER || "none";
const SMS_TIMEOUT_MS = 5000;

/**
 * Wraps a provider call so a hanging SMS API can never hang the
 * login request. Once a real provider is wired in below, its call
 * just needs to be passed through this.
 */
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("SMS_PROVIDER_TIMEOUT")), ms)
    ),
  ]);

/**
 * Single entry point for sending OTP SMS. Swapping/adding providers
 * later (MSG91 / Twilio / AWS SNS) only means editing this file —
 * no controller changes needed, since callers only care about the
 * shape returned below.
 */
export const sendOtpSms = async (phone, otp) => {
  const startedAt = Date.now();

  switch (SMS_PROVIDER) {
    case "none": {
      // Dev fallback — OTP is NEVER returned in the API response.
      // It's only visible in server logs, for local testing.
      if (process.env.NODE_ENV !== "production") {
        logger.debug(`[DEV SMS] OTP for +91${phone}: ${otp}`);
      } else {
        logger.error("SMS_PROVIDER not configured in production — OTP not sent", { phone });
      }
      return {
        success: true,
        provider: "none",
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error: null,
        dev: true,
      };
    }

    case "msg91": {
      try {
        // TODO: wire up real MSG91 client once credentials are available
        // const result = await withTimeout(
        //   msg91Client.send({ phone, otp }),
        //   SMS_TIMEOUT_MS
        // );
        logger.warn('SMS_PROVIDER="msg91" configured but not implemented yet');
        return {
          success: false,
          provider: "msg91",
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error: "SMS_PROVIDER_NOT_IMPLEMENTED",
        };
      } catch (err) {
        logger.error("MSG91 send failed", { message: err.message, phone });
        return {
          success: false,
          provider: "msg91",
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error: err.message === "SMS_PROVIDER_TIMEOUT" ? "SMS_PROVIDER_TIMEOUT" : "SMS_SEND_FAILED",
        };
      }
    }

    case "twilio": {
      try {
        // TODO: wire up real Twilio client once credentials are available
        // const result = await withTimeout(
        //   twilioClient.messages.create({ to: phone, body: `OTP: ${otp}` }),
        //   SMS_TIMEOUT_MS
        // );
        logger.warn('SMS_PROVIDER="twilio" configured but not implemented yet');
        return {
          success: false,
          provider: "twilio",
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error: "SMS_PROVIDER_NOT_IMPLEMENTED",
        };
      } catch (err) {
        logger.error("Twilio send failed", { message: err.message, phone });
        return {
          success: false,
          provider: "twilio",
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error: err.message === "SMS_PROVIDER_TIMEOUT" ? "SMS_PROVIDER_TIMEOUT" : "SMS_SEND_FAILED",
        };
      }
    }

    default: {
      logger.warn(`Unknown SMS_PROVIDER "${SMS_PROVIDER}"`);
      return {
        success: false,
        provider: SMS_PROVIDER,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error: "SMS_PROVIDER_UNKNOWN",
      };
    }
  }
};