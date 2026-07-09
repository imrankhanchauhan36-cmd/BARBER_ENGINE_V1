/**
 * BARBER ENGINE V1
 * backend/modules/kyc/routes/ownerKyc.routes.js
 * Owner-Facing KYC Routes — Phase 6C
 *
 * Mounted in app.js as:
 *   app.use("/api/salon/kyc", protect, onboardingBypass, ownerKycRoutes);
 * (same protect + onboardingBypass pattern already used for
 * /api/payments, /api/payouts, /api/reports, etc.)
 */

import express from "express";
import multer from "multer";
import cloudinary from "../../../config/cloudinary.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import {
    getMyKYC,
    submitBankHandler,
    submitIdentityHandler,
    submitKYCHandler,
    uploadDocumentHandler,
} from "../controllers/ownerKyc.controller.js";

const router = express.Router();

// ─── Role Lock ──────────────────────────────────────────────
// protect() already applied at the app.js mount level (same convention
// as /api/payments, /api/payouts). Only the role check happens here,
// matching salon.routes.js's ownerRouter.use(requireRole("OWNER")) pattern.
router.use(requireRole("OWNER"));

// ─── Multer (memory storage) — same base config as user.routes.js,
// plus a strict MIME allowlist (PAN India security hardening — a
// renamed .exe/.zip/.js must not pass just because it was sent in an
// image-upload field). PDF intentionally NOT allowed yet — see the
// resource_type:"image" note below; this stays image-only until PDF
// support is deliberately added as its own change.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB — same as profile photo upload
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Only ${ALLOWED_MIME_TYPES.join(", ")} files are allowed`), false);
    }
  },
});

router.get("/", getMyKYC);
router.post("/identity", submitIdentityHandler);
router.post("/bank", submitBankHandler);

// ─── Document Upload ────────────────────────────────────────
// Inline multer + Cloudinary upload_stream — exact pattern copied from
// routes/user.routes.js's /me/photo route (req.file → upload_stream →
// req.cloudinaryUrl → next controller).
router.post(
  "/documents/:documentType",
  upload.single("document"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      const result = await new Promise((resolve, reject) => {
        // ✅ Defensive re-config right before use — reads process.env at
        // call-time (long after server startup, guaranteed populated),
        // rather than relying solely on config/cloudinary.js's
        // module-load-time .config() call. That shared file calls
        // cloudinary.config() once at import time; if it happened to be
        // imported before server.js's dotenv.config() ran (the same
        // ESM import-hoisting hazard fixed in encryption.service.js),
        // the Cloudinary SDK would have cached an empty config for the
        // lifetime of the process. Re-configuring here is cheap,
        // idempotent, and makes this route immune to that ordering bug
        // regardless of what import order produced it.
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key:    process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        const stream = cloudinary.uploader.upload_stream(
          { folder: `kyc/${req.params.documentType}`, resource_type: "image" },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(req.file.buffer);
      });

      req.cloudinaryUrl = result.secure_url;
      next();
    } catch (err) {
      console.error("❌ Cloudinary upload error (KYC document):", err.message || "Unknown error");
      return res.status(500).json({
        success: false,
        message: "Document upload failed: " + (err.message || JSON.stringify(err)),
      });
    }
  },
  uploadDocumentHandler
);

router.post("/submit", submitKYCHandler);

export default router;