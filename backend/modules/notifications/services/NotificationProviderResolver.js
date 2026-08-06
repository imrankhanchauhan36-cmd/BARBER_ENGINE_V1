/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/services/NotificationProviderResolver.js
 * Notification Provider Resolver — Phase 3 (registers real + stub providers)
 *
 * Mirrors backend/services/settlement/PayoutProviderResolver.js:
 * single place that maps a notification channel -> a concrete provider
 * implementation. Adding a real channel's implementation later means
 * replacing that channel's provider file's body — nothing here or in
 * NotificationDispatcher changes.
 *
 * All five channels are now registered:
 *   IN_APP    -> InAppProvider   (real — see providers/InAppProvider.js)
 *   PUSH/SMS/EMAIL/WHATSAPP -> their respective stub providers, each of
 *     which always returns a normalized {success:false, error:"NOT_IMPLEMENTED"}
 *     result (see providers/*Provider.js) rather than doing any real
 *     dispatch — "no fake implementations."
 *
 * resolve() still throws AppError(501/"NOT_IMPLEMENTED") for any
 * channel string NOT in this table at all (a typo or a channel not yet
 * added to NOTIFICATION_CHANNEL) — same throw-loudly behavior as the
 * Phase 1 skeleton, now scoped to genuinely-unregistered channels
 * rather than every channel, since every currently-known channel has a
 * real registration below.
 *
 * NOT called by any live production path yet — NotificationService
 * still creates the in-app Notification record directly (see
 * services/NotificationService.js, unchanged this phase). This
 * resolver + NotificationDispatcher are additive architecture that can
 * be dispatched successfully via a direct call (proven in Phase 3
 * verification), not yet wired into the automatic send() flow.
 */

import { AppError } from "../../../utils/response.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import InAppProvider from "../providers/InAppProvider.js";
import PushProvider from "../providers/PushProvider.js";
import SmsProvider from "../providers/SmsProvider.js";
import EmailProvider from "../providers/EmailProvider.js";
import WhatsappProvider from "../providers/WhatsappProvider.js";

const PROVIDERS = Object.freeze({
  [NOTIFICATION_CHANNEL.IN_APP]:   InAppProvider,
  [NOTIFICATION_CHANNEL.PUSH]:     PushProvider,
  [NOTIFICATION_CHANNEL.SMS]:      SmsProvider,
  [NOTIFICATION_CHANNEL.EMAIL]:    EmailProvider,
  [NOTIFICATION_CHANNEL.WHATSAPP]: WhatsappProvider,
});

const NotificationProviderResolver = Object.freeze({
  /**
   * @param {string} channel - NOTIFICATION_CHANNEL value
   * @returns {object} the resolved channel provider (exposing `send()`)
   */
  resolve: (channel) => {
    const provider = PROVIDERS[channel];
    if (!provider) {
      throw new AppError(
        `No notification provider implemented for channel "${channel}"`,
        501,
        "NOT_IMPLEMENTED"
      );
    }
    return provider;
  },
});

export default NotificationProviderResolver;
