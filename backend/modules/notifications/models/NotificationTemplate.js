/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/models/NotificationTemplate.js
 *
 * Notification Engine — Phase 1 (Core model only)
 *
 * One document per notification event ("templateKey"), holding the
 * rendered title/body per channel. NOT wired into NotificationService
 * yet — creating this model in Phase 1 only establishes the shape;
 * template-driven rendering itself is a later phase. No CRUD routes
 * exist yet either (admin template management is a later phase).
 *
 * Channel char limits below match the limits already used by
 * admin-panel's notification composer UI (PUSH:200, SMS:160,
 * EMAIL:1000, IN_APP:300) — not new numbers, just continuity with
 * work already designed there.
 *
 * Soft-delete idiom matches Chair.js/Service.js/Category.js: never
 * hard-delete, uniqueness enforced only among isDeleted:false docs.
 */

import mongoose from "mongoose";
import { NOTIFICATION_CATEGORY_VALUES } from "../../../constants/notification.constants.js";

const NotificationTemplateSchema = new mongoose.Schema(
  {
    // Permanent key identifying the event this template renders for
    // (e.g. "BOOKING_CONFIRMED", "WALLET_CREDITED"). Never renamed
    // once in use — callers reference it by this string.
    templateKey: {
      type:      String,
      required:  true,
      trim:      true,
      uppercase: true,
      match:     /^[A-Z0-9_]+$/,
    },

    category: {
      type:     String,
      enum:     NOTIFICATION_CATEGORY_VALUES,
      required: true,
      index:    true,
    },

    // Reserved for future multilingual templates (e.g. "en","hi",
    // "mr","ta","te","bn"). No translation, language selection, or
    // rendering logic reads this yet — schema future-readiness only.
    language: {
      type:    String,
      default: "en",
    },

    // Per-channel content. Plain nested objects (not sub-documents
    // with their own _id) — same nesting style as models/Salon.js's
    // basicInfo/media/timings. A template may leave any channel
    // block unset if it doesn't need that channel.
    channels: {
      IN_APP: {
        title: { type: String, trim: true, maxlength: 100, default: null },
        body:  { type: String, trim: true, maxlength: 300, default: null },
      },
      PUSH: {
        title: { type: String, trim: true, maxlength: 65,  default: null },
        body:  { type: String, trim: true, maxlength: 200, default: null },
      },
      SMS: {
        body: { type: String, trim: true, maxlength: 160, default: null },
      },
      EMAIL: {
        subject:  { type: String, trim: true, maxlength: 150,  default: null },
        bodyHtml: { type: String, trim: true, maxlength: 1000, default: null },
      },
      WHATSAPP: {
        body: { type: String, trim: true, maxlength: 1000, default: null },
      },
    },

    // Declared placeholder names for validation (e.g.
    // ["customerName","salonName","time"]) — enforced by the
    // template-rendering service in a later phase, not here.
    variables: {
      type:    [String],
      default: [],
    },

    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
    },

    isDeleted: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    // Bumped on real content edits — cache-invalidation signal,
    // same idiom as models/Category.js's own `version` field.
    version: {
      type:    Number,
      default: 1,
    },
  },
  { timestamps: true }
);

// Soft-delete-safe uniqueness — same idiom as Chair.js/Service.js.
NotificationTemplateSchema.index(
  { templateKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

NotificationTemplateSchema.index({ category: 1, isActive: 1, isDeleted: 1 });

export default
  mongoose.models.NotificationTemplate ||
  mongoose.model("NotificationTemplate", NotificationTemplateSchema);
