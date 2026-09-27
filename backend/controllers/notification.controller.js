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
// HELPER — RESOLVE RECIPIENT (FA-P2-A)
//
// Every handler below used to be OWNER-only (always calling
// getSalonByOwner). This is now the single place that branches by
// req.user.role — the OWNER branch is byte-for-byte the original
// behavior (same query, same "SALON_NOT_FOUND" error), so an OWNER
// request is completely unaffected. FIELD_AGENT is a new, additive
// branch: recipientId is the Field Agent's own User._id (not a
// FieldAgent document — see models/Notification.js's own comment for
// why), which exists from first OTP verification onward, so this
// works identically at every stage (applicant or operational).
//////////////////////////////////////////////////////

const resolveRecipient = async (user) => {
  if (user?.role === "FIELD_AGENT") {
    return { recipientType: "FIELD_AGENT", recipientId: user._id };
  }
  const salon = await getSalonByOwner(user?._id);
  return { recipientType: "SALON", recipientId: salon._id };
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
    const { recipientType, recipientId } = await resolveRecipient(req.user);

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const filter = {
      recipientId,
      recipientType,
      isArchived:    false,
    };

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Notification.countDocuments({
        recipientId,
        recipientType,
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
    const { recipientType, recipientId } = await resolveRecipient(req.user);

    await Notification.updateMany(
      {
        recipientId,
        recipientType,
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
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const { recipientType, recipientId } = await resolveRecipient(req.user);

    const updated = await Notification.findOneAndUpdate(
      {
        _id:           id,
        recipientId,
        recipientType,
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
    const { recipientType, recipientId } = await resolveRecipient(req.user);

    await Notification.updateMany(
      {
        recipientId,
        recipientType,
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
  // FA-P2-A — the Notification model has carried entityType/entityId
  // since it was created, but no caller ever threaded them through
  // this function, so they were silently dropped on every existing
  // notification. Purely additive: both default to null (Mongoose's
  // own schema default), so any existing caller that never passes
  // them sees byte-identical behavior.
  entityType = null,
  entityId   = null,
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
      entityType,
      entityId,
    });
    return notification;
  } catch (err) {
    console.warn("NOTIFICATION_CREATE_ERROR:", err.message);
    return null;
  }
};