/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentEarningPolicyGap.js
 *
 * FA-9 CORRECTIVE (Finding A-1) — durable, independently-processable
 * record of "this booking/claim could not be resolved because no
 * applicable commercial policy existed at the required instant."
 *
 * This decouples two previously-conflated concerns that caused the
 * original defect: "has the main discovery cursor moved past this
 * booking" (fieldAgentEarning.job.js's own checkpoint) and "has this
 * booking's/claim's entitlement actually been resolved." The
 * checkpoint is free to advance past a gapped booking — nothing is
 * lost, because the gap itself is durably tracked here and reprocessed
 * independently of the checkpoint's position, satisfying both "do not
 * freeze the global pipeline over one old unresolved booking" and "no
 * gap can disappear merely because the checkpoint moved forward."
 *
 * Two distinct gap types share this one collection (deliberately, to
 * avoid two near-identical models for what is structurally the same
 * "durably retry until resolvable" concern):
 *   - BOOKING_POLICY_GAP: a completed Booking had no applicable
 *     national/override policy at Booking.completedAt.
 *   - CLAIM_PROGRESS_GAP: an AcquisitionClaim had no applicable policy
 *     at claim.createdAt, so its AcquisitionEarningProgress (and
 *     therefore its target) could not yet be snapshotted.
 *
 * referenceKey is the sole idempotency/dedupe authority — deterministic
 * per booking or per claim, so repeated discovery of the same gap
 * (duplicate workers, replayed batches) never creates a second row.
 *
 * This collection holds NO financial authority whatsoever — it never
 * contains an amount, rate, or credited value, and is never read by
 * any code path that determines what to credit. It exists purely to
 * make "was this looked at, and does it still need retrying" durable
 * and auditable. No PII: only ObjectId references and timestamps.
 */

import mongoose from "mongoose";
import { GAP_TYPE, GAP_STATUS } from "../constants/fieldAgentEarning.constants.js";

const FieldAgentEarningPolicyGapSchema = new mongoose.Schema(
  {
    gapType: {
      type: String,
      enum: Object.values(GAP_TYPE),
      required: true,
      immutable: true,
    },

    // Deterministic: `gap:booking:${bookingRef}` or `gap:claim:${claimRef}`.
    referenceKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },

    bookingRef: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, immutable: true },
    acquisitionClaimRef: { type: mongoose.Schema.Types.ObjectId, ref: "AcquisitionClaim", default: null, immutable: true },
    salonRef: { type: mongoose.Schema.Types.ObjectId, ref: "Salon", default: null, immutable: true },

    // The historical instant policy resolution must be evaluated at —
    // Booking.completedAt for BOOKING_POLICY_GAP, AcquisitionClaim.createdAt
    // for CLAIM_PROGRESS_GAP. Never re-derived as "now" on retry.
    resolutionInstant: { type: Date, required: true, immutable: true },

    status: {
      type: String,
      enum: Object.values(GAP_STATUS),
      default: GAP_STATUS.OPEN,
      required: true,
    },

    firstSeenAt: { type: Date, required: true, default: Date.now, immutable: true },
    lastAttemptAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0, min: 0 },
    lastErrorCode: { type: String, default: null, maxlength: 100 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// referenceKey's unique index is declared inline on the field above —
// no separate .index() call here (avoids a duplicate-index warning,
// same idiom as FieldAgentEarningLedger.js's own idempotencyKey field).
// Bounded reprocessing sweep — smallest-attempted-least-recently first.
FieldAgentEarningPolicyGapSchema.index({ status: 1, lastAttemptAt: 1 });

export default mongoose.models.FieldAgentEarningPolicyGap ||
  mongoose.model("FieldAgentEarningPolicyGap", FieldAgentEarningPolicyGapSchema);
