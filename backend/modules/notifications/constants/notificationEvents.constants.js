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
  // FINANCE-P0-1 — new canonical-payout lifecycle stages the merged
  // Razorpay Route path can reach (PROCESSING/FAILED were never
  // observable before this ticket; PAID previously reused
  // WITHDRAW_APPROVED's own copy for the synchronous MANUAL path).
  WITHDRAW_PROCESSING: "WITHDRAW_PROCESSING",
  WITHDRAW_PAID:        "WITHDRAW_PAID",
  WITHDRAW_FAILED:      "WITHDRAW_FAILED",
  WITHDRAW_CANCELLED:   "WITHDRAW_CANCELLED",

  // KYC
  // ZEMISH Phase 3 — stale comment corrected: both ARE wired, from
  // modules/kyc/controllers/adminKyc.controller.js's
  // approveKYCHandler/rejectKYCHandler (Owner, via recipientType
  // "SALON", and Field Agent, via FA-P2-A's separate recipientType
  // "FIELD_AGENT" branch) — confirmed directly from source, not
  // reserved/unwired as this comment previously, incorrectly, said.
  KYC_APPROVED: "KYC_APPROVED",
  KYC_REJECTED: "KYC_REJECTED",

  // Salon
  SALON_APPROVED: "SALON_APPROVED", // reserved — no caller yet
  SALON_REJECTED: "SALON_REJECTED", // reserved — no caller yet

  // Field Agent (FA-P2-A) — KYC_APPROVED/KYC_REJECTED above are reused
  // as-is for the Field Agent applicant path too (same template key,
  // different recipientType/recipientId at the call site); these three
  // are Field-Agent-only events with no Owner/Salon equivalent.
  NEW_SALON_ASSIGNED:       "NEW_SALON_ASSIGNED",
  REFERRAL_REWARD_CREDITED: "REFERRAL_REWARD_CREDITED",
  TERRITORY_REASSIGNED:     "TERRITORY_REASSIGNED",
  // PHASE C.3 — AcquisitionClaim admin-decision notifications. Additive
  // only, same "Field-Agent-only event" convention as the three above.
  ACQUISITION_CLAIM_APPROVED:  "ACQUISITION_CLAIM_APPROVED",
  ACQUISITION_CLAIM_ENDED:     "ACQUISITION_CLAIM_ENDED",
  // PHASE C.3-A — the explicit admin completion action.
  ACQUISITION_CLAIM_COMPLETED: "ACQUISITION_CLAIM_COMPLETED",

  // Support (Phase D — Ticket + Conversation + Message Engine).
  // Only SUPPORT_TICKET_STATUS_CHANGED has a caller — ticket-created
  // and message-received are deliberately not wired as notifications
  // (the recipient is always the actor who just performed that exact
  // action; every other reserved key above follows the same
  // no-caller-yet convention).
  SUPPORT_TICKET_STATUS_CHANGED: "SUPPORT_TICKET_STATUS_CHANGED",
  SUPPORT_TICKET_CREATED:        "SUPPORT_TICKET_CREATED",   // reserved — no caller yet
  SUPPORT_MESSAGE_RECEIVED:      "SUPPORT_MESSAGE_RECEIVED", // reserved — no caller yet

  // SLA (Phase G Step 8) — three events distinguishing warning/
  // breach/escalation, each carrying dimension (FIRST_RESPONSE vs
  // RESOLUTION) in `variables`/`meta` rather than as separate keys,
  // matching the same one-key-plus-payload-detail convention already
  // used by SUPPORT_TICKET_STATUS_CHANGED (one key, `variables.status`
  // distinguishes the specific status).
  SLA_WARNING:   "SLA_WARNING",
  SLA_BREACHED:  "SLA_BREACHED",
  SLA_ESCALATED: "SLA_ESCALATED",
});

export const NOTIFICATION_EVENTS_VALUES = Object.values(NOTIFICATION_EVENTS);
