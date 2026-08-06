/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/PushProvider.js
 *
 * Notification Engine — Phase 5 (real Firebase Cloud Messaging)
 *
 * Mirrors services/sms.service.js's exact shape and provider-switch
 * idiom: an env-driven `PUSH_PROVIDER` selects the branch, every
 * branch returns the same normalized result, and "not configured" is
 * an honest, structured outcome — never a fake success and never a
 * thrown error.
 *
 * PUSH_PROVIDER="fcm" now sends real pushes via the official Firebase
 * Admin SDK (firebase-admin/messaging, modular API — no deprecated
 * admin.messaging() namespaced calls). PUSH_PROVIDER="none" (the
 * default) and "expo" remain exactly as Phase 4 left them — a
 * structurally-honest no-op and an intentionally-unimplemented stub,
 * respectively. No multicast/batch API is used — each active device
 * token is sent to individually, in a simple loop, so a single bad
 * token's error (invalid/unregistered) never blocks delivery to the
 * recipient's other devices and is soft-deactivated on its own (see
 * DEAD_TOKEN_ERRORS below).
 */

import logger from "../../../utils/logger.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { getActiveDeviceTokens, deactivateDeviceToken } from "../services/deviceToken.service.js";
import { getFirebaseMessaging } from "./firebaseAdmin.js";

const PUSH_PROVIDER = process.env.PUSH_PROVIDER || "none";

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
        // TODO: wire up a real Expo push client once needed — out of
        // scope for Phase 5 (Firebase Cloud Messaging only).
        logger.warn(`PUSH_PROVIDER="${PUSH_PROVIDER}" configured but not implemented yet`);
        return {
          success:   false,
          provider:  PUSH_PROVIDER,
          channel:   NOTIFICATION_CHANNEL.PUSH,
          messageId: null,
          latencyMs: Date.now() - startedAt,
          error:     "PUSH_PROVIDER_NOT_IMPLEMENTED",
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
