import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import Salon from "../models/Salon.js";

//////////////////////////////////////////////////////
// HELPER — GET SALON BY OWNER (reusable)
//////////////////////////////////////////////////////

const getSalonByOwner = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId }).select("_id").lean();
  if (!salon) throw new Error("SALON_NOT_FOUND");
  return salon;
};

//////////////////////////////////////////////////////
// HELPER — VALIDATE OBJECT ID
//////////////////////////////////////////////////////

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

//////////////////////////////////////////////////////
// GET ALL NOTIFICATIONS (with pagination)
//////////////////////////////////////////////////////

export const getNotifications = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon   = await getSalonByOwner(ownerId);

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const filter = {
      recipientId:   salon._id,
      recipientType: "SALON",
      isArchived:    false,
    };

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Notification.countDocuments({
        recipientId:   salon._id,
        recipientType: "SALON",
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
    if (err.message === "SALON_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

//////////////////////////////////////////////////////
// MARK ALL AS READ
//////////////////////////////////////////////////////

export const markAllRead = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon   = await getSalonByOwner(ownerId);

    await Notification.updateMany(
      {
        recipientId:   salon._id,
        recipientType: "SALON",
        isRead:        false,
        isArchived:    false,
      },
      { $set: { isRead: true } }
    );

    return res.status(200).json({ success: true, message: "All marked as read" });
  } catch (err) {
    if (err.message === "SALON_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed" });
  }
};

//////////////////////////////////////////////////////
// MARK ONE AS READ — with ownership validation
//////////////////////////////////////////////////////

export const markOneRead = async (req, res) => {
  try {
    const { id }  = req.params;
    const ownerId = req.user?._id;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const salon = await getSalonByOwner(ownerId);

    const updated = await Notification.findOneAndUpdate(
      {
        _id:           id,
        recipientId:   salon._id,
        recipientType: "SALON",
      },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    if (err.message === "SALON_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed" });
  }
};

//////////////////////////////////////////////////////
// CLEAR ALL — Soft delete (archive)
//////////////////////////////////////////////////////

export const clearAllNotifications = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon   = await getSalonByOwner(ownerId);

    await Notification.updateMany(
      {
        recipientId:   salon._id,
        recipientType: "SALON",
        isArchived:    false,
      },
      { $set: { isArchived: true } }
    );

    return res.status(200).json({ success: true, message: "All notifications cleared" });
  } catch (err) {
    if (err.message === "SALON_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to clear" });
  }
};

//////////////////////////////////////////////////////
// CREATE NOTIFICATION — Internal helper
// Returns created document for websocket/push use
//////////////////////////////////////////////////////

export const createNotification = async ({
  recipientId,
  recipientType = "SALON",
  title,
  message,
  type      = "SYSTEM",
  priority  = "MEDIUM",
  meta      = {},
  actionType = null,
  actionUrl  = null,
}) => {
  try {
    const notification = await Notification.create({
      recipientId,
      recipientType,
      title,
      message,
      type,
      priority,
      meta,
      actionType,
      actionUrl,
    });
    return notification;
  } catch (err) {
    console.warn("NOTIFICATION_CREATE_ERROR:", err.message);
    return null;
  }
};