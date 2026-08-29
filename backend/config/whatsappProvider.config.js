/**
 * BARBER ENGINE V1
 * backend/config/whatsappProvider.config.js
 *
 * Phase H — WhatsApp Support. Centralizes WhatsApp provider
 * configuration in one place, matching this directory's existing
 * convention (redis.js/cloudinary.js/db.js) rather than nesting a
 * config file inside modules/support/.
 *
 * This is the ONE seam a future production WhatsApp Business number/
 * account/provider swap goes through — WhatsappProvider.js reads from
 * here, never from process.env directly inline. No phone number, no
 * access token, no account id ever appears in source — every value
 * below is read fresh from the environment at call time (not cached
 * at import time), so a config change takes effect on the next
 * request without requiring a process restart in environments where
 * env vars can be hot-reloaded, and — more importantly — so this file
 * has no state of its own to get stale.
 */

export function getWhatsappProviderConfig() {
  return {
    provider: process.env.WHATSAPP_PROVIDER || null,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
    apiBaseUrl: process.env.WHATSAPP_API_BASE_URL || null,
  };
}
