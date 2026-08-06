//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — BACKEND
// constants/notification.constants.js
// Notification Engine — Phase 1 (Core enums only)
//
// Single source of truth for the enums the new Notification Engine
// pieces (modules/notifications/*) use. Same frozen-object +
// Object.values() idiom as constants/chairAvailability.constants.js,
// so models/services/validators can all import the same values
// without risking drift.
//
// IMPORTANT — these are NEW enums for the NEW models only
// (NotificationTemplate / NotificationDeliveryLog / DeviceToken).
// The EXISTING models/Notification.js `type`/`priority` enums are
// untouched and are NOT redefined here — this file does not change
// their values or behavior in any way.
//////////////////////////////////////////////////////

// ── CATEGORY ─────────────────────────────────────────
// Canonical category list for the new multi-channel pieces. Superset
// of the existing Notification.type enum (BOOKING/PAYMENT/SYSTEM/
// REVIEW/PROMOTION) plus categories the roadmap names but that don't
// exist as a Notification.type value yet. FIELD_PARTNER is reserved
// for a module that isn't built yet — kept here so a later addition
// doesn't need a breaking enum change.
export const NOTIFICATION_CATEGORY = Object.freeze({
  BOOKING:       "BOOKING",
  WALLET:        "WALLET",
  PAYMENT:       "PAYMENT",
  WITHDRAWAL:    "WITHDRAWAL",
  SALON:         "SALON",
  OFFER:         "OFFER",
  PROMOTION:     "PROMOTION",
  REMINDER:      "REMINDER",
  KYC:           "KYC",
  SYSTEM:        "SYSTEM",
  SECURITY:      "SECURITY",
  ADMIN:         "ADMIN",
  FIELD_PARTNER: "FIELD_PARTNER", // reserved — Field Partner module not built yet
});
export const NOTIFICATION_CATEGORY_VALUES = Object.values(NOTIFICATION_CATEGORY);

// ── CHANNEL ──────────────────────────────────────────
// IN_APP is the only channel actually dispatched today (Phase 1).
// PUSH/SMS/EMAIL/WHATSAPP are reserved values so the new models can
// reference them now — no provider exists for any of them yet.
export const NOTIFICATION_CHANNEL = Object.freeze({
  IN_APP:   "IN_APP",
  PUSH:     "PUSH",     // reserved — provider lands in a later phase
  SMS:      "SMS",      // reserved — provider lands in a later phase
  EMAIL:    "EMAIL",    // reserved — provider lands in a later phase
  WHATSAPP: "WHATSAPP", // reserved — future
});
export const NOTIFICATION_CHANNEL_VALUES = Object.values(NOTIFICATION_CHANNEL);

// ── PRIORITY ─────────────────────────────────────────
// For the NEW models only. The existing Notification.priority enum
// (LOW/MEDIUM/HIGH/CRITICAL) is untouched — this uses NORMAL instead
// of MEDIUM for new records, per the approved architecture doc.
export const NOTIFICATION_PRIORITY = Object.freeze({
  LOW:      "LOW",
  NORMAL:   "NORMAL",
  HIGH:     "HIGH",
  CRITICAL: "CRITICAL",
});
export const NOTIFICATION_PRIORITY_VALUES = Object.values(NOTIFICATION_PRIORITY);

// ── DELIVERY STATUS ──────────────────────────────────
// Lifecycle of one NotificationDeliveryLog row (one channel-dispatch
// attempt). Retry/backoff logic itself is NOT implemented in Phase 1
// — this enum only describes the states a row can be in.
export const DELIVERY_STATUS = Object.freeze({
  PENDING:          "PENDING",
  SENT:             "SENT",
  DELIVERED:        "DELIVERED",
  FAILED:           "FAILED",
  FAILED_PERMANENT: "FAILED_PERMANENT",
  OPENED:           "OPENED",
  CLICKED:          "CLICKED",
  DISMISSED:        "DISMISSED",
});
export const DELIVERY_STATUS_VALUES = Object.values(DELIVERY_STATUS);

// ── DEVICE PLATFORM / PUSH PROVIDER ──────────────────
// For the NEW DeviceToken model only.
export const DEVICE_PLATFORM = Object.freeze({
  IOS:     "IOS",
  ANDROID: "ANDROID",
  WEB:     "WEB",
});
export const DEVICE_PLATFORM_VALUES = Object.values(DEVICE_PLATFORM);

export const PUSH_PROVIDER = Object.freeze({
  EXPO: "EXPO",
  FCM:  "FCM",
});
export const PUSH_PROVIDER_VALUES = Object.values(PUSH_PROVIDER);
