/**
 * BARBER ENGINE V1
 * backend/modules/kyc/services/encryption.service.js
 * AES-256 Encryption for PAN/Aadhaar/Bank — Phase 6B
 *
 * v1.1 — FIX: read KYC_ENCRYPTION_KEY lazily (inside getKey(), on every
 * call) instead of caching it as a module-level constant at import time.
 *
 * Why: this is an ES Module. All `import` statements across the app are
 * hoisted and resolved before any subsequent top-level code in the
 * entry file runs — including server.js's own `dotenv.config()` call,
 * if that call happens to come after an `import app from "./app.js"`
 * (or any import that transitively pulls in this file). When that
 * happens, the OLD code's module-level
 *   const KEY_HEX = process.env.KYC_ENCRYPTION_KEY;
 * would evaluate to `undefined` at import time and stay `undefined`
 * for the entire lifetime of the process — even though .env is
 * perfectly correct and gets loaded moments later. Reading
 * process.env.KYC_ENCRYPTION_KEY fresh inside getKey() (which only
 * ever runs when encrypt()/decrypt() is actually called, long after
 * the server has finished starting up) makes this immune to import
 * ordering entirely.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

const getKey = () => {
  const KEY_HEX = process.env.KYC_ENCRYPTION_KEY; // ✅ read fresh every call
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error("KYC_ENCRYPTION_KEY must be 64 hex characters in .env");
  }
  return Buffer.from(KEY_HEX, "hex");
};

/**
 * Encrypt sensitive value
 * Returns: "iv:authTag:encryptedData" (base64)
 */
export const encrypt = (plaintext) => {
  if (!plaintext) return null;
  const key    = getKey();
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
};

/**
 * Decrypt sensitive value
 */
export const decrypt = (ciphertext) => {
  if (!ciphertext) return null;
  try {
    const key   = getKey();
    // ✅ Validate format before decoding
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, encB64] = parts;
    const iv         = Buffer.from(ivB64,  "base64");
    const tag        = Buffer.from(tagB64, "base64");
    const enc        = Buffer.from(encB64, "base64");
    const decipher   = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};