import express from "express";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { protect }    from "../middlewares/auth.middleware.js";
import { blockAdmin } from "../middlewares/blockAdmin.middleware.js";
import {
  getMe, updateMe, updateProfileLimiter, uploadProfilePhoto,
} from "../controllers/user.controller.js";

const router = express.Router();

// memoryStorage — file buffer in RAM, upload to Cloudinary manually.
//
// fileFilter rejects anything that isn't a real image content-type
// before it's ever buffered or sent to Cloudinary — previously any
// file type was accepted, with Cloudinary as the only (third-party)
// gate. Note this checks the client-supplied Content-Type header,
// not the file's actual magic bytes — a spoofed header can still get
// through; true content-sniffing needs a dedicated library, which
// isn't part of this routing-only change.
const ALLOWED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      return cb(Object.assign(new Error("Only JPEG, PNG, or WEBP images are allowed"), { status: 400 }));
    }
    cb(null, true);
  },
});

router.use(protect);
router.use(blockAdmin);

router.get("/me",    getMe);
router.put("/me",    updateProfileLimiter, updateMe);

/**
 * Wraps upload.single("photo") to catch its own errors (file too
 * large, fileFilter rejection) with a clean, specific response —
 * previously these propagated as an uncaught error past this file's
 * own try/catch (which only wraps the handler *after* multer runs)
 * to whatever the global error handler does.
 */
const handlePhotoUpload = (req, res, next) => {
  upload.single("photo")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "Photo must be under 5MB"
        : "Photo upload failed";
      return res.status(400).json({ success: false, message });
    }

    // fileFilter's own rejection (see ALLOWED_PHOTO_MIME_TYPES above)
    return res.status(err.status || 400).json({ success: false, message: err.message || "Invalid photo upload" });
  });
};

router.post("/me/photo", updateProfileLimiter, handlePhotoUpload, async (req, res, next) => {
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
    // Full detail logged server-side only — err.message/stack were
    // previously sent verbatim to the client (information disclosure)
    // and, separately, JSON.stringify(err) on an Error object logs
    // "{}" (message/stack aren't enumerable own properties), so this
    // failure path was effectively unlogged before.
    console.error("Cloudinary upload error:", err);
    return res.status(500).json({ success: false, message: "Photo upload failed. Please try again." });
  }
}, uploadProfilePhoto);

export default router;
