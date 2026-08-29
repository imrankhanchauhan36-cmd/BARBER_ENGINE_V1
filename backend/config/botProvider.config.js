/**
 * BARBER ENGINE V1
 * backend/config/botProvider.config.js
 *
 * Phase H — Bot Support. Centralizes bot/AI provider configuration,
 * matching the exact convention established by whatsappProvider.config.js
 * / callProvider.config.js — this directory's existing style, not
 * nested inside modules/support/.
 *
 * No real AI provider is integrated in this phase (per the approved
 * design — a real LLM integration is a separately-approved future
 * phase). This file exists so BotProviderResolver.js has a real seam
 * to read from later without any Support-module code changing. Read
 * fresh from the environment at call time, never cached. No API key
 * or credential ever appears in source.
 */

export function getBotProviderConfig() {
  return {
    provider: process.env.BOT_PROVIDER || null,
    apiBaseUrl: process.env.BOT_API_BASE_URL || null,
    accessToken: process.env.BOT_ACCESS_TOKEN || null,
  };
}
