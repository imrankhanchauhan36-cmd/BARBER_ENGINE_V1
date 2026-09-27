/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/PushProvider.js
 *
 * Notification Engine — Phase 5 (Firebase Cloud Messaging) +
 * FA-P2-A (real Expo push, deep-link data payload)
 *
 * Mirrors services/sms.service.js's exact shape and provider-switch
 * idiom: an env-driven `PUSH_PROVIDER` selects the branch, every
 * branch returns the same normalized result, and "not configured" is
 * an honest, structured outcome — never a fake success and never a
 * thrown error.
 *
 * PUSH_PROVIDER="fcm" sends real pushes via the official Firebase
 * Admin SDK (firebase-admin/messaging, modular API — no deprecated
 * admin.messaging() namespaced calls); one individual send() per
 * active device token, so a single bad token's error never blocks
 * delivery to the recipient's other devices (soft-deactivated on its
 * own — see DEAD_TOKEN_ERRORS below). PUSH_PROVIDER="expo" (FA-P2-A —
 * the Field Agent app's push token architecture) sends via the
 * official expo-server-sdk's batch API, which gives the same
 * per-token-independent-outcome guarantee without a manual loop.
 * PUSH_PROVIDER="none" (the default) remains the Phase 4
 * structurally-honest no-op.
 */

import { Expo } from "expo-server-sdk";
import logger from "../../../utils/logger.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { getActiveDeviceTokens, deactivateDeviceToken } from "../services/deviceToken.service.js";
import { getFirebaseMessaging } from "./firebaseAdmin.js";

const PUSH_PROVIDER = process.env.PUSH_PROVIDER || "none";

// FA-P2-A — accessToken is optional (Expo's "Enhanced Security" push
// token, unrelated to the per-device push tokens this file sends to);
// undefined is a valid, fully-supported constructor arg when it isn't
// configured — never a placeholder or a reason to fail.
const expo = new Expo(
  process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : undefined
);

// FA-P2-A — the ONE deep-link data shape attached to every outbound
// push, for both providers below. Fixes a real gap the FA-P0-A audit
// found: actionType/actionUrl already exist on the in-app Notification
// document but were never attached to the actual push payload sent to
// a device — so a tapped push had nothing to navigate with. Additive
// only: adds a `data` object to the message; does not change
// `notification.title`/`body`, so what a recipient SEES is unchanged
// for every existing Owner/Salon push — only what a tap can now DO is
// new.
const buildDeepLinkData = (payload) => ({
  actionType: payload.actionType ?? null,
  deepLink:   payload.actionUrl ?? null,
  entityType: payload.entityType ?? null,
  entityId:   payload.entityId ? String(payload.entityId) : null,
});

// Network-level error codes (Node/undici), distinct from Firebase's
// own messaging/* codes — both map to the same normalized outcome.
const NETWORK_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);

/**
 * Normalizes a thrown FirebaseMessagingError (or a raw network
 * error) into one of the outcome categories Phase 5 asks for. Never
 * throws — always returns a string.
 */
const mapFirebaseError = (err) => {
  const code = err?.code || "";

  switch (code) {
    case "messaging/invalid-registration-token":
      return "PUSH_INVALID_TOKEN";
    case "messaging/registration-token-not-registered":
      return "PUSH_TOKEN_UNREGISTERED";
    case "messaging/mismatched-credential":
    case "messaging/sender-id-mismatch":
      return "PUSH_SENDER_MISMATCH";
    case "messaging/device-message-rate-exceeded":
    case "messaging/message-rate-exceeded":
    case "messaging/topics-message-rate-exceeded":
    case "messaging/topics-subscription-rate-exceeded":
      return "PUSH_QUOTA_EXCEEDED";
    case "messaging/internal-error":
      return "PUSH_INTERNAL_ERROR";
    case "messaging/authentication-error":
    case "messaging/third-party-auth-error":
      return "PUSH_AUTH_ERROR";
    case "messaging/server-unavailable":
      return "PUSH_NETWORK_ERROR";
    default:
      return NETWORK_ERROR_CODES.has(code) ? "PUSH_NETWORK_ERROR" : "PUSH_SEND_FAILED";
  }
};

// Token errors that mean the token itself is dead — the recipient
// must re-register before another push can ever reach that device.
const DEAD_TOKEN_ERRORS = new Set(["PUSH_INVALID_TOKEN", "PUSH_TOKEN_UNREGISTERED"]);

const PushProvider = Object.freeze({
  name: "PUSH",

  /**
   * @param {object} payload - the original NotificationService.send() payload
   *   (recipientId, recipientType, title, message, ...).
   * @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult>}
   */
  send: async (payload) => {
    const startedAt = Date.now();
    const { recipientType, recipientId } = payload;

    let tokens;
    try {
      tokens = await getActiveDeviceTokens({ recipientType, recipientId });
    } catch (err) {
      return {
        success:   false,
        provider:  PUSH_PROVIDER,
        channel:   NOTIFICATION_CHANNEL.PUSH,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error:     err.message,
      };
    }

    if (!tokens.length) {
      // A legitimate, expected outcome (recipient has no registered
      // device) — not a provider-configuration problem, so it's
      // reported regardless of PUSH_PROVIDER mode.
      return {
        success:   false,
        provider:  PUSH_PROVIDER,
        channel:   NOTIFICATION_CHANNEL.PUSH,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error:     "NO_DEVICE_TOKEN",
      };
    }

    switch (PUSH_PROVIDER) {
      case "none": {
        // Dev fallback — same convention as sms.service.js's
        // SMS_PROVIDER="none": structurally complete, honest that
        // nothing was actually sent.
        if (process.env.NODE_ENV !== "production") {
          logger.debug(`[DEV PUSH] Would push to ${tokens.length} device(s) for ${recipientType}:${recipientId} — "${payload.title}"`);
        } else {
          logger.error("PUSH_PROVIDER not configured in production — push not sent", { recipientType, recipientId });
        }
        return {
          success:   true,
          provider:  "none",
          channel:   NOTIFICATION_CHANNEL.PUSH,
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error:     null,
          dev:       true,
          tokenCount: tokens.length,
        };
      }

      case "expo": {
        // FA-P2-A — real implementation via the official expo-server-sdk,
        // replacing the Phase 5 stub. Same per-token-independent-outcome
        // guarantee as the "fcm" branch below, achieved through Expo's
        // own batch API (chunkPushNotifications/sendPushNotificationsAsync)
        // rather than a manual loop — each message in a chunk still gets
        // its own independent ticket result, so one bad token can never
        // block delivery to the same recipient's other devices.
        const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.token));
        const skippedCount = tokens.length - validTokens.length;
        if (skippedCount > 0) {
          logger.warn(`[PushProvider] ${skippedCount} device token(s) are not valid Expo push tokens — skipped`, {
            recipientType, recipientId,
          });
        }
        if (!validTokens.length) {
          return {
            success:   false,
            provider:  "expo",
            channel:   NOTIFICATION_CHANNEL.PUSH,
            messageId: null,
            latencyMs: Date.now() - startedAt,
            error:     "NO_VALID_EXPO_TOKEN",
          };
        }

        const deepLinkData = buildDeepLinkData(payload);
        const messages = validTokens.map((t) => ({
          to:    t.token,
          sound: "default",
          title: payload.title,
          body:  payload.message,
          data:  deepLinkData,
        }));

        let firstTicketId = null;
        let anySuccess     = false;
        let lastErrorCode  = null;

        try {
          const chunks = expo.chunkPushNotifications(messages);
          for (const chunk of chunks) {
            const tickets = await expo.sendPushNotificationsAsync(chunk);
            tickets.forEach((ticket, i) => {
              if (ticket.status === "ok") {
                anySuccess = true;
                firstTicketId = firstTicketId ?? ticket.id;
                return;
              }
              // ticket.status === "error"
              const errorCode = ticket.details?.error || "PUSH_SEND_FAILED";
              lastErrorCode = errorCode;
              logger.warn("[PushProvider] Expo send failed for one device token", {
                error: errorCode, message: ticket.message, recipientType, recipientId,
              });
              if (errorCode === "DeviceNotRegistered") {
                deactivateDeviceToken({
                  recipientType,
                  recipientId,
                  token: chunk[i].to,
                }).catch((deactivateErr) => {
                  logger.warn("[PushProvider] failed to deactivate dead Expo token", { error: deactivateErr.message });
                });
              }
            });
          }
        } catch (expoErr) {
          // A thrown error here means the whole chunk request failed
          // (network/Expo-service-level), not an individual token —
          // distinct from a per-ticket "error" status handled above.
          logger.warn("[PushProvider] Expo push request failed", { error: expoErr.message, recipientType, recipientId });
          return {
            success:   false,
            provider:  "expo",
            channel:   NOTIFICATION_CHANNEL.PUSH,
            messageId: null,
            latencyMs: Date.now() - startedAt,
            error:     "PUSH_NETWORK_ERROR",
          };
        }

        return {
          success:   anySuccess,
          provider:  "expo",
          channel:   NOTIFICATION_CHANNEL.PUSH,
          messageId: firstTicketId,
          latencyMs: Date.now() - startedAt,
          error:     anySuccess ? null : (lastErrorCode || "PUSH_SEND_FAILED"),
        };
      }

      case "fcm": {
        const messaging = getFirebaseMessaging();
        if (!messaging) {
          logger.error("PUSH_PROVIDER=fcm but Firebase credentials are not configured (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY)", {
            recipientType, recipientId,
          });
          return {
            success:   false,
            provider:  "fcm",
            channel:   NOTIFICATION_CHANNEL.PUSH,
            messageId: null,
            latencyMs: Date.now() - startedAt,
            error:     "PUSH_PROVIDER_NOT_CONFIGURED",
          };
        }

        // No multicast/batch API — one individual send() per active
        // device token, so each token's outcome (including a dead
        // token needing deactivation) is handled independently.
        const deepLinkData = buildDeepLinkData(payload);
        let firstMessageId = null;
        let anySuccess      = false;
        let lastErrorCode    = null;

        for (const tokenDoc of tokens) {
          try {
            const messageId = await messaging.send({
              token: tokenDoc.token,
              notification: {
                title: payload.title,
                body:  payload.message,
              },
              // FA-P2-A — see buildDeepLinkData's header comment.
              // FCM requires every `data` value to be a string.
              data: {
                actionType: deepLinkData.actionType ? String(deepLinkData.actionType) : "",
                deepLink:   deepLinkData.deepLink ? String(deepLinkData.deepLink) : "",
                entityType: deepLinkData.entityType ? String(deepLinkData.entityType) : "",
                entityId:   deepLinkData.entityId || "",
              },
            });
            anySuccess = true;
            firstMessageId = firstMessageId ?? messageId;
          } catch (sendErr) {
            lastErrorCode = mapFirebaseError(sendErr);
            logger.warn("[PushProvider] FCM send failed for one device token", {
              code: sendErr?.code, error: sendErr?.message, recipientType, recipientId,
            });

            if (DEAD_TOKEN_ERRORS.has(lastErrorCode)) {
              // Soft-deactivate only — never delete the document.
              await deactivateDeviceToken({
                recipientType,
                recipientId,
                token: tokenDoc.token,
              }).catch((deactivateErr) => {
                logger.warn("[PushProvider] failed to deactivate dead device token", { error: deactivateErr.message });
              });
            }
          }
        }

        return {
          success:   anySuccess,
          provider:  "fcm",
          channel:   NOTIFICATION_CHANNEL.PUSH,
          messageId: firstMessageId,
          latencyMs: Date.now() - startedAt,
          error:     anySuccess ? null : (lastErrorCode || "PUSH_SEND_FAILED"),
        };
      }

      default: {
        logger.warn(`Unknown PUSH_PROVIDER "${PUSH_PROVIDER}"`);
        return {
          success:   false,
          provider:  PUSH_PROVIDER,
          channel:   NOTIFICATION_CHANNEL.PUSH,
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error:     "PUSH_PROVIDER_UNKNOWN",
        };
      }
    }
  },
});

export default PushProvider;
