/**
 * BARBER ENGINE V1
 * backend/modules/kyc/routes/fieldAgentKyc.routes.js
 * Field Agent-Facing KYC Routes — FA-3.2
 *
 * Mounted in app.js as:
 *   app.use("/api/field-agent/kyc", protect, onboardingBypass, fieldAgentKycRoutes);
 * (same protect + onboardingBypass pattern already used for
 * /api/salon/kyc and /api/field-agent).
 */

import express from "express";
import multer from "multer";
import cloudinary from "../../../config/cloudinary.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import {
    fieldAgentKycDocumentRateLimiter,
    fieldAgentKycProviderRateLimiter,
    fieldAgentKycSubmissionRateLimiter,
} from "../../../middlewares/rateLimit.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
    getMyFieldAgentKYC,
    submitFieldAgentBankHandler,
    submitFieldAgentIdentityHandler,
    submitFieldAgentKYCHandler,
    uploadFieldAgentDocumentHandler,
    verifyFieldAgentPANHandler,
} from "../controllers/fieldAgentKyc.controller.js";
import { fieldAgentKycSchemas } from "../validators/fieldAgentKyc.validator.js";

const router = express.Router();

// ─── Role Lock ──────────────────────────────────────────────
// protect() already applied at the app.js mount level. Field Agent
// must never reach Owner's KYC routes and vice versa — each router
// locks to exactly one role, mirroring ownerKyc.routes.js's own
// router.use(requireRole("OWNER")) pattern.
router.use(requireRole("FIELD_AGENT"));

// ─── Multer (memory storage) — same allowlist/size cap as
// ownerKyc.routes.js, kept independent so a future change to Owner's
// upload config cannot silently affect Field Agent or vice versa.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Only ${ALLOWED_MIME_TYPES.join(", ")} files are allowed`), false);
    }
  },
});

router.get("/", getMyFieldAgentKYC);

router.post(
  "/identity",
  fieldAgentKycSubmissionRateLimiter,
  idempotency,
  validate(fieldAgentKycSchemas.identity),
  submitFieldAgentIdentityHandler
);

router.post(
  "/bank",
  fieldAgentKycSubmissionRateLimiter,
  idempotency,
  validate(fieldAgentKycSchemas.bank),
  submitFieldAgentBankHandler
);

// ─── Document Upload ────────────────────────────────────────
// Inline multer + Cloudinary upload_stream — same pattern as
// ownerKyc.routes.js, kept as its own copy rather than a shared helper
// per the approved plan (safest option: zero risk to the Owner route).
router.post(
  "/documents/:documentType",
  fieldAgentKycDocumentRateLimiter,
  validate(fieldAgentKycSchemas.documentTypeParam, "params"),
  upload.single("document"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      const result = await new Promise((resolve, reject) => {
        // Defensive re-config right before use — see ownerKyc.routes.js's
        // identical comment for the ESM import-hoisting hazard this guards against.
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key:    process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        const stream = cloudinary.uploader.upload_stream(
          { folder: `kyc/field-agent/${req.params.documentType}`, resource_type: "image" },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(req.file.buffer);
      });

      req.cloudinaryUrl = result.secure_url;
      next();
    } catch (err) {
      console.error("❌ Cloudinary upload error (Field Agent KYC document):", err.message || "Unknown error");
      return res.status(500).json({
        success: false,
        message: "Document upload failed: " + (err.message || JSON.stringify(err)),
      });
    }
  },
  uploadFieldAgentDocumentHandler
);

router.post(
  "/verify/pan",
  fieldAgentKycProviderRateLimiter,
  idempotency,
  validate(fieldAgentKycSchemas.verifyPan),
  verifyFieldAgentPANHandler
);

router.post("/submit", fieldAgentKycSubmissionRateLimiter, idempotency, submitFieldAgentKYCHandler);

export default router;
