/**
 * BARBER ENGINE V1
 * backend/services/adminNotifications.service.js
 *
 * STEP 8.1B — Admin Notification APIs. Backend-only admin layer on
 * top of the ALREADY-REAL Notification Engine (see STEP 8.1A's own
 * read-only audit — verdict PARTIALLY BUILT: a real multi-channel
 * delivery engine exists, but nothing admin-facing sat on top of it).
 *
 * REUSE-ONLY, per the ticket's own explicit rule — every model/
 * service this file touches already existed before this ticket:
 *   - services/NotificationService.js        (send() — untouched, called not copied)
 *   - models/Notification.js                  (read + populated, never written directly)
 *   - modules/notifications/models/NotificationDeliveryLog.js (read + the one
 *     retry write, using the SAME fields/semantics as
 *     modules/notifications/jobs/notificationRetry.job.js — see retryAdminNotificationDelivery)
 *   - modules/notifications/models/NotificationTemplate.js (read + create)
 *   - modules/notifications/services/templateRenderer.service.js (clearTemplateCache reuse)
 *   - modules/notifications/providers/PushProvider.js (the SAME provider the
 *     real retry job calls — no new provider, no new dispatch path)
 * No new model. No new provider. No duplicate of NotificationService's
 * own send() logic — every notification created by this file's
 * sendAdminNotification() goes through NotificationService.send()
 * exactly like every other one of the ~18 existing call sites.
 *
 * SCOPE DECISIONS (disclosed here since the ticket doesn't spell them
 * out — same "small/mechanical, proceed + disclose" discipline used
 * throughout this engagement rather than an AskUserQuestion stop):
 *
 * 1. POST /send is a targeted admin send to an explicit list of
 *    recipients (max 50 per call), NOT the bulk-audience/scheduled
 *    broadcast the existing (unwired) NotificationsPage.jsx composer
 *    UI implies (ALL_USERS/STATE targets, scheduledAt). That bulk-
 *    broadcast feature needs its own audience-resolution + scheduling
 *    infrastructure that does not exist anywhere in this codebase
 *    today (no BroadcastJob/ScheduledNotification model) — building
 *    it would mean inventing new infrastructure, which the ticket's
 *    own "reuse ONLY the existing infrastructure" rule forbids. This
 *    file gives the admin layer a real, working dispatch primitive
 *    (one or many explicit recipients, right now); wiring a bulk
 *    scheduler on top is future work, not this ticket.
 *
 * 2. POST /send's real per-channel delivery outcome is NOT returned
 *    synchronously beyond "was the in-app Notification created" —
 *    because NotificationService.send() itself doesn't return
 *    per-channel results to its caller (it only writes them to
 *    NotificationDeliveryLog — see that file's own comments). This
 *    service reflects that honestly rather than fabricating a
 *    per-channel status the underlying call never gives it. The
 *    caller can immediately cross-check real per-channel outcomes via
 *    GET /api/admin/notifications?notificationId=<id>.
 *
 * 3. retryAdminNotificationDelivery() only accepts a FAILED PUSH
 *    delivery row — exactly the scope notificationRetry.job.js itself
 *    documents ("Scope: PUSH channel only. IN_APP is written
 *    synchronously ... SMS/EMAIL/WHATSAPP are still PENDING-
 *    placeholder-only channels"). This function does NOT import that
 *    job's private `_internal` (its own header says "never imported
 *    by any route/controller") — it re-implements the identical
 *    claim -> PushProvider.send() -> status update sequence, reading
 *    the exact same fields (attemptCount/nextRetryAt/processingStartedAt/
 *    lastError) the job itself established, so a manual admin retry
 *    and the background job's own automatic retry are indistinguishable
 *    in the data they leave behind.
 *
 * 4. Admin-level gating: GET endpoints (list notifications, list
 *    templates) allow INDIA/STATE/DISTRICT, matching every other
 *    admin read endpoint in this codebase. The 3 mutating endpoints
 *    (send/retry/create-template) are INDIA-only: recipientType/
 *    recipientId on Notification/NotificationDeliveryLog carry no
 *    stateRef/districtRef of their own to scope-check against (unlike
 *    User/Salon), so a STATE/DISTRICT admin's write here cannot be
 *    safely bounded to their own territory — same reasoning already
 *    used for this codebase's other territory-unscopable admin writes
 *    (e.g. app.js's own "/admin/finance/territory-settings" — INDIA-only).
 */

import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import NotificationDeliveryLog from "../modules/notifications/models/NotificationDeliveryLog.js";
import NotificationTemplate from "../modules/notifications/models/NotificationTemplate.js";
import NotificationService from "../services/NotificationService.js";
import PushProvider from "../modules/notifications/providers/PushProvider.js";
import { clearTemplateCache } from "../modules/notifications/services/templateRenderer.service.js";
import { DELIVERY_STATUS, NOTIFICATION_CHANNEL } from "../constants/notification.constants.js";
import { Errors } from "../utils/response.js";

// Mirrors notificationRetry.job.js's own MAX_ATTEMPTS_BEFORE_FAILED
// exactly (that file does not export it as a standalone constant —
// only via its own `_internal`, which this file deliberately does not
// import — see this file's own header, point 3).
const MAX_ATTEMPTS_BEFORE_FAILED = 5;

//////////////////////////////////////////////////////////////
// GET /api/admin/notifications — delivery ledger / oversight view.
// Reads NotificationDeliveryLog (the model's own header calls this
// "the multi-channel delivery ledger ... admin drill-down") joined to
// its parent Notification for content. No new model, no aggregation
// beyond a populate.
//////////////////////////////////////////////////////////////
export const listAdminNotifications = async ({ query }) => {
  const {
    page, limit, channel, status, recipientType, recipientId, notificationId, sortOrder,
  } = query;

  const filter = {};
  if (channel !== "ALL")        filter.channel = channel;
  if (status !== "ALL")         filter.status = status;
  if (recipientType !== "ALL")  filter.recipientType = recipientType;
  if (recipientId)              filter.recipientId = new mongoose.Types.ObjectId(recipientId);
  if (notificationId)           filter.notificationId = new mongoose.Types.ObjectId(notificationId);

  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    NotificationDeliveryLog.find(filter)
      .populate({
        path: "notificationId",
        select: "title message type priority recipientType recipientId isRead actionType actionUrl entityType entityId createdAt",
      })
      .sort({ createdAt: sortOrder === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NotificationDeliveryLog.countDocuments(filter),
  ]);

  const data = rows.map((row) => {
    const notif = row.notificationId && typeof row.notificationId === "object" ? row.notificationId : null;
    return {
      id: row._id,
      channel: row.channel,
      status: row.status,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      attemptCount: row.attemptCount ?? 0,
      lastError: row.lastError ?? null,
      recipient: { type: row.recipientType, id: row.recipientId },
      sentAt: row.sentAt ?? null,
      deliveredAt: row.deliveredAt ?? null,
      openedAt: row.openedAt ?? null,
      clickedAt: row.clickedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      notification: notif
        ? {
            id: notif._id,
            title: notif.title,
            message: notif.message,
            type: notif.type,
            priority: notif.priority,
            isRead: notif.isRead,
            actionType: notif.actionType ?? null,
            actionUrl: notif.actionUrl ?? null,
            entityType: notif.entityType ?? null,
            entityId: notif.entityId ?? null,
            createdAt: notif.createdAt,
          }
        : null,
    };
  });

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

//////////////////////////////////////////////////////////////
// POST /api/admin/notifications/send — thin orchestration over the
// SAME NotificationService.send() every other caller in the codebase
// uses. One call per recipient (NotificationService's own public
// contract is single-recipient — see its header), looped here.
//////////////////////////////////////////////////////////////
export const sendAdminNotification = async ({ body }) => {
  const {
    recipients, channels, templateKey, variables,
    title, message, type, priority,
    actionType, actionUrl, entityType, entityId,
  } = body;

  const results = [];
  for (const recipient of recipients) {
    const payload = {
      recipientType: recipient.recipientType,
      recipientId: recipient.recipientId,
      title,
      message,
      templateKey,
      variables,
      type,
      priority,
      actionType,
      actionUrl,
      entityType,
      entityId,
    };

    // NotificationService.send() never throws (see its own header) —
    // no try/catch needed to keep this loop from aborting early.
    const notification = await NotificationService.send(payload, channels);

    results.push({
      recipientType: recipient.recipientType,
      recipientId: recipient.recipientId,
      delivered: Boolean(notification),
      notificationId: notification ? notification._id : null,
    });
  }

  const sent = results.filter((r) => r.delivered).length;

  return {
    requested: recipients.length,
    channels,
    sent,
    failed: recipients.length - sent,
    results,
  };
};

//////////////////////////////////////////////////////////////
// POST /api/admin/notifications/retry/:id — manual retry of one
// FAILED PUSH NotificationDeliveryLog row. Same claim -> dispatch ->
// status-update sequence as notificationRetry.job.js's own
// claimOneFailedDelivery()/retryClaimedDelivery() (see this file's
// header, point 3) — re-implemented here rather than imported, scoped
// to the one row the admin named instead of the job's own batch scan.
//////////////////////////////////////////////////////////////
export const retryAdminNotificationDelivery = async ({ id }) => {
  const now = new Date();

  // Atomic claim, scoped to this one _id — same multi-instance-safety
  // guarantee as the job's own findOneAndUpdate claim step.
  const claimed = await NotificationDeliveryLog.findOneAndUpdate(
    {
      _id: id,
      channel: NOTIFICATION_CHANNEL.PUSH,
      status: DELIVERY_STATUS.FAILED,
      attemptCount: { $lt: MAX_ATTEMPTS_BEFORE_FAILED },
    },
    { $set: { processingStartedAt: now } },
    { new: true }
  );

  if (!claimed) {
    // Distinguish "doesn't exist" from "exists but isn't retryable"
    // so the admin gets an honest reason, not a generic 404.
    const existing = await NotificationDeliveryLog.findById(id).lean();
    if (!existing) throw Errors.notFound("Notification delivery log not found");
    if (existing.channel !== NOTIFICATION_CHANNEL.PUSH) {
      throw Errors.badRequest(
        `Only PUSH deliveries can be retried through this endpoint (this row is ${existing.channel} — IN_APP is written synchronously and never fails retryably, SMS/EMAIL/WHATSAPP are still PENDING-placeholder-only channels)`
      );
    }
    if (existing.status === DELIVERY_STATUS.FAILED_PERMANENT) {
      throw Errors.badRequest("This delivery already exhausted its retry attempts (FAILED_PERMANENT) and cannot be retried again");
    }
    throw Errors.badRequest(`Only FAILED deliveries can be retried (current status: ${existing.status})`);
  }

  if (!claimed.notificationId) {
    await NotificationDeliveryLog.updateOne(
      { _id: claimed._id },
      { $set: { status: DELIVERY_STATUS.FAILED_PERMANENT, lastError: "NO_NOTIFICATION_REFERENCE", processingStartedAt: null } }
    );
    return { id: claimed._id, previousStatus: DELIVERY_STATUS.FAILED, newStatus: DELIVERY_STATUS.FAILED_PERMANENT, success: false, error: "NO_NOTIFICATION_REFERENCE" };
  }

  const notification = await Notification.findById(claimed.notificationId).lean();
  if (!notification) {
    await NotificationDeliveryLog.updateOne(
      { _id: claimed._id },
      { $set: { status: DELIVERY_STATUS.FAILED_PERMANENT, lastError: "NOTIFICATION_NOT_FOUND", processingStartedAt: null } }
    );
    return { id: claimed._id, previousStatus: DELIVERY_STATUS.FAILED, newStatus: DELIVERY_STATUS.FAILED_PERMANENT, success: false, error: "NOTIFICATION_NOT_FOUND" };
  }

  // The SAME PushProvider the job itself calls — no new dispatch path.
  const pushResult = await PushProvider.send({
    recipientType: claimed.recipientType,
    recipientId: claimed.recipientId,
    title: notification.title,
    message: notification.message,
    actionType: notification.actionType,
    actionUrl: notification.actionUrl,
    entityType: notification.entityType,
    entityId: notification.entityId,
  });

  if (pushResult.success) {
    await NotificationDeliveryLog.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: DELIVERY_STATUS.SENT,
          provider: pushResult.provider ?? null,
          providerMessageId: pushResult.messageId ?? null,
          sentAt: new Date(),
          lastError: null,
          processingStartedAt: null,
        },
      }
    );
    return {
      id: claimed._id, previousStatus: DELIVERY_STATUS.FAILED, newStatus: DELIVERY_STATUS.SENT,
      success: true, provider: pushResult.provider ?? null, providerMessageId: pushResult.messageId ?? null,
    };
  }

  const nextAttemptCount = claimed.attemptCount + 1;
  const nextStatus = nextAttemptCount >= MAX_ATTEMPTS_BEFORE_FAILED
    ? DELIVERY_STATUS.FAILED_PERMANENT
    : DELIVERY_STATUS.FAILED;

  await NotificationDeliveryLog.updateOne(
    { _id: claimed._id },
    {
      $set: {
        status: nextStatus,
        attemptCount: nextAttemptCount,
        lastError: pushResult.error || "PUSH_RETRY_FAILED",
        processingStartedAt: null,
      },
    }
  );

  return {
    id: claimed._id, previousStatus: DELIVERY_STATUS.FAILED, newStatus: nextStatus,
    success: false, attemptCount: nextAttemptCount, error: pushResult.error || "PUSH_RETRY_FAILED",
  };
};

//////////////////////////////////////////////////////////////
// GET /api/admin/notifications/templates — real NotificationTemplate
// model, no calculation.
//////////////////////////////////////////////////////////////
export const listAdminNotificationTemplates = async ({ query }) => {
  const { page, limit, category, isActive, search } = query;

  const filter = { isDeleted: false };
  if (category !== "ALL") filter.category = category;
  if (isActive !== "ALL") filter.isActive = isActive === "true";
  if (search?.trim()) filter.templateKey = { $regex: search.trim(), $options: "i" };

  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    NotificationTemplate.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    NotificationTemplate.countDocuments(filter),
  ]);

  const data = rows.map((t) => ({
    id: t._id,
    templateKey: t.templateKey,
    category: t.category,
    language: t.language,
    channels: t.channels,
    variables: t.variables,
    isActive: t.isActive,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

//////////////////////////////////////////////////////////////
// POST /api/admin/notifications/templates — real NotificationTemplate
// model. Soft-delete-safe uniqueness is enforced by the model's own
// partial index; this pre-check just turns a duplicate-key error into
// a clean 409 instead of a raw Mongo error.
//////////////////////////////////////////////////////////////
export const createAdminNotificationTemplate = async ({ body }) => {
  const existing = await NotificationTemplate.findOne({
    templateKey: body.templateKey,
    isDeleted: false,
  }).lean();
  if (existing) {
    throw Errors.conflict(`A template with key "${body.templateKey}" already exists`);
  }

  const created = await NotificationTemplate.create(body);

  // Real reuse of templateRenderer.service.js's own cache-invalidation
  // export — a template created here is picked up by the very next
  // send() that references its templateKey instead of waiting out the
  // renderer's 5-minute negative-cache TTL (see that file's header).
  clearTemplateCache(created.templateKey);

  return {
    id: created._id,
    templateKey: created.templateKey,
    category: created.category,
    language: created.language,
    channels: created.channels,
    variables: created.variables,
    isActive: created.isActive,
    version: created.version,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
};
