import express from "express";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { protect }    from "../middlewares/auth.middleware.js";
import { blockAdmin } from "../middlewares/blockAdmin.middleware.js";
import {
  getMe, updateMe, updateProfileLimiter, uploadProfilePhoto,
} from "../controllers/user.controller.js";
import {
  getMyBookings, getUpcomingBookings, getCompletedBookings,
} from "../controllers/booking.controller.js";

const router = express.Router();

// memoryStorage — file buffer in RAM, upload to Cloudinary manually
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(protect);
router.use(blockAdmin);

router.get("/me",    getMe);
router.put("/me",    updateProfileLimiter, updateMe);

router.post("/me/photo", upload.single("photo"), async (req, res, next) => {
  try {
    console.log("📸 file:", req.file?.originalname, req.file?.size);
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:         "barber_engine/profile_photos",
          public_id:      `user_${req.user._id}_${Date.now()}`,
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
          format:         "jpg",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    console.log("✅ Cloudinary URL:", result.secure_url);
    req.cloudinaryUrl = result.secure_url;
    next();
  } catch (err) {
    console.error("❌ Cloudinary upload error:", JSON.stringify(err));
    return res.status(500).json({ success: false, message: "Photo upload failed: " + (err.message || JSON.stringify(err)) });
  }
}, uploadProfilePhoto);

router.get("/bookings",           getMyBookings);
router.get("/bookings/upcoming",  getUpcomingBookings);
router.get("/bookings/completed", getCompletedBookings);

export default router;