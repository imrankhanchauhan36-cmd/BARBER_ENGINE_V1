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
import { scopedIdempotency } from "../../../middlewares/scopedIdempotency.middleware.js";
import {
    ownerKycDocumentRateLimiter,
    ownerKycProviderRateLimiter,
    ownerKycSubmissionRateLimiter,
} from "../../../middlewares/rateLimit.middleware.js";
import {
    getMyKYC,
    submitBankHandler,
    submitIdentityHandler,
    submitKYCHandler,
    uploadDocumentHandler,
    verifyOwnerAadhaarCompleteHandler,
    verifyOwnerAadhaarInitiateHandler,
    verifyOwnerBankHandler,
    verifyOwnerFaceMatchHandler,
    verifyOwnerGSTHandler,
    verifyOwnerLivenessHandler,
    verifyOwnerPANHandler,
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

// ─── Phase 3b — rate limit + scoped idempotency (approved 2026-10-10).
// Order mirrors the established Field Agent precedent in
// fieldAgentKyc.routes.js: role check (router.use above) first, then
// the rate limiter, then idempotency, then the handler. ──
router.post(
  "/identity",
  ownerKycSubmissionRateLimiter,
  scopedIdempotency("ownerKyc.identity"),
  submitIdentityHandler
);
router.post(
  "/bank",
  ownerKycSubmissionRateLimiter,
  scopedIdempotency("ownerKyc.bank"),
  submitBankHandler
);

// ─── Document Upload ────────────────────────────────────────
// Inline multer + Cloudinary upload_stream — exact pattern copied from
// routes/user.routes.js's /me/photo route (req.file → upload_stream →
// req.cloudinaryUrl → next controller).
//
// Phase 3b — rate limiter only, deliberately NOT scopedIdempotency/
// idempotency here. Two reasons: (1) this exactly mirrors Field
// Agent's own equivalent route (fieldAgentKyc.routes.js's
// "/documents/:documentType" also has no idempotency middleware,
// only its rate limiter) — not a gap introduced here, a precedent
// followed; (2) the request body for a multipart upload is empty by
// the time any middleware before multer runs (the file lives in
// req.file, populated by upload.single() further down this chain,
// not in req.body), so a payload hash taken before multer would
// always hash `{}` regardless of which file was actually sent — it
// would not meaningfully detect a different upload reused under the
// same key. Wrapping idempotency around the Cloudinary call itself
// (after multer) would be a materially different, riskier change
// than what was approved, so it is deliberately left out and flagged
// here rather than added silently.
router.post(
  "/documents/:documentType",
  ownerKycDocumentRateLimiter,
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

router.post(
  "/submit",
  ownerKycSubmissionRateLimiter,
  scopedIdempotency("ownerKyc.submit"),
  submitKYCHandler
);

// ─── ZEMISH onboarding-gate pass — Owner self-serve verification ───
// New, additive routes — Owner PAN/Bank verification was previously
// Admin-triggered only. Same rate-limit + scoped-idempotency pattern
// already proven for Field Agent's identical routes.
router.post(
  "/verify/pan",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyPan"),
  verifyOwnerPANHandler
);

router.post(
  "/verify/bank",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyBank"),
  verifyOwnerBankHandler
);

router.post(
  "/verify/gst",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyGst"),
  verifyOwnerGSTHandler
);

// ─── ZEMISH Section B — Owner self-serve Aadhaar OTP / Face Match /
// Liveness. Genuinely supported by the existing Cashfree contract (see
// verifyOwnerAadhaarInitiateHandler's own header for the investigation)
// — same rate-limit + scoped-idempotency pattern as every verify/*
// route above. None of these feed isMandatoryOwnerKycVerified(), which
// stays PAN+Bank only.
router.post(
  "/verify/aadhaar/initiate",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyAadhaarInitiate"),
  verifyOwnerAadhaarInitiateHandler
);

router.post(
  "/verify/aadhaar/complete",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyAadhaarComplete"),
  verifyOwnerAadhaarCompleteHandler
);

router.post(
  "/verify/face",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyFace"),
  verifyOwnerFaceMatchHandler
);

router.post(
  "/verify/liveness",
  ownerKycProviderRateLimiter,
  scopedIdempotency("ownerKyc.verifyLiveness"),
  verifyOwnerLivenessHandler
);

export default router;