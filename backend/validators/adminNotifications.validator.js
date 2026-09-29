/**
 * BARBER ENGINE V1
 * backend/validators/adminNotifications.validator.js
 *
 * STEP 8.1B — Admin Notification APIs. Validation only — no business
 * logic. `.unknown(false)` per this project's standing convention,
 * mirroring adminCustomerReviews.validator.js / adminCustomerWallet.
 * validator.js exactly.
 *
 * Enum sources — two DIFFERENT enum families are in play here, on
 * purpose (see services/adminNotifications.service.js's own header
 * for the full rationale):
 *   - `channels[]` on the send body validates against
 *     NOTIFICATION_CHANNEL_VALUES (constants/notification.constants.js)
 *     — the real channel list NotificationService.send() accepts.
 *   - `type`/`priority`/`actionType`/`entityType` on the send body
 *     validate against models/Notification.js's OWN enums (copied
 *     here verbatim, not imported from notification.constants.js,
 *     because that file's own comment says those enums are
 *     deliberately NOT redefined there — models/Notification.js is
 *     the single source of truth for them).
 *   - `category` on the template schemas validates against
 *     NOTIFICATION_CATEGORY_VALUES — the real enum
 *     modules/notifications/models/NotificationTemplate.js itself
 *     uses for that field.
 */

import Joi from "joi";
import {
  NOTIFICATION_CHANNEL_VALUES,
  DELIVERY_STATUS_VALUES,
  NOTIFICATION_CATEGORY_VALUES,
} from "../constants/notification.constants.js";

const objectId = Joi.string().hex().length(24);

// Verbatim copy of models/Notification.js's own enums — see header.
const NOTIFICATION_RECIPIENT_TYPES = ["USER", "SALON", "ADMIN", "STAFF", "FIELD_AGENT"];
const NOTIFICATION_TYPE_VALUES     = ["BOOKING", "PAYMENT", "SYSTEM", "REVIEW", "PROMOTION"];
const NOTIFICATION_PRIORITY_VALUES_LEGACY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]; // Notification.priority, NOT NOTIFICATION_PRIORITY
const NOTIFICATION_ACTION_TYPES    = ["OPEN_BOOKING", "OPEN_WALLET", "OPEN_PROFILE", "OPEN_SALON", "OPEN_REVIEW", "OPEN_HOME"];
const NOTIFICATION_ENTITY_TYPES    = ["BOOKING", "PAYMENT", "WALLET", "SALON", "REVIEW", "SYSTEM"];

const pageLimit = {
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

export const adminNotificationsSchemas = {
  // GET /api/admin/notifications
  listQuery: Joi.object({
    ...pageLimit,
    channel:       Joi.string().valid(...NOTIFICATION_CHANNEL_VALUES, "ALL").default("ALL"),
    status:        Joi.string().valid(...DELIVERY_STATUS_VALUES, "ALL").default("ALL"),
    recipientType: Joi.string().valid(...NOTIFICATION_RECIPIENT_TYPES, "ALL").default("ALL"),
    recipientId:   objectId.optional(),
    notificationId: objectId.optional(),
    sortOrder:     Joi.string().valid("asc", "desc").default("desc"),
  }).unknown(false),

  // POST /api/admin/notifications/send
  sendBody: Joi.object({
    recipients: Joi.array()
      .items(
        Joi.object({
          recipientType: Joi.string().valid(...NOTIFICATION_RECIPIENT_TYPES).required(),
          recipientId:   objectId.required(),
        }).unknown(false)
      )
      .min(1)
      .max(50) // manual admin send, not a bulk-broadcast tool — see service header
      .required(),
    channels: Joi.array()
      .items(Joi.string().valid(...NOTIFICATION_CHANNEL_VALUES))
      .min(1)
      .default(["IN_APP"]),
    templateKey: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]+$/).optional(),
    variables:   Joi.object().optional(),
    title:       Joi.string().trim().max(100),
    message:     Joi.string().trim().max(300),
    type:        Joi.string().valid(...NOTIFICATION_TYPE_VALUES).default("SYSTEM"),
    priority:    Joi.string().valid(...NOTIFICATION_PRIORITY_VALUES_LEGACY).default("MEDIUM"),
    actionType:  Joi.string().valid(...NOTIFICATION_ACTION_TYPES).allow(null).default(null),
    actionUrl:   Joi.string().trim().allow(null).default(null),
    entityType:  Joi.string().valid(...NOTIFICATION_ENTITY_TYPES).allow(null).default(null),
    entityId:    objectId.allow(null).default(null),
  })
    .unknown(false)
    .custom((value, helpers) => {
      if (!value.templateKey && !(value.title && value.message)) {
        return helpers.message("Provide either templateKey (+ optional variables) or both title and message");
      }
      return value;
    }, "templateKey-or-title+message required"),

  // POST /api/admin/notifications/retry/:id
  retryParams: Joi.object({
    id: objectId.required(),
  }).unknown(false),

  // GET /api/admin/notifications/templates
  templateListQuery: Joi.object({
    ...pageLimit,
    category: Joi.string().valid(...NOTIFICATION_CATEGORY_VALUES, "ALL").default("ALL"),
    isActive: Joi.string().valid("true", "false", "ALL").default("ALL"),
    search:   Joi.string().trim().max(60).allow(""),
  }).unknown(false),

  // POST /api/admin/notifications/templates
  templateCreateBody: Joi.object({
    templateKey: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]+$/).required(),
    category:    Joi.string().valid(...NOTIFICATION_CATEGORY_VALUES).required(),
    language:    Joi.string().trim().lowercase().max(5).default("en"),
    channels: Joi.object({
      IN_APP: Joi.object({
        title: Joi.string().trim().max(100).allow(null),
        body:  Joi.string().trim().max(300).allow(null),
      }).unknown(false),
      PUSH: Joi.object({
        title: Joi.string().trim().max(65).allow(null),
        body:  Joi.string().trim().max(200).allow(null),
      }).unknown(false),
      SMS: Joi.object({
        body: Joi.string().trim().max(160).allow(null),
      }).unknown(false),
      EMAIL: Joi.object({
        subject:  Joi.string().trim().max(150).allow(null),
        bodyHtml: Joi.string().trim().max(1000).allow(null),
      }).unknown(false),
      WHATSAPP: Joi.object({
        body: Joi.string().trim().max(1000).allow(null),
      }).unknown(false),
    })
      .unknown(false)
      .min(1)
      .required(),
    variables: Joi.array().items(Joi.string().trim()).default([]),
    isActive:  Joi.boolean().default(true),
  }).unknown(false),
};
