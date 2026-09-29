/**
 * BARBER ENGINE V1
 * backend/controllers/adminNotifications.controller.js
 *
 * STEP 8.1B — thin controllers only. All logic lives in
 * services/adminNotifications.service.js, mirroring every sibling
 * admin controller in this codebase (adminCustomerWallet.controller.js
 * etc.).
 */

import { successResponse } from "../utils/response.js";
import {
  listAdminNotifications,
  sendAdminNotification,
  retryAdminNotificationDelivery,
  listAdminNotificationTemplates,
  createAdminNotificationTemplate,
} from "../services/adminNotifications.service.js";

export const listAdminNotificationsHandler = async (req, res, next) => {
  try {
    const result = await listAdminNotifications({ query: req.query });
    return successResponse(res, {
      message: "Notifications fetched",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return next(err);
  }
};

export const sendAdminNotificationHandler = async (req, res, next) => {
  try {
    const result = await sendAdminNotification({ body: req.body });
    return successResponse(res, {
      statusCode: 201,
      message: "Notification send request processed",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const retryAdminNotificationHandler = async (req, res, next) => {
  try {
    const result = await retryAdminNotificationDelivery({ id: req.params.id });
    return successResponse(res, { message: "Notification delivery retried", data: result });
  } catch (err) {
    return next(err);
  }
};

export const listAdminNotificationTemplatesHandler = async (req, res, next) => {
  try {
    const result = await listAdminNotificationTemplates({ query: req.query });
    return successResponse(res, {
      message: "Notification templates fetched",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return next(err);
  }
};

export const createAdminNotificationTemplateHandler = async (req, res, next) => {
  try {
    const result = await createAdminNotificationTemplate({ body: req.body });
    return successResponse(res, {
      statusCode: 201,
      message: "Notification template created",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};
