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
        const authKey = process.env.MSG91_AUTH_KEY;
        const templateId = process.env.MSG91_TEMPLATE_ID;

        if (!authKey || !templateId) {
          logger.error("MSG91_AUTH_KEY or MSG91_TEMPLATE_ID missing in env", { phone });
          return {
            success: false,
            provider: "msg91",
            messageId: null,
            latencyMs: Date.now() - startedAt,
            error: "SMS_PROVIDER_NOT_CONFIGURED",
          };
        }

        // MSG91 expects the mobile number with country code, no "+"
        // prefix and no leading zero — e.g. "919999999999".
        const mobile = `91${phone}`;

        // MSG91 v5 SendOTP API. We pass our own pre-generated `otp`
        // (this app generates + stores/verifies OTPs itself via
        // otp.helpers.js / Redis) so MSG91 is used purely as an SMS
        // delivery channel, not as the OTP generator/verifier.
        const url =
          `https://control.msg91.com/api/v5/otp` +
          `?template_id=${encodeURIComponent(templateId)}` +
          `&mobile=${encodeURIComponent(mobile)}` +
          `&otp=${encodeURIComponent(otp)}`;

        const response = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: {
              authkey: authKey,
              "Content-Type": "application/JSON",
            },
          }),
          SMS_TIMEOUT_MS
        );

        const data = await response.json().catch(() => null);

        // MSG91 v5 success responses have `type: "success"`.
        // Anything else (including a non-2xx HTTP status) is treated
        // as a failed send — the exact error message from MSG91 is
        // logged so failures are diagnosable without guessing.
        if (response.ok && data?.type === "success") {
          return {
            success: true,
            provider: "msg91",
            messageId: data?.request_id || null,
            latencyMs: Date.now() - startedAt,
            error: null,
          };
        }

        logger.error("MSG91 send failed", {
          phone,
          httpStatus: response.status,
          responseBody: data,
        });
        return {
          success: false,
          provider: "msg91",
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error: data?.message || "SMS_SEND_FAILED",
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