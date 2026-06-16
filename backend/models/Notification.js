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

      isArchived: {
        type: Boolean,
        default: false,
      },

      //////////////////////////////////////////////////
      // ACTION
      //////////////////////////////////////////////////

      actionType: {
        type: String,
        default: null,
      },

      actionUrl: {
        type: String,
        default: null,
      },

      //////////////////////////////////////////////////
      // EXTRA PAYLOAD
      //////////////////////////////////////////////////

      meta: {
        type:
          mongoose.Schema.Types.Mixed,

        default: {},
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


//////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////

export default
  mongoose.models.Notification ||
  mongoose.model(
    "Notification",
    NotificationSchema
  );