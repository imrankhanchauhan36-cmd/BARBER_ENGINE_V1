/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FraudSignal.js
 *
 * FA-7.1 — an immutable OBSERVATION of a suspicious acquisition
 * pattern. A FraudSignal is evidence, never a verdict: `severity` is
 * suspiciousness only, and this model has no admin-decision field of
 * any kind — only an authorized admin decision (a future FraudCase
 * concept, not built here) may classify an investigation's outcome.
 * High referral velocity, many legitimate salons, repeated activity,
 * or geographic spread never automatically mean fraud; a FraudSignal
 * says only "this pattern was observed," nothing more.
 *
 * FA-7.1 is foundation only: this file, its constants, and its
 * service contain NO detection logic (no query against
 * AcquisitionReferral/AcquisitionClaim), NO FraudCase, NO admin API,
 * NO enforcement, and NO import of any frozen model — FieldAgentRef/
 * subjectRef/sourceEventRef are all bare ObjectIds, deliberately
 * without a Mongoose `ref` (same precedent as
 * FieldAgentApplication.kycRef: "a bare ObjectId... rather than
 * guessing the eventual shape" — subjectRef is genuinely polymorphic
 * between FieldAgent/Salon depending on subjectType, and sourceEventRef
 * between AcquisitionReferral/AcquisitionClaim depending on signalType).
 *
 * IMMUTABILITY: mirrors modules/kyc/models/VerificationLog.js's proven
 * blocked-update-ops pattern, but closes a gap found in it during the
 * FA-7 audit — that file's own BLOCKED_OPS list omits `replaceOne`/
 * `findOneAndReplace`; this one includes both. Known, honest
 * limitation (identical to the one VerificationLog itself already
 * silently carries): these are Mongoose-level hooks and cannot stop a
 * deliberate raw MongoDB-driver bypass of the ORM layer. Every write
 * path in this codebase uses the Mongoose layer, so this matches the
 * existing accepted risk posture — closing it fully would require
 * MongoDB-level user/role permission separation, which does not exist
 * anywhere in this codebase today and is outside FA-7's authority.
 *
 * Deletion is deliberately left UNBLOCKED — immutable content, not
 * eternal existence. Retention/archival policy is an explicit open
 * business decision (not implemented in FA-7.1); leaving deletion
 * structurally possible now avoids a schema migration once that
 * policy is approved.
 *
 * `timestamps: {createdAt:true, updatedAt:false}` makes "no
 * updatedAt" a schema-level fact, not just a documented convention.
 */

import mongoose from "mongoose";
import { SIGNAL_TYPE, SUBJECT_TYPE, SIGNAL_SEVERITY } from "../constants/fraudSignal.constants.js";

const FraudSignalSchema = new mongoose.Schema(
  {
    signalType: {
      type: String,
      enum: Object.values(SIGNAL_TYPE),
      required: true,
    },

    subjectType: {
      type: String,
      enum: Object.values(SUBJECT_TYPE),
      required: true,
    },

    // Polymorphic (FieldAgent or Salon, per subjectType) — bare, no
    // `ref`. See file header.
    subjectRef: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // Always populated regardless of subjectType, so "all signals
    // touching this agent" is one indexed query, never a join.
    fieldAgentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgent",
      required: true,
    },

    // Suspiciousness tier of the observation — never a fraud verdict.
    severity: {
      type: String,
      enum: Object.values(SIGNAL_SEVERITY),
      required: true,
    },

    // Structured, bounded, minimal, non-PII facts an investigator
    // needs (counts, timestamps, bounded reference-ID lists) — never
    // a raw KYC field, PAN, Aadhaar, bank detail, OTP, or full
    // document. Shape is owned and enforced by whichever detector
    // writes it (FA-7.2+), not validated here beyond requiring an
    // object to exist.
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Traceability back to the one real AcquisitionReferral/
    // AcquisitionClaim document that triggered this signal — bare, no
    // `ref`. See file header.
    sourceEventRef: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // The idempotency/race authority — see the unique index below and
    // fraudSignal.service.js#recordSignal. Deterministic per detector
    // (e.g. `REFERRAL_VELOCITY:{fieldAgentRef}:{hourBucket}`,
    // `WITHDRAW_RECLAIM_CYCLE:{salonRef}:{triggeringClaimId}`) — never
    // random, never time-of-insert-dependent.
    // No `unique: true` here — the explicit `.index()` declaration
    // below is the single source of that constraint (declaring both
    // would produce a duplicate-index definition, the exact lesson
    // already learned on AreaServiceability's own status field).
    dedupeKey: {
      type: String,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// ── IMMUTABILITY ──────────────────────────────────────────────────
FraudSignalSchema.pre("save", function (next) {
  if (!this.isNew) return next(new Error("FraudSignal is immutable — updates not allowed"));
  next();
});

const BLOCKED_OPS = [
  "findOneAndUpdate",
  "updateOne",
  "updateMany",
  "findByIdAndUpdate",
  "update",
  "replaceOne",
  "findOneAndReplace",
];
BLOCKED_OPS.forEach((op) => {
  FraudSignalSchema.pre(op, function (next) {
    return next(new Error(`FraudSignal is immutable — ${op} not allowed`));
  });
});

// ── INDEXES — exactly the 5 approved, each serving a named query ───
// The idempotency/race authority (§9 of the approved plan).
FraudSignalSchema.index({ dedupeKey: 1 }, { unique: true });
// "all signals for FieldAgent", "recent signals".
FraudSignalSchema.index({ fieldAgentRef: 1, createdAt: -1 });
// "signals by type".
FraudSignalSchema.index({ signalType: 1, createdAt: -1 });
// "signals by severity".
FraudSignalSchema.index({ severity: 1, createdAt: -1 });
// "source event lookup".
FraudSignalSchema.index({ sourceEventRef: 1 });

export default mongoose.models.FraudSignal || mongoose.model("FraudSignal", FraudSignalSchema);
