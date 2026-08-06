import NotificationDeliveryLog from "../modules/notifications/models/NotificationDeliveryLog.js";
import { NOTIFICATION_CHANNEL, DELIVERY_STATUS } from "../constants/notification.constants.js";
import NotificationDispatcher from "../modules/notifications/services/NotificationDispatcher.js";

//////////////////////////////////////////////////////////////
// NOTIFICATION SERVICE
// The SINGLE public entry point for every outbound notification.
// No controller/job/service may call NotificationDispatcher directly —
// they all go through send() here, exactly as before.
//
// Phase 3B: the actual notification-creation logic (template
// rendering + writing the Notification document) has MOVED into
// InAppProvider — reached via
//   NotificationService -> NotificationDispatcher ->
//   NotificationProviderResolver -> InAppProvider.send() ->
//   createNotification()
// This file no longer imports createNotification, renderTemplate, or
// any provider directly. Every existing call site keeps calling
// send(payload, channels?) exactly as before — the public API,
// return value, fallback behavior, template rendering, delivery-log
// creation, and error-swallowing are all byte-for-byte identical to
// Phase 1/2; only WHO performs the creation step changed.
//
// `channels` still defaults to [IN_APP] — behavior for every current
// caller (all of whom never pass this param) is 100% unchanged.
//
// Phase 4: PUSH is now a real, dispatchable channel (see
// providers/PushProvider.js) alongside IN_APP. IN_APP is still always
// dispatched first, unconditionally — it is what creates the
// Notification document everything else correlates to. If a caller's
// `channels` array also includes PUSH, it is now genuinely dispatched
// through the exact same Dispatcher -> Resolver -> Provider path, and
// its NotificationDeliveryLog row reflects the provider's real result
// instead of a placeholder. No current caller passes PUSH, so this is
// dormant for all 18 existing call sites — zero behavior change for
// them. SMS/EMAIL/WHATSAPP are untouched this phase: still logged as
// a PENDING placeholder, never dispatched (those channels come in
// later phases).
//////////////////////////////////////////////////////////////

const NotificationService = {
  async send(payload, channels = [NOTIFICATION_CHANNEL.IN_APP]) {
    try {
      const result = await NotificationDispatcher.dispatch(NOTIFICATION_CHANNEL.IN_APP, payload);
      const notification = result?.notification ?? null;

      // Best-effort delivery ledger — never allowed to affect the
      // return value or propagate to the caller. Only logged when
      // the in-app write actually succeeded (a null `notification`
      // means nothing was delivered, so nothing to log).
      if (notification) {
        try {
          const now = new Date();
          await Promise.all(
            channels.map(async (channel) => {
              if (channel === NOTIFICATION_CHANNEL.IN_APP) {
                // Unchanged from Phase 1/2/3B — identical values.
                return NotificationDeliveryLog.create({
                  notificationId: notification._id,
                  recipientType:  payload.recipientType,
                  recipientId:    payload.recipientId,
                  channel,
                  status:      DELIVERY_STATUS.DELIVERED,
                  provider:    "in-app",
                  sentAt:      now,
                  deliveredAt: now,
                });
              }

              if (channel === NOTIFICATION_CHANNEL.PUSH) {
                // NEW (Phase 4) — real dispatch through the same
                // Dispatcher -> Resolver -> PushProvider path.
                let pushResult;
                try {
                  pushResult = await NotificationDispatcher.dispatch(NOTIFICATION_CHANNEL.PUSH, payload);
                } catch (dispatchErr) {
                  pushResult = { success: false, provider: null, providerMessageId: null, error: dispatchErr.message };
                }
                return NotificationDeliveryLog.create({
                  notificationId: notification._id,
                  recipientType:  payload.recipientType,
                  recipientId:    payload.recipientId,
                  channel,
                  // SENT (not DELIVERED) — no real provider confirms
                  // actual device receipt in this phase.
                  status:            pushResult.success ? DELIVERY_STATUS.SENT : DELIVERY_STATUS.FAILED,
                  provider:          pushResult.provider ?? null,
                  providerMessageId: pushResult.messageId ?? null,
                  sentAt:            pushResult.success ? now : null,
                  lastError:         pushResult.success ? null : (pushResult.error || "PUSH_DISPATCH_FAILED"),
                });
              }

              // Any other channel (SMS/EMAIL/WHATSAPP) — unchanged
              // placeholder behavior; not targeted by this phase.
              return NotificationDeliveryLog.create({
                notificationId: notification._id,
                recipientType:  payload.recipientType,
                recipientId:    payload.recipientId,
                channel,
                status:      DELIVERY_STATUS.PENDING,
                provider:    null,
                sentAt:      null,
                deliveredAt: null,
              });
            })
          );
        } catch (logErr) {
          console.warn("[NotificationService] delivery log write failed (non-critical):", logErr.message);
        }
      }

      return notification;
    } catch (err) {
      console.warn("[NotificationService] send failed (non-critical):", err.message);
      return null;
    }
  },
};

export default NotificationService;
