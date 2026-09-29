/**
 * BARBER ENGINE V1
 * backend/routes/adminNotifications.routes.js
 *
 * STEP 8.1B — Admin Notification APIs. Mounted at its own full-literal
 * prefix, /api/admin/notifications, in app.js — BEFORE the general
 * app.use("/api/admin", protect, adminRoutes) mount, same defensive
 * ordering already used for /api/admin/users/:id/wallet etc. Confirmed
 * via grep (app.js) that no existing route already uses this prefix —
 * the only other "notifications" mounts are /api/notifications*
 * (owner/field-agent inbox, a completely different prefix) and
 * /api/user/notifications* — neither collides.
 *
 * `protect` is applied at the app.js mount level, same as every
 * sibling admin route file. requireAdminLevel gating:
 *   - GET  /              -> INDIA, STATE, DISTRICT (read)
 *   - POST /send          -> INDIA only (see service file header, point 4)
 *   - POST /retry/:id     -> INDIA only (same reasoning)
 *   - GET  /templates     -> INDIA, STATE, DISTRICT (read)
 *   - POST /templates     -> INDIA only (same reasoning)
 *
 * No mergeParams needed — :id (on /retry/:id) lives in this router's
 * own internal path, not in the app.js mount string.
 */

import express from "express";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { validate } from "../middlewares/validate.middleware.js";
import { adminNotificationsSchemas } from "../validators/adminNotifications.validator.js";
import {
  listAdminNotificationsHandler,
  sendAdminNotificationHandler,
  retryAdminNotificationHandler,
  listAdminNotificationTemplatesHandler,
  createAdminNotificationTemplateHandler,
} from "../controllers/adminNotifications.controller.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE", "DISTRICT"];
const WRITE_LEVELS = ["INDIA"];

router.get(
  "/",
  requireAdminLevel(...READ_LEVELS),
  validate(adminNotificationsSchemas.listQuery, "query"),
  listAdminNotificationsHandler
);

router.post(
  "/send",
  requireAdminLevel(...WRITE_LEVELS),
  validate(adminNotificationsSchemas.sendBody, "body"),
  sendAdminNotificationHandler
);

router.post(
  "/retry/:id",
  requireAdminLevel(...WRITE_LEVELS),
  validate(adminNotificationsSchemas.retryParams, "params"),
  retryAdminNotificationHandler
);

router.get(
  "/templates",
  requireAdminLevel(...READ_LEVELS),
  validate(adminNotificationsSchemas.templateListQuery, "query"),
  listAdminNotificationTemplatesHandler
);

router.post(
  "/templates",
  requireAdminLevel(...WRITE_LEVELS),
  validate(adminNotificationsSchemas.templateCreateBody, "body"),
  createAdminNotificationTemplateHandler
);

export default router;
