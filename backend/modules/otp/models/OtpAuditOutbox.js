/**
 * BARBER ENGINE V1
 * backend/modules/otp/models/OtpAuditOutbox.js
 *
 * OTP-1 REVISION 1 — the fast, durable landing zone for every OTP
 * audit event. otp.service.js writes here (fire-and-forget, never
 * awaited by the request path) instead of writing OtpAuditLog
 * directly. A background job (jobs/otpAuditOutbox.job.js) drains
 * PENDING rows into OtpAuditLog asynchronously, retrying on failure.
 *
 * Mirrors the same claim/apply state machine already established by
 * jobs/ratingOutbox.job.js (RatingEvent -> RatingAggregate): a single
 * atomic findOneAndUpdate claims a batch (PENDING -> PROCESSING), a
 * stale-claim window reclaims rows from a crashed worker, and a
 * PENDING/FAILED row is NEVER deleted until it is durably copied into
 * OtpAuditLog — so a Mongo hiccup at drain-time loses nothing, it just
 * retries on the next tick.
 *
 * NEVER stores the OTP value itself — identical field set to
 * OtpAuditLog, same "no otp field, ever" guarantee.
 */

import mongoose from "mongoose";
import { OTP_PURPOSE } from "../constants/otpPurpose.constants.js";
import { OTP_AUDIT_STATUS, OTP_OUTBOX_STATE } from "../constants/otp.constants.js";

const otpAuditOutboxSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    role: { type: String, default: null },
    purpose: { type: String, required: true, enum: Object.values(OTP_PURPOSE) },
    provider: { type: String, required: true },
    status: { type: String, required: true, enum: Object.values(OTP_AUDIT_STATUS) },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    deviceId: { type: String, default: null },
    latencyMs: { type: Number, default: null },
    failureReason: { type: String, default: null },

    // Outbox-only bookkeeping — absent from OtpAuditLog.
    outboxState: {
      type: String,
      required: true,
      enum: Object.values(OTP_OUTBOX_STATE),
      default: OTP_OUTBOX_STATE.PENDING,
      index: true,
    },
    claimedAt: { type: Date, default: null }, // set when a worker claims this row (PROCESSING)
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The job's own poll query: "give me up to BATCH_SIZE PENDING rows,
// oldest first" — and its stale-claim reclaim query: "PROCESSING rows
// claimed longer ago than the stale window."
otpAuditOutboxSchema.index({ outboxState: 1, createdAt: 1 });

const OtpAuditOutbox = mongoose.model("OtpAuditOutbox", otpAuditOutboxSchema);

export default OtpAuditOutbox;
