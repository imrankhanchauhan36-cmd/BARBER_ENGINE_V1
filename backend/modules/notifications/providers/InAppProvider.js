/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/InAppProvider.js
 *
 * Notification Engine — Phase 3B (owns the actual notification creation logic)
 *
 * This is now the ONLY place that creates an in-app Notification
 * document. The logic here — render template if requested (falling
 * back to the caller's literal title/message on any miss or error,
 * unchanged), then create the Notification document — was moved
 * verbatim out of services/NotificationService.js. There is exactly
 * one notification-creation path in the codebase; NotificationService
 * no longer calls createNotification() or renderTemplate() itself.
 */

import { createNotification } from "../../../controllers/notification.controller.js";
import { renderTemplate } from "../services/templateRenderer.service.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import logger from "../../../utils/logger.js";

const InAppProvider = Object.freeze({
  name: "IN_APP",

  /**
   * @param {object} payload - the original NotificationService.send() payload
   *   (recipientId, recipientType, title, message, templateKey?, variables?,
   *   type, priority, actionType, actionUrl, meta, ...) — passed through
   *   unchanged by NotificationDispatcher.
   * @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult & { notification: object|null }>}
   *   Carries an additional `notification` field (the created Mongoose
   *   document, or null on failure) alongside the normalized result —
   *   NotificationService needs the raw document to preserve its
   *   existing return value. assertValidProviderResult only checks
   *   for the required keys, so this extra field is compatible with
   *   the provider contract.
   */
  send: async (payload) => {
    const startedAt = Date.now();
    try {
      let { title, message } = payload;

      // Moved verbatim from NotificationService (Phase 2) — same
      // renderTemplate call, same fallback-on-miss/error behavior.
      if (payload.templateKey) {
        try {
          const rendered = await renderTemplate(
            payload.templateKey,
            payload.variables,
            NOTIFICATION_CHANNEL.IN_APP,
            { recipientType: payload.recipientType, recipientId: payload.recipientId }
          );
          if (rendered) {
            if (rendered.title) title = rendered.title;
            if (rendered.body)  message = rendered.body;
          }
          // rendered === null → title/message stay exactly what the
          // caller passed in (the fallback) — unchanged from Phase 2.
        } catch (renderErr) {
          logger.warn("[InAppProvider] template render failed, using fallback", { error: renderErr.message });
        }
      }

      // Moved verbatim from NotificationService (Phase 1). Already
      // swallows its own DB errors internally and returns null on
      // failure — never throws.
      const notification = await createNotification({ ...payload, title, message });

      return {
        success:      Boolean(notification),
        provider:     "in-app",
        channel:      NOTIFICATION_CHANNEL.IN_APP,
        messageId:    notification ? String(notification._id) : null,
        latencyMs:    Date.now() - startedAt,
        error:        notification ? null : "NOTIFICATION_CREATE_FAILED",
        notification,
      };
    } catch (err) {
      return {
        success:      false,
        provider:     "in-app",
        channel:      NOTIFICATION_CHANNEL.IN_APP,
        messageId:    null,
        latencyMs:    Date.now() - startedAt,
        error:        err.message,
        notification: null,
      };
    }
  },
});

export default InAppProvider;
