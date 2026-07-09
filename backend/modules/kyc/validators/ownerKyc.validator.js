/**
 * BARBER ENGINE V1
 * backend/modules/kyc/validators/ownerKyc.validator.js
 * Owner-Facing KYC Validators — Phase 6C
 *
 * Regex patterns intentionally mirror the ones already proven in
 * adminKyc.controller.js's verify-pan/verify-bank handlers — no new
 * validation logic invented, just reused on the submission side.
 */

import { OWNER_DOCUMENT_KEY_MAP } from "../constants/kyc.constants.js";

const isStr   = (v) => typeof v === "string";
const safeStr = (v) => isStr(v) ? v.trim() : "";

const PAN_REGEX     = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const AADHAAR_REGEX = /^\d{12}$/;
const GST_REGEX      = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d[Z]{1}[A-Z\d]{1}$/;
const IFSC_REGEX    = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// ─── Identity Submission ──────────────────────────────────
export const validateIdentity = (body = {}) => {
  const errors = [];
  const pan     = safeStr(body.panNumber).toUpperCase();
  const aadhaar = safeStr(body.aadhaarNumber);
  const gst      = safeStr(body.gstNumber).toUpperCase();

  if (!pan && !aadhaar && !gst) {
    errors.push("At least one of panNumber, aadhaarNumber, or gstNumber is required");
    return errors;
  }

  if (pan && !PAN_REGEX.test(pan)) {
    errors.push("Invalid PAN format. Expected: ABCDE1234F");
  }
  if (aadhaar && !AADHAAR_REGEX.test(aadhaar)) {
    errors.push("Aadhaar number must be exactly 12 digits");
  }
  if (gst && !GST_REGEX.test(gst)) {
    errors.push("Invalid GST format. Expected: 22ABCDE1234F1Z5");
  }
  if (body.nameOnPAN !== undefined && body.nameOnPAN !== null) {
    if (!isStr(body.nameOnPAN)) {
      errors.push("nameOnPAN must be a string");
    } else if (!safeStr(body.nameOnPAN)) {
      errors.push("nameOnPAN cannot be empty");
    }
  }

  return errors;
};

// ─── Bank Submission ───────────────────────────────────────
export const validateBank = (body = {}) => {
  const errors = [];

  const accountHolder = safeStr(body.accountHolder);
  const accountNumber = safeStr(body.accountNumber);
  const ifsc           = safeStr(body.ifsc).toUpperCase();
  const bankName        = safeStr(body.bankName);

  if (!accountHolder) errors.push("accountHolder is required");
  if (!accountNumber) {
    errors.push("accountNumber is required");
  } else if (!/^\d{9,18}$/.test(accountNumber)) {
    errors.push("Account number must contain only digits (9–18)");
  }
  if (!ifsc) {
    errors.push("ifsc is required");
  } else if (!IFSC_REGEX.test(ifsc)) {
    errors.push("Invalid IFSC format. Expected: ABCD0123456");
  }
  if (!bankName) errors.push("bankName is required");

  return errors;
};

// ─── Document Type (URL param) ────────────────────────────
export const validateDocumentKey = (documentKey) => {
  if (!isStr(documentKey) || !OWNER_DOCUMENT_KEY_MAP[documentKey]) {
    return [`documentType must be one of: ${Object.keys(OWNER_DOCUMENT_KEY_MAP).join(", ")}`];
  }
  return [];
};