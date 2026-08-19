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
