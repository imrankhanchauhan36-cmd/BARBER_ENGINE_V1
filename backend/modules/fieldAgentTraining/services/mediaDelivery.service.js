/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/services/mediaDelivery.service.js
 *
 * FA-3.3 — proprietary training media must never get a permanent
 * public URL (approved plan requirement). Both existing Cloudinary
 * upload sites in this codebase (routes/upload.routes.js,
 * modules/kyc/routes/fieldAgentKyc.routes.js) upload as PUBLIC
 * (default `type:"upload"`) and hand back a permanent `secure_url` —
 * that pattern is correct for a profile photo or a KYC document (KYC
 * access is already gated by who can reach the API at all), but wrong
 * here: training media must stay unreachable by URL alone.
 *
 * This module is the ONLY place training media ever touches
 * Cloudinary. It uploads with `type:"authenticated"` (Cloudinary never
 * serves an authenticated asset over a bare URL) and mints a fresh,
 * short-TTL, cryptographically signed delivery URL per request via
 * `cloudinary.url(..., { sign_url: true })`. `config/cloudinary.js`
 * itself is untouched — this file imports that same shared config,
 * exactly like every other Cloudinary call site already does.
 */

import cloudinary from "../../../config/cloudinary.js";
import { Errors } from "../../../utils/response.js";
import { SIGNED_MEDIA_URL_TTL_SECONDS } from "../constants/fieldAgentTraining.constants.js";

const ALLOWED_MIME_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "application/pdf": "raw",
};

export const isAllowedTrainingMediaMime = (mimetype) => Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mimetype);

// Uploads a buffer (from multer memoryStorage, matching the exact
// pattern already used for KYC documents) as an AUTHENTICATED
// (never public) Cloudinary asset scoped under a training-specific
// folder, and returns only what TrainingContent.media needs to store.
export const uploadTrainingMedia = async ({ buffer, mimetype, contentId }) => {
  const resourceType = ALLOWED_MIME_TYPES[mimetype];
  if (!resourceType) {
    throw Errors.badRequest(`Unsupported media type: ${mimetype}`);
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `field-agent-training/${contentId}`,
        resource_type: resourceType,
        type: "authenticated",
      },
      (err, uploadResult) => (err ? reject(err) : resolve(uploadResult))
    );
    stream.end(buffer);
  });

  return { publicId: result.public_id, resourceType };
};

// Mints a fresh, short-TTL signed delivery URL. Caller
// (fieldAgentTraining.service.js) is responsible for writing the
// MEDIA_ACCESS_GRANTED audit event — kept separate here so this
// function stays a pure Cloudinary URL builder.
export const getSignedMediaUrl = ({ publicId, resourceType }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_MEDIA_URL_TTL_SECONDS;

  const url = cloudinary.url(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: expiresAt,
  });

  return { url, expiresAt };
};
