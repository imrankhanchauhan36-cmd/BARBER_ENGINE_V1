import mongoose from "mongoose";
import Notification from "../models/Notification.js";

//////////////////////////////////////////////////////
// HELPER — VALIDATE OBJECT ID
//////////////////////////////////////////////////////

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

//////////////////////////////////////////////////////
// SELECTED FIELDS — keep list payload lean
//////////////////////////////////////////////////////

const LIST_PROJECTION =
  "title message type priority isRead readAt actionType actionUrl meta createdAt";

//////////////////////////////////////////////////////
// GET UNREAD COUNT — lightweight, for header/badge polling
//////////////////////////////////////////////////////

export const getUnreadNotificationCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const unreadCount = await Notification.countDocuments({
      recipientId:   userId,
      recipientType: "USER",
      isRead:        false,
      isArchived:    false,
    });

    return res.status(200).json({ success: true, data: { unreadCount } });
  } catch (err) {
    console.error("[NotificationController] getUnreadNotificationCount:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch unread count" });
  }
};

//////////////////////////////////////////////////////
// GET USER NOTIFICATIONS (with pagination)
//////////////////////////////////////////////////////

export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip  = (page - 1) * limit;

    const filter = {
      recipientId:   userId,
      recipientType: "USER",
      isArchived:    false,
    };

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter)
        .select(LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Notification.countDocuments({
        recipientId:   userId,
        recipientType: "USER",
        isRead:        false,
        isArchived:    false,
      }),

      Notification.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore:    page * limit < total,
        },
      },
    });
  } catch (err) {
    console.error("[NotificationController] getUserNotifications:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

//////////////////////////////////////////////////////
// MARK ALL AS READ
//////////////////////////////////////////////////////

export const markAllUserNotificationsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      {
        recipientId:   userId,
        recipientType: "USER",
        isRead:        false,
        isArchived:    false,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: "All marked as read",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (err) {
    console.error("[NotificationController] markAllUserNotificationsRead:", err);
    return res.status(500).json({ success: false, message: "Failed" });
  }
};

//////////////////////////////////////////////////////
// MARK ONE AS READ — with ownership validation
//////////////////////////////////////////////////////

export const markOneUserNotificationRead = async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user._id;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const updated = await Notification.findOneAndUpdate(
      {
        _id:           id,
        recipientId:   userId,
        recipientType: "USER",
        isArchived:    false,
      },
      [
        {
          $set: {
            isRead: true,
            readAt: { $cond: [{ $eq: ["$isRead", true] }, "$readAt", new Date()] },
          },
        },
      ],
      { new: true }
    ).select(LIST_PROJECTION);

    if (!updated) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("[NotificationController] markOneUserNotificationRead:", err);
    return res.status(500).json({ success: false, message: "Failed" });
  }
};

//////////////////////////////////////////////////////
// DELETE ONE — soft delete (archive), with ownership validation
//////////////////////////////////////////////////////

export const deleteUserNotification = async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user._id;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const updated = await Notification.findOneAndUpdate(
      {
        _id:           id,
        recipientId:   userId,
        recipientType: "USER",
      },
      [
        {
          $set: {
            isArchived: true,
            archivedAt: { $cond: [{ $eq: ["$isArchived", true] }, "$archivedAt", new Date()] },
          },
        },
      ],
      { new: true }
    ).select(LIST_PROJECTION);

    if (!updated) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, message: "Notification deleted", data: updated });
  } catch (err) {
    console.error("[NotificationController] deleteUserNotification:", err);
    return res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

//////////////////////////////////////////////////////
// CLEAR ALL — Soft delete (archive)
//////////////////////////////////////////////////////

export const clearAllUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      {
        recipientId:   userId,
        recipientType: "USER",
        isArchived:    false,
      },
      { $set: { isArchived: true, archivedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications cleared",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (err) {
    console.error("[NotificationController] clearAllUserNotifications:", err);
    return res.status(500).json({ success: false, message: "Failed to clear" });
  }
};
