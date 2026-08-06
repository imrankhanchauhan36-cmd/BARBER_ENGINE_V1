/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/services/deviceToken.service.js
 *
 * Notification Engine — Phase 4 (DeviceToken integration)
 *
 * Thin service around the existing DeviceToken model (Phase 1 —
 * schema unchanged here). Centralizes register/update/deactivate/read
 * so PushProvider (and any future caller — a registration endpoint in
 * a later phase) doesn't duplicate this query logic.
 *
 * Multiple devices per recipient are supported natively by the
 * model's own {recipientType, recipientId, token} compound key —
 * nothing here assumes a recipient has only one token.
 */

import DeviceToken from "../models/DeviceToken.js";

/**
 * Register a device token, or reactivate + refresh it if it already
 * exists (including a previously-deactivated one — an upsert, never
 * a duplicate row, per the model's partial-unique index).
 */
export const registerDeviceToken = async ({
  recipientType,
  recipientId,
  token,
  platform,
  provider,
  appVersion = null,
  deviceId = null,
}) => {
  // Owner-switch protection — a physical device's token must belong to
  // exactly one recipient at a time. If this exact token is currently
  // valid under a DIFFERENT recipient (e.g. a previous owner logged in
  // on this same device and was never logged out), invalidate that row
  // first, so a push meant for the old recipient can never reach this
  // device again. Never touches this recipient's own row for this
  // token — the upsert below handles that. No-op if no other
  // recipient currently holds it.
  await DeviceToken.updateMany(
    {
      token,
      isValid: true,
      $or: [
        { recipientType: { $ne: recipientType } },
        { recipientId:   { $ne: recipientId } },
      ],
    },
    { $set: { isValid: false } }
  );

  return DeviceToken.findOneAndUpdate(
    { recipientType, recipientId, token },
    {
      $set: {
        isValid: true,
        platform,
        provider,
        appVersion,
        deviceId,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Update metadata (appVersion/deviceId) on an EXISTING active token
 * without changing the token value itself. Does not create a new
 * row — returns null if no matching active token exists (caller
 * should register instead).
 */
export const updateDeviceToken = async ({ recipientType, recipientId, token, appVersion, deviceId }) => {
  const update = { lastSeenAt: new Date() };
  if (appVersion !== undefined) update.appVersion = appVersion;
  if (deviceId !== undefined) update.deviceId = deviceId;

  return DeviceToken.findOneAndUpdate(
    { recipientType, recipientId, token, isValid: true },
    { $set: update },
    { new: true }
  );
};

/**
 * Soft-invalidate a token (logout, or a provider reporting the token
 * is no longer valid) — never hard-deletes, per the model's own
 * documented convention.
 */
export const deactivateDeviceToken = async ({ recipientType, recipientId, token }) => {
  return DeviceToken.findOneAndUpdate(
    { recipientType, recipientId, token, isValid: true },
    { $set: { isValid: false } },
    { new: true }
  );
};

/**
 * Every currently-valid token for a recipient — what PushProvider
 * fans a dispatch out to. Read-only, lean.
 */
export const getActiveDeviceTokens = async ({ recipientType, recipientId }) => {
  return DeviceToken.find({ recipientType, recipientId, isValid: true }).lean();
};
