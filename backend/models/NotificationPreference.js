import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// NOTIFICATION PREFERENCE
// One document per user, created lazily on first PATCH (see
// notificationPreferences.controller.js) — a user who never opens
// Notification Settings has no document at all, and GET simply
// returns these same defaults without writing anything.
//////////////////////////////////////////////////////////////

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  bookingConfirmations: true,
  bookingReminders:     true,
  rescheduleUpdates:    true,
  cancellationUpdates:  true,
  specialOffers:        true,
  newSalonOffers:       true,
  referralRewards:      false,
  accountUpdates:       true,
  paymentUpdates:       true,
  productUpdates:       false,
  pushNotifications:    true,
  emailNotifications:   false,
};

const NotificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      unique:   true,
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////
    // BOOKING NOTIFICATIONS
    //////////////////////////////////////////////////

    bookingConfirmations: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.bookingConfirmations },
    bookingReminders:     { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.bookingReminders },
    rescheduleUpdates:    { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.rescheduleUpdates },
    cancellationUpdates:  { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.cancellationUpdates },

    //////////////////////////////////////////////////
    // OFFERS & PROMOTIONS
    //////////////////////////////////////////////////

    specialOffers:  { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.specialOffers },
    newSalonOffers: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.newSalonOffers },
    referralRewards: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.referralRewards },

    //////////////////////////////////////////////////
    // ACCOUNT & UPDATES
    //////////////////////////////////////////////////

    accountUpdates: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.accountUpdates },
    paymentUpdates: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.paymentUpdates },
    productUpdates: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.productUpdates },

    //////////////////////////////////////////////////
    // GENERAL
    //////////////////////////////////////////////////

    pushNotifications:  { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.pushNotifications },
    emailNotifications: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.emailNotifications },
  },

  {
    timestamps: true,
  }
);

export default
  mongoose.models.NotificationPreference ||
  mongoose.model(
    "NotificationPreference",
    NotificationPreferenceSchema
  );
