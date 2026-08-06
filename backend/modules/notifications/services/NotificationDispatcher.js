/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/services/NotificationDispatcher.js
 *
 * Notification Engine — Phase 3B (now part of the live execution path)
 *
 * Flow: NotificationService -> NotificationDispatcher ->
 * NotificationProviderResolver -> Provider.
 *
 * Deliberately minimal: resolve the channel's provider, call
 * provider.send(payload), return whatever it returns. Nothing else —
 * no status writeback, no retry, no queue, no logging beyond what
 * resolve()/send() already do internally.
 *
 * Called ONLY by NotificationService.send() — no controller, job, or
 * other service may call this directly.
 */

import NotificationProviderResolver from "./NotificationProviderResolver.js";

const NotificationDispatcher = Object.freeze({
  /**
   * @param {string} channel - NOTIFICATION_CHANNEL value
   * @param {object} payload - passed through verbatim to the resolved
   *   provider's send() (for IN_APP, the original NotificationService
   *   payload; see InAppProvider.js).
   * @returns {Promise<import("../providers/NotificationProvider.contract.js").NotificationProviderResult>}
   */
  dispatch: async (channel, payload) => {
    const provider = NotificationProviderResolver.resolve(channel);
    return provider.send(payload);
  },
});

export default NotificationDispatcher;
