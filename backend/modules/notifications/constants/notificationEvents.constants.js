/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/constants/notificationEvents.constants.js
 *
 * Notification Engine — Phase 2 (Event Registry — REGISTRY ONLY)
 *
 * Single source of truth mapping a business event to the templateKey
 * NotificationService/renderTemplate use to look up its
 * NotificationTemplate row. Pure lookup table — no functions, no
 * conditional logic, nothing else.
 *
 * Some keys below have no caller yet (BOOKING_CREATED, PAYMENT_*,
 * WITHDRAW_*, KYC_*, SALON_APPROVED/REJECTED) — reserved for a later
 * phase when those flows are wired to NotificationService. Wiring a
 * NEW call site for them is explicitly out of scope for Phase 2.
 *
 * Does NOT touch the frozen backend/constants/notification.constants.js
 * (Phase 1) — this is a separate, additive file.
 */

export const NOTIFICATION_EVENTS = Object.freeze({
  // Booking
  BOOKING_CREATED:          "BOOKING_CREATED",          // reserved — no caller yet
  BOOKING_CONFIRMED:        "BOOKING_CONFIRMED",
  BOOKING_CHECKED_IN:       "BOOKING_CHECKED_IN",
  BOOKING_CANCELLED:        "BOOKING_CANCELLED",
  BOOKING_CANCELLED_NOSHOW: "BOOKING_CANCELLED_NOSHOW",
  BOOKING_NO_SHOW:          "BOOKING_NO_SHOW",
  BOOKING_REMINDER_MANUAL:  "BOOKING_REMINDER_MANUAL",
  BOOKING_REMINDER_30MIN:   "BOOKING_REMINDER_30MIN",
  BOOKING_REMINDER_5MIN:    "BOOKING_REMINDER_5MIN",

  // Service (part of the booking lifecycle, distinct wording per recipient)
  SERVICE_STARTED:              "SERVICE_STARTED",
  SERVICE_COMPLETED_SALON:      "SERVICE_COMPLETED_SALON",
  SERVICE_COMPLETED_USER:       "SERVICE_COMPLETED_USER",
  SERVICE_EXTENDED_USER:        "SERVICE_EXTENDED_USER",
  SERVICE_EXTENDED_SALON:       "SERVICE_EXTENDED_SALON",
  SERVICE_AUTO_COMPLETED_SALON: "SERVICE_AUTO_COMPLETED_SALON",
  SERVICE_AUTO_COMPLETED_USER:  "SERVICE_AUTO_COMPLETED_USER",

  // Payment / Wallet
  PAYMENT_SUCCESS: "PAYMENT_SUCCESS", // reserved — no caller yet
  PAYMENT_FAILED:  "PAYMENT_FAILED",  // reserved — no caller yet
  WALLET_CREDIT:   "WALLET_CREDIT",

  // Withdrawal
  WITHDRAW_REQUESTED: "WITHDRAW_REQUESTED", // reserved — no caller yet
  WITHDRAW_APPROVED:  "WITHDRAW_APPROVED",  // reserved — no caller yet
  WITHDRAW_REJECTED:  "WITHDRAW_REJECTED",  // reserved — no caller yet

  // KYC
  KYC_APPROVED: "KYC_APPROVED", // reserved — no caller yet
  KYC_REJECTED: "KYC_REJECTED", // reserved — no caller yet

  // Salon
  SALON_APPROVED: "SALON_APPROVED", // reserved — no caller yet
  SALON_REJECTED: "SALON_REJECTED", // reserved — no caller yet
});

export const NOTIFICATION_EVENTS_VALUES = Object.values(NOTIFICATION_EVENTS);
