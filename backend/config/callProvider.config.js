/**
 * BARBER ENGINE V1
 * backend/config/callProvider.config.js
 *
 * Phase H — Call Support. Centralizes call/telephony provider
 * configuration, matching the exact convention established by
 * whatsappProvider.config.js — this directory's existing style
 * (redis.js/cloudinary.js/db.js), not nested inside modules/support/.
 *
 * No specific provider (Twilio/Exotel/other) has been chosen — this
 * file exposes only the provider-agnostic identifying value plus a
 * generic credential/base-URL pair, matching the approved design's
 * explicit instruction not to invent provider-specific variable names
 * before a provider is actually selected. Read fresh from the
 * environment at call time, never cached, no phone number or
 * credential ever appears in source.
 */

export function getCallProviderConfig() {
  return {
    provider: process.env.CALL_PROVIDER || null,
    apiBaseUrl: process.env.CALL_API_BASE_URL || null,
    accessToken: process.env.CALL_ACCESS_TOKEN || null,
  };
}
