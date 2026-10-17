import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import Salon from "../models/Salon.js";

//////////////////////////////////////////////////////
// HELPER — GET SALON BY OWNER (reusable)
//////////////////////////////////////////////////////

// MULTI-SALON NOTIFICATION VISIBILITY — explicit salonId. Same
// resolver and rationale as controllers/deviceToken.controller.js's
// own getSalonByOwner (that file's header has the full explanation):
// an unscoped Salon.findOne({ownerId}) could resolve to the wrong one
// of an owner's salons, making "My Notifications" (and mark-read/
// clear-all, which share this same helper) silently show or mutate
// the wrong salon's notifications. salonId absent is safe only when
// the owner has exactly one real, APPROVED salon; two or more fails
// closed with SALON_AMBIGUOUS instead of guessing.
const getSalonByOwner = async (ownerId, salonId) => {
  if (salonId) {
    if (!mongoose.Types.ObjectId.isValid(salonId)) throw new Error("SALON_NOT_FOUND");
    const salon = await Salon.findOne({ _id: salonId, ownerId, isDeleted: false }).select("_id").lean();
    if (!salon) throw new Error("SALON_NOT_FOUND");
    return salon;
  }
  const candidates = await Salon.find({
    ownerId,
    isDeleted: false,
    "approval.status": "APPROVED",
  }).select("_id").limit(2).lean();
  if (candidates.length === 0) throw new Error("SALON_NOT_FOUND");
  if (candidates.length > 1) throw new Error("SALON_AMBIGUOUS");
  return candidates[0];
};

//////////////////////////////////////////////////////
// HELPER — RESOLVE RECIPIENT (FA-P2-A)
//
// Every handler below used to be OWNER-only (always calling
// getSalonByOwner). This is now the single place that branches by
// req.user.role — the OWNER branch is byte-for-byte the original
// behavior aside from the salonId disambiguation above, so an OWNER
// request that already has exactly one salon is completely
// unaffected. FIELD_AGENT is a new, additive branch: recipientId is
// the Field Agent's own User._id (not a FieldAgent document — see
// models/Notification.js's own comment for why), which exists from
// first OTP verification onward, so this works identically at every
// stage (applicant or operational).
//////////////////////////////////////////////////////

const resolveRecipient = async (user, salonId) => {
  if (user?.role === "FIELD_AGENT") {
    return { recipientType: "FIELD_AGENT", recipientId: user._id };
  }
  const salon = await getSalonByOwner(user?._id, salonId);
  return { recipientType: "SALON", recipientId: salon._id };
};

const salonErrorResponse = (res, err) => {
  if (err.message === "SALON_AMBIGUOUS") {
    return res.status(409).json({
      success: false,
      code: "AMBIGUOUS_SALON",
      message: "You own more than one salon. Specify salonId to select which one.",
    });
  }
  return res.status(404).json({ success: false, message: "Salon not found" });
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
    const { recipientType, recipientId } = await resolveRecipient(req.user, req.query.salonId);

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
    if (err.message === "SALON_NOT_FOUND" || err.message === "SALON_AMBIGUOUS") {
      return salonErrorResponse(res, err);
    }
    return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

//////////////////////////////////////////////////////
// MARK ALL AS READ
//////////////////////////////////////////////////////

export const markAllRead = async (req, res) => {
  try {
    const { recipientType, recipientId } = await resolveRecipient(req.user, req.body?.salonId);

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
    if (err.message === "SALON_NOT_FOUND" || err.message === "SALON_AMBIGUOUS") {
      return salonErrorResponse(res, err);
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

    const { recipientType, recipientId } = await resolveRecipient(req.user, req.body?.salonId);

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
    if (err.message === "SALON_NOT_FOUND" || err.message === "SALON_AMBIGUOUS") {
      return salonErrorResponse(res, err);
    }
    return res.status(500).json({ success: false, message: "Failed" });
  }
};

//////////////////////////////////////////////////////
// CLEAR ALL — Soft delete (archive)
//////////////////////////////////////////////////////

export const clearAllNotifications = async (req, res) => {
  try {
    const { recipientType, recipientId } = await resolveRecipient(req.user, req.body?.salonId);

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
    if (err.message === "SALON_NOT_FOUND" || err.message === "SALON_AMBIGUOUS") {
      return salonErrorResponse(res, err);
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