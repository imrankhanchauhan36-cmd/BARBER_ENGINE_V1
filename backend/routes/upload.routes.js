import express from "express";
import { v2 as cloudinary } from "cloudinary";
import { upload } from "../middlewares/upload.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/image", protect, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image provided" });
    }

    // Config here — env already loaded by this time
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const b64 = Buffer.from(req.file.buffer).toString("base64");
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    const result = await cloudinary.uploader.upload(dataURI, {
      folder: "barber_engine",
      transformation: [{ width: 800, height: 800, crop: "limit", quality: "auto" }],
    });

    return res.json({
      success: true,
      url:      result.secure_url,
      publicId: result.public_id,
    });

  } catch (err) {
    console.error("UPLOAD_ERROR:", err.message);
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
});

export default router;
