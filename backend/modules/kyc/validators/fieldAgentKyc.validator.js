/**
 * BARBER ENGINE V1
 * backend/modules/kyc/validators/fieldAgentKyc.validator.js
 * Field Agent-Facing KYC Validators — FA-3.2
 *
 * Joi conventions mirror modules/fieldAgent/validators/fieldAgentApplication.validator.js
 * (shared `.unknown(false)`, per-field `.messages()`), wired through the
 * existing middlewares/validate.middleware.js. Regex patterns mirror
 * the ones already proven in ownerKyc.validator.js — no new validation
 * logic invented, just reused on the Field Agent side.
 *
 * Phase 7A (Cashfree Secure ID) — added aadhaarInitiate/aadhaarVerify,
 * verifyBank, verifyGst schemas for the new self-serve routes. GST is
 * optional for Field Agent (verifyGst is only ever called when the
 * applicant supplies a number) — this does not add GST to
 * FIELD_AGENT_DOCUMENT_KEY_MAP/REQUIRED_DOCUMENT_KEYS, since GST here
 * is a number+API check only, no certificate upload required.
 */

import Joi from "joi";
import { FIELD_AGENT_DOCUMENT_KEY_MAP } from "../constants/kyc.constants.js";

const PAN_REGEX     = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const AADHAAR_REGEX = /^\d{12}$/;
const IFSC_REGEX    = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const OTP_REGEX      = /^\d{4,8}$/;
// GSTIN: 2-digit state code + 10-char PAN + 1 entity code + 'Z' + 1 checksum
const GST_REGEX      = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// Shared by both the "/bank" submit-only route and the "/verify/bank"
// self-serve route — identical fields, identical validation, so both
// keys below reference this one schema instead of maintaining two
// copies (Joi schemas are stateless and safe to reuse across routes).
const bankSchema = Joi.object({
  accountHolder: Joi.string().trim().min(1).max(150).required().messages({
    "any.required": "accountHolder is required",
  }),
  accountNumber: Joi.string().trim().pattern(/^\d{9,18}$/).required().messages({
    "string.pattern.base": "Account number must contain only digits (9–18)",
    "any.required": "accountNumber is required",
  }),
  ifsc: Joi.string().trim().uppercase().pattern(IFSC_REGEX).required().messages({
    "string.pattern.base": "Invalid IFSC format. Expected: ABCD0123456",
    "any.required": "ifsc is required",
  }),
  bankName: Joi.string().trim().min(1).max(150).required().messages({
    "any.required": "bankName is required",
  }),
}).unknown(false);

export const fieldAgentKycSchemas = {
  identity: Joi.object({
    panNumber: Joi.string().trim().uppercase().pattern(PAN_REGEX).optional().messages({
      "string.pattern.base": "Invalid PAN format. Expected: ABCDE1234F",
    }),
    nameOnPAN: Joi.string().trim().min(1).max(100).optional(),
    aadhaarNumber: Joi.string().trim().pattern(AADHAAR_REGEX).optional().messages({
      "string.pattern.base": "Aadhaar number must be exactly 12 digits",
    }),
  })
    .unknown(false)
    .or("panNumber", "aadhaarNumber")
    .messages({
      "object.missing": "At least one of panNumber or aadhaarNumber is required",
    }),

  bank: bankSchema,

  verifyPan: Joi.object({
    panNumber: Joi.string().trim().uppercase().pattern(PAN_REGEX).required().messages({
      "string.pattern.base": "Invalid PAN format. Expected: ABCDE1234F",
      "any.required": "panNumber is required",
    }),
    nameOnPAN: Joi.string().trim().min(1).max(100).optional(),
  }).unknown(false),

  documentTypeParam: Joi.object({
    documentType: Joi.string()
      .valid(...Object.keys(FIELD_AGENT_DOCUMENT_KEY_MAP))
      .required()
      .messages({
        "any.only": `documentType must be one of: ${Object.keys(FIELD_AGENT_DOCUMENT_KEY_MAP).join(", ")}`,
        "any.required": "documentType is required",
      }),
  }).unknown(false),

  // ─── Phase 7A (Cashfree Secure ID) ────────────────────────────────
  aadhaarInitiate: Joi.object({
    aadhaarNumber: Joi.string().trim().pattern(AADHAAR_REGEX).required().messages({
      "string.pattern.base": "Aadhaar number must be exactly 12 digits",
      "any.required": "aadhaarNumber is required",
    }),
  }).unknown(false),

  aadhaarVerify: Joi.object({
    otp: Joi.string().trim().pattern(OTP_REGEX).required().messages({
      "string.pattern.base": "Invalid OTP format",
      "any.required": "otp is required",
    }),
  }).unknown(false),

  verifyBank: bankSchema,

  verifyGst: Joi.object({
    gstNumber: Joi.string().trim().uppercase().pattern(GST_REGEX).required().messages({
      "string.pattern.base": "Invalid GSTIN format. Expected: 22ABCDE1234F1Z5",
      "any.required": "gstNumber is required",
    }),
  }).unknown(false),
};
