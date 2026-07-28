import mongoose from "mongoose";

const NotificationSchema =
  new mongoose.Schema(
    {
      //////////////////////////////////////////////////
      // RECIPIENT
      //////////////////////////////////////////////////

      recipientType: {
        type: String,

        enum: [
          "USER",
          "SALON",
          "ADMIN",
          "STAFF",
        ],

        required: true,
      },

      recipientId: {
        type: mongoose.Schema.Types.ObjectId,

        required: true,

        index: true,
      },

      //////////////////////////////////////////////////
      // CONTENT
      //////////////////////////////////////////////////

      title: {
        type: String,
        required: true,
        trim: true,
      },

      message: {
        type: String,
        required: true,
        trim: true,
      },

      //////////////////////////////////////////////////
      // TYPE
      //////////////////////////////////////////////////

      type: {
        type: String,

        enum: [
          "BOOKING",
          "PAYMENT",
          "SYSTEM",
          "REVIEW",
          "PROMOTION",
        ],

        default: "SYSTEM",

        index: true,
      },

      //////////////////////////////////////////////////
      // PRIORITY
      //////////////////////////////////////////////////

      priority: {
        type: String,

        enum: [
          "LOW",
          "MEDIUM",
          "HIGH",
          "CRITICAL",
        ],

        default: "MEDIUM",
      },

      //////////////////////////////////////////////////
      // STATUS
      //////////////////////////////////////////////////

      isRead: {
        type: Boolean,
        default: false,
        index: true,
      },

      readAt: {
        type: Date,
        default: null,
      },

      isArchived: {
        type: Boolean,
        default: false,
      },

      archivedAt: {
        type: Date,
        default: null,
      },

      //////////////////////////////////////////////////
      // ACTION
      //////////////////////////////////////////////////

      actionType: {
        type: String,

        enum: [
          "OPEN_BOOKING",
          "OPEN_WALLET",
          "OPEN_PROFILE",
          "OPEN_SALON",
          "OPEN_REVIEW",
          "OPEN_HOME",
          null,
        ],

        default: null,
      },

      actionUrl: {
        type: String,
        default: null,
      },

      //////////////////////////////////////////////////
      // ENTITY REFERENCE — what this notification is about
      // (distinct from `type`, which is the notification's own
      // category — a PAYMENT-type notification can still be
      // entityType: "BOOKING" if it's about a booking's payment).
      //////////////////////////////////////////////////

      entityType: {
        type: String,

        enum: [
          "BOOKING",
          "PAYMENT",
          "WALLET",
          "SALON",
          "REVIEW",
          "SYSTEM",
          null,
        ],

        default: null,
      },

      entityId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },

      //////////////////////////////////////////////////
      // EXPIRY — for cleanup jobs (OTP/offer notifications
      // going stale); no TTL index yet, this is a plain field
      // a future cleanup job can query against.
      //////////////////////////////////////////////////

      expiresAt: {
        type: Date,
        default: null,
        index: true,
      },

      //////////////////////////////////////////////////
      // EXTRA PAYLOAD
      //////////////////////////////////////////////////

      meta: {
        type:
          mongoose.Schema.Types.Mixed,

        default: undefined,
      },
    },

    {
      timestamps: true,
    }
  );

//////////////////////////////////////////////////////
// INDEXES
//////////////////////////////////////////////////////

NotificationSchema.index({
  recipientId:   1,
  recipientType: 1,
  isArchived:    1,
  createdAt:     -1,
});

NotificationSchema.index({
  recipientId:   1,
  recipientType: 1,
  isRead:        1,
});

// Covers unread-count/badge queries (recipientId+recipientType+isRead+isArchived)
// without falling back to the 3-field index above and filtering isArchived
// in-memory — home badge, unread tab, and notification screen all hit this.
NotificationSchema.index({
  recipientId:   1,
  recipientType: 1,
  isRead:        1,
  isArchived:    1,
});


//////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////

export default
  mongoose.models.Notification ||
  mongoose.model(
    "Notification",
    NotificationSchema
  );