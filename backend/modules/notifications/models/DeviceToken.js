/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/models/DeviceToken.js
 *
 * Notification Engine — Phase 1 (Core model only)
 *
 * Push-notification device registration. No registration endpoint
 * exists yet (that, and push itself, land in a later phase) — this
 * model only establishes the shape so later phases have a home for
 * it without a schema migration.
 *
 * recipientType/recipientId mirror models/Notification.js's own
 * polymorphic pair. isValid is a soft-invalidate flag (never
 * hard-delete a token row) — same soft-delete idiom used everywhere
 * else in this codebase (Chair.js, Service.js, Category.js).
 */

import mongoose from "mongoose";
import {
  DEVICE_PLATFORM_VALUES,
  PUSH_PROVIDER_VALUES,
} from "../../../constants/notification.constants.js";

const DeviceTokenSchema = new mongoose.Schema(
  {
    recipientType: {
      type:     String,
      enum:     ["USER", "SALON"], // owner devices register under SALON, matching Notification.js's convention
      required: true,
    },

    recipientId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    token: {
      type:     String,
      required: true,
      trim:     true,
    },

    platform: {
      type:     String,
      enum:     DEVICE_PLATFORM_VALUES,
      required: true,
    },

    provider: {
      type:     String,
      enum:     PUSH_PROVIDER_VALUES,
      required: true,
    },

    appVersion: {
      type:    String,
      default: null,
    },

    deviceId: {
      type:    String,
      default: null,
    },

    // Soft-invalidate on logout or on a provider "token no longer
    // valid" response — never hard-delete (see file header).
    isValid: {
      type:    Boolean,
      default: true,
      index:   true,
    },

    lastSeenAt: {
      type:    Date,
      default: Date.now,
    },

    // Distinct from lastSeenAt (app-open/registration heartbeat) —
    // this will represent the last time this token was actually used
    // for a successful notification delivery. Nothing writes to it
    // yet; reserved for the Push Notification phase's dispatch path.
    lastUsedAt: {
      type:    Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One active token per (recipient, token) pair — a re-registration of
// the same token is an upsert, not a duplicate row. Partial on
// isValid:true so an invalidated token never blocks the same token
// value being registered again later.
DeviceTokenSchema.index(
  { recipientType: 1, recipientId: 1, token: 1 },
  { unique: true, partialFilterExpression: { isValid: true } }
);

// Dispatch fan-out query: "every valid token for this recipient".
DeviceTokenSchema.index({ recipientId: 1, recipientType: 1, isValid: 1 });

export default
  mongoose.models.DeviceToken ||
  mongoose.model("DeviceToken", DeviceTokenSchema);
