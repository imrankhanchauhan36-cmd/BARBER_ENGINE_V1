/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/BotProviderResolver.js
 *
 * Phase H — Bot Support. Mirrors
 * modules/notifications/services/NotificationProviderResolver.js:
 * single place that maps a configured provider name -> a concrete
 * implementation. Adding a real AI provider later (a separately-
 * approved future phase) means adding one more entry here and its own
 * provider file — nothing in supportBot.service.js changes.
 *
 * Only DevBotProvider is registered in this phase — no real AI/LLM
 * provider is integrated. If BOT_PROVIDER is unset or doesn't match a
 * registered entry, resolve() returns the dev provider, which itself
 * behaves identically regardless (deterministic, no credentials) —
 * there is no "NOT_CONFIGURED provider" distinct from "dev provider"
 * yet, since no real provider exists to be missing. A real provider's
 * OWN classify()/generateReply() would be what returns NOT_CONFIGURED
 * when ITS credentials are absent, exactly like EmailProvider.js/
 * WhatsappProvider.js/CallProvider.js already do for their channels.
 */

import { getBotProviderConfig } from "../../../config/botProvider.config.js";
import DevBotProvider from "./DevBotProvider.js";

const PROVIDERS = Object.freeze({
  DEV: DevBotProvider,
});

const BotProviderResolver = Object.freeze({
  resolve: () => {
    const { provider } = getBotProviderConfig();
    return PROVIDERS[provider] || DevBotProvider;
  },
});

export default BotProviderResolver;
