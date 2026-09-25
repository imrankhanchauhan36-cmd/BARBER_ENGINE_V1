/**
 * BARBER ENGINE V1
 * backend/modules/otp/models/OtpAuditLog.js
 *
 * OTP-1 PART D — persistent, append-only compliance/analytics trail
 * for every OTP send and verify attempt across every purpose (USER,
 * SALON, FIELD_AGENT apply/login, booking no-show).
 *
 * REVISION 1 — this collection is no longer written directly by
 * otp.service.js. It is populated asynchronously by
 * jobs/otpAuditOutbox.job.js, which drains modules/otp/models/OtpAuditOutbox.js
 * (the fast, fire-and-forget write target on the request path) into
 * this collection in the background, with retry on failure. See that
 * job's own header for the full flow. This file's own schema/fields
 * are unchanged — only WHO writes to it changed.
 *
 * NEVER stores the OTP value itself, in any form — not plaintext, not
 * hashed. This collection exists to answer "who/when/which
 * purpose/which provider/did it succeed", never "what was the code".
 */

import mongoose from "mongoose";
import { OTP_PURPOSE } from "../constants/otpPurpose.constants.js";
import { OTP_AUDIT_STATUS } from "../constants/otp.constants.js";

const otpAuditLogSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },

    // Nullable — BOOKING_NOSHOW has no "role" concept (it's an
    // owner-initiated, customer-delivered SMS, not a login).
    role: { type: String, default: null },

    purpose: {
      type: String,
      required: true,
      enum: Object.values(OTP_PURPOSE),
      index: true,
    },

    provider: { type: String, required: true },

    status: {
      type: String,
      required: true,
      enum: Object.values(OTP_AUDIT_STATUS),
      index: true,
    },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    // No existing concept of a client-generated device id anywhere in
    // this codebase's auth flow — accepted only if the caller already
    // has one (e.g. a future mobile-app header), otherwise null. Never
    // required, never used as an identity/authority field.
    deviceId: { type: String, default: null },

    latencyMs: { type: Number, default: null },

    // Present only on SEND_FAILED / VERIFY_FAILED / RATE_LIMITED rows.
    // A short machine code (e.g. "SMS_SEND_FAILED", "INVALID_OTP",
    // "TOO_MANY_ATTEMPTS"), never a raw provider error blob and never
    // the OTP value.
    failureReason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Compliance/analytics lookups: "show me this phone's OTP history for
// this purpose" and "show me recent failures/rate-limits for
// dashboards" are the two access patterns this collection exists for.
otpAuditLogSchema.index({ phone: 1, purpose: 1, createdAt: -1 });
otpAuditLogSchema.index({ status: 1, createdAt: -1 });

const OtpAuditLog = mongoose.model("OtpAuditLog", otpAuditLogSchema);

export default OtpAuditLog;
