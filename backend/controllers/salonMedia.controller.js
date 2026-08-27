import mongoose from "mongoose";
import Salon from "../models/Salon.js";
import SalonMedia from "../models/SalonMedia.js";

const MIN_IMAGES = 3;
const MAX_IMAGES = 15;

/**
 * 📸 ADD SALON MEDIA
 */
export const addSalonMedia = async (req, res) => {
  try {
    const { salonId, url, type } = req.body;

    if (!salonId || !url) {
      return res.status(400).json({
        success: false,
        message: "salonId and url required",
      });
    }

    // 🔒 OWNERSHIP CHECK — the supplied salonId must belong to req.user._id.
    // Same convention as savePhotos() in salon.onboarding.controller.js.
    if (!mongoose.Types.ObjectId.isValid(salonId)) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const salon = await Salon.findOne({ _id: salonId, isDeleted: { $ne: true } })
      .select("ownerId")
      .lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    if (salon.ownerId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not your salon" });
    }

    // 🔒 MAX LIMIT CHECK
    const currentCount = await SalonMedia.countDocuments({
      salonId,
      isActive: true,
    });

    if (currentCount >= MAX_IMAGES) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_IMAGES} images allowed`,
      });
    }

    const media = await SalonMedia.create({
      salonId,
      url,
      type,
    });

    return res.json({
      success: true,
      media,
      remainingSlots: MAX_IMAGES - (currentCount + 1),
    });
  } catch (err) {
    console.error("ADD SALON MEDIA ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

/**
 * 🖼️ GET SALON MEDIA (READ-ONLY)
 */
export const getSalonMedia = async (req, res) => {
  try {
    const media = await SalonMedia.find({
      salonId: req.params.salonId,
      isActive: true,
    }).select("url type");

    return res.json({
      success: true,
      count: media.length,
      media,
    });
  } catch (err) {
    console.error("GET SALON MEDIA ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

/**
 * 🔒 CHECK MIN IMAGES (USED BEFORE SUBMIT FOR APPROVAL)
 */
export const checkMinImages = async (salonId) => {
  const count = await SalonMedia.countDocuments({
    salonId,
    isActive: true,
  });

  return count >= MIN_IMAGES;
};

/**
 * =========================================================
 * OWNER-SCOPED SALON MEDIA MANAGEMENT (Manage Gallery — Phase A)
 *
 * Separate from addSalonMedia()/getSalonMedia() above, which are
 * untouched and keep their existing consumers exactly as-is. These
 * five endpoints never accept salonId from the client — the salon
 * is always resolved from req.user._id, then every media document
 * touched is cross-checked against that resolved salon._id before
 * any read/write. Never modifies approval.*, onboarding.*, or
 * location.* — these only ever touch SalonMedia documents.
 * =========================================================
 */

const ALLOWED_MEDIA_TYPES = ["COVER", "SHOP", "WORK", "CERTIFICATE"];

const resolveOwnerSalonId = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId }).select("_id").lean();
  return salon?._id || null;
};

/**
 * GET /api/salon-media/owner
 * List the authenticated owner's own gallery.
 */
export const getMyMedia = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const salonId = await resolveOwnerSalonId(ownerId);
    if (!salonId) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const media = await SalonMedia.find({ salonId, isActive: true, isDeleted: false })
      .sort({ order: 1 })
      .select("url type order createdAt");

    return res.status(200).json({ success: true, count: media.length, media });
  } catch (err) {
    console.error("GET_MY_MEDIA_ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch gallery" });
  }
};

/**
 * POST /api/salon-media/owner
 * Add one photo to the authenticated owner's own gallery. Dedicated
 * owner-scoped sibling of addSalonMedia() — that endpoint is untouched.
 * Reuses the same MAX_IMAGES business rule addSalonMedia() already
 * enforces for this exact operation type (incremental add), rather
 * than redefining a new limit.
 */
export const addMyMedia = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { url, type } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, message: "Photo url is required" });
    }

    const cleanType = type && ALLOWED_MEDIA_TYPES.includes(type) ? type : "SHOP";

    const salonId = await resolveOwnerSalonId(ownerId);
    if (!salonId) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const currentCount = await SalonMedia.countDocuments({ salonId, isActive: true, isDeleted: false });
    if (currentCount >= MAX_IMAGES) {
      return res.status(400).json({ success: false, message: `Maximum ${MAX_IMAGES} images allowed` });
    }

    if (cleanType === "COVER") {
      const existingCover = await SalonMedia.findOne({ salonId, type: "COVER", isDeleted: false }).select("_id");
      if (existingCover) {
        return res.status(400).json({ success: false, message: "A cover photo already exists — use Set Cover to change it" });
      }
    }

    const media = await SalonMedia.create({
      salonId,
      url,
      type: cleanType,
      order: currentCount + 1,
      createdBy: ownerId,
    });

    return res.status(201).json({
      success: true,
      message: "Photo added successfully",
      data: { media, remainingSlots: MAX_IMAGES - (currentCount + 1) },
    });
  } catch (err) {
    console.error("ADD_MY_MEDIA_ERROR:", err);
    return res.status(500).json({ success: false, message: "Could not add photo" });
  }
};

/**
 * DELETE /api/salon-media/owner/:mediaId
 * Soft-delete one photo from the authenticated owner's own gallery.
 * Never hard-deletes the document — sets isDeleted/isActive only.
 */
export const deleteMyMedia = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { mediaId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(404).json({ success: false, message: "Photo not found" });
    }

    const salonId = await resolveOwnerSalonId(ownerId);
    if (!salonId) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const media = await SalonMedia.findOne({ _id: mediaId, isDeleted: false });
    if (!media) {
      return res.status(404).json({ success: false, message: "Photo not found" });
    }

    if (media.salonId?.toString() !== salonId.toString()) {
      return res.status(403).json({ success: false, message: "Not your photo" });
    }

    media.isDeleted = true;
    media.isActive = false;
    media.updatedBy = ownerId;
    await media.save();

    return res.status(200).json({ success: true, message: "Photo deleted successfully" });
  } catch (err) {
    console.error("DELETE_MY_MEDIA_ERROR:", err);
    return res.status(500).json({ success: false, message: "Could not delete photo" });
  }
};

/**
 * PATCH /api/salon-media/owner/:mediaId/cover
 * Set one of the owner's own photos as the salon's cover image.
 * Transaction-guarded (same session pattern as savePhotos() in
 * salon.onboarding.controller.js) so the unique partial index on
 * {salonId,type:"COVER",isDeleted:false} never sees two COVER docs
 * at once — the old cover is demoted to "SHOP" and the target is
 * promoted to "COVER" inside a single transaction.
 */
export const setMyCoverMedia = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ownerId = req.user?._id;
    if (!ownerId) throw Object.assign(new Error("Unauthorized"), { status: 401 });

    const { mediaId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      throw Object.assign(new Error("Photo not found"), { status: 404 });
    }

    const salon = await Salon.findOne({ ownerId }).select("_id").session(session);
    if (!salon) throw Object.assign(new Error("Salon not found"), { status: 404 });

    const target = await SalonMedia.findOne({ _id: mediaId, isDeleted: false }).session(session);
    if (!target) throw Object.assign(new Error("Photo not found"), { status: 404 });
    if (target.salonId?.toString() !== salon._id.toString()) {
      throw Object.assign(new Error("Not your photo"), { status: 403 });
    }

    if (target.type !== "COVER") {
      await SalonMedia.updateMany(
        { salonId: salon._id, type: "COVER", isDeleted: false, _id: { $ne: target._id } },
        { $set: { type: "SHOP", updatedBy: ownerId } },
        { session }
      );
      await SalonMedia.updateOne(
        { _id: target._id },
        { $set: { type: "COVER", updatedBy: ownerId } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    const updated = await SalonMedia.findById(target._id).select("url type order");

    return res.status(200).json({ success: true, message: "Cover photo updated", data: { media: updated } });
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
    } catch {}

    console.error("SET_MY_COVER_MEDIA_ERROR:", err);
    return res.status(err.status || 500).json({ success: false, message: err.message || "Could not set cover photo" });
  }
};

/**
 * PATCH /api/salon-media/owner/reorder
 * Body: { order: [mediaId, mediaId, ...] } in the desired display
 * order. Every id must already belong to the caller's own salon —
 * verified before any write. `order` is not unique-indexed on the
 * model (comment: "SORTING ONLY — NOT UNIQUE"), so a plain bulk
 * write is sufficient; no transaction is required for correctness.
 */
export const reorderMyMedia = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, message: "order must be a non-empty array of photo ids" });
    }
    if (!order.every((id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ success: false, message: "Invalid photo id in order list" });
    }

    const salonId = await resolveOwnerSalonId(ownerId);
    if (!salonId) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const owned = await SalonMedia.find({ salonId, isDeleted: false, _id: { $in: order } }).select("_id");
    const ownedIds = new Set(owned.map((m) => m._id.toString()));

    if (ownedIds.size !== order.length || !order.every((id) => ownedIds.has(id))) {
      return res.status(403).json({ success: false, message: "One or more photos do not belong to your salon" });
    }

    const bulkOps = order.map((id, index) => ({
      updateOne: {
        filter: { _id: id, salonId },
        update: { $set: { order: index + 1, updatedBy: ownerId } },
      },
    }));

    await SalonMedia.bulkWrite(bulkOps);

    const media = await SalonMedia.find({ salonId, isActive: true, isDeleted: false })
      .sort({ order: 1 })
      .select("url type order");

    return res.status(200).json({ success: true, message: "Order updated", data: { media } });
  } catch (err) {
    console.error("REORDER_MY_MEDIA_ERROR:", err);
    return res.status(500).json({ success: false, message: "Could not reorder photos" });
  }
};
