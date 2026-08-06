/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/models/NotificationDeliveryLog.js
 *
 * Notification Engine — Phase 1 (Core model only)
 *
 * One row per channel-dispatch attempt (IN_APP/PUSH/SMS/EMAIL/
 * WHATSAPP) for a notification. This is the multi-channel delivery
 * ledger AND (in a later phase) the dispatch/retry queue — PENDING
 * rows are what a future polling job (matching the setInterval
 * convention already used by jobs/holdExpiry.job.js etc.) will pick
 * up. No such job exists yet in Phase 1; this model only establishes
 * the shape and is written to by NotificationService for the IN_APP
 * leg only (see services/NotificationService.js).
 *
 * recipientType/recipientId mirror models/Notification.js's own
 * polymorphic pair exactly (same enum values) rather than a `ref`,
 * for the same reason: the recipient collection depends on
 * recipientType.
 */

import mongoose from "mongoose";
import {
  NOTIFICATION_CHANNEL_VALUES,
  DELIVERY_STATUS,
  DELIVERY_STATUS_VALUES,
} from "../../../constants/notification.constants.js";

const NotificationDeliveryLogSchema = new mongoose.Schema(
  {
    // Nullable — some future channel-only sends (e.g. a transactional
    // SMS with no inbox entry) may not have a Notification doc at all.
    notificationId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Notification",
      default: null,
      index:   true,
    },

    recipientType: {
      type:     String,
      enum:     ["USER", "SALON", "ADMIN", "STAFF"], // matches Notification.js recipientType exactly
      required: true,
    },

    recipientId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    channel: {
      type:     String,
      enum:     NOTIFICATION_CHANNEL_VALUES,
      required: true,
    },

    status: {
      type:    String,
      enum:    DELIVERY_STATUS_VALUES,
      default: DELIVERY_STATUS.PENDING,
      index:   true,
    },

    // e.g. "in-app", "expo-fcm", "msg91", "sendgrid" — populated once
    // a real channel provider exists (later phase). Null for now on
    // every row except IN_APP.
    provider: {
      type:    String,
      default: null,
    },

    providerMessageId: {
      type:    String,
      default: null,
    },

    // Retry bookkeeping — read by a future dispatch/retry job only.
    // Nothing writes a non-zero attemptCount or a real nextRetryAt in
    // Phase 1 (no dispatch job exists yet).
    attemptCount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    nextRetryAt: {
      type:    Date,
      default: null,
      index:   true,
    },

    lastError: {
      type:    String,
      default: null,
    },

    // Reserved for future analytics — will represent when a worker
    // actually started processing this delivery (distinct from
    // sentAt/deliveredAt). Nothing writes to it yet; no dispatch job
    // exists in this phase.
    processingStartedAt: { type: Date, default: null },

    sentAt:      { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    openedAt:    { type: Date, default: null },
    clickedAt:   { type: Date, default: null },

    meta: {
      type:    mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true }
);

// Future dispatch/retry job's queue query: "give me PENDING rows due now".
NotificationDeliveryLogSchema.index({ status: 1, nextRetryAt: 1 });

// Per-recipient delivery history / admin drill-down.
NotificationDeliveryLogSchema.index({
  recipientId:   1,
  recipientType: 1,
  channel:       1,
  createdAt:     -1,
});

export default
  mongoose.models.NotificationDeliveryLog ||
  mongoose.model("NotificationDeliveryLog", NotificationDeliveryLogSchema);
