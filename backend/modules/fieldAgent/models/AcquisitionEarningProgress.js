/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/AcquisitionEarningProgress.js
 *
 * FA-9 — cumulative acquisition-earning tracker, keyed PER
 * AcquisitionClaim (locked decision — a new claim, even for the same
 * salon, always starts a fresh target; a prior agent's unused headroom
 * is never inherited). Deliberately independent of, and NEVER written
 * to, AcquisitionClaim itself — reaching TARGET_REACHED here has no
 * effect on AcquisitionClaim.status, which remains ACTIVE under its
 * own frozen lifecycle (FA-9 Business Decision Lock §F/§9: this is
 * exactly what preserves the Acquisition Agent's recognized salon
 * contact/support relationship after financial entitlement ends).
 *
 * earnedInPaise is mutated ONLY via the single atomic pipeline
 * findOneAndUpdate in fieldAgentEarning.service.js#creditAcquisitionProgress
 * (FA-9 Issue 1 correction) — never a separate read-then-write. Every
 * increment to earnedInPaise is mirrored exactly into one
 * FieldAgentEarningLedger row in the SAME transaction, so
 * SUM(ledger.creditedAmountInPaise) === earnedInPaise is a structural
 * invariant, not a convention.
 *
 * lastAppliedDelta/lastAppliedAt are transient, server-only working
 * fields written by that same atomic operation solely to carry the
 * EXACT delta this specific transaction applied out to the caller —
 * they are never read as authoritative business state by anything
 * else, never client-writable, and are overwritten (not accumulated)
 * on every call. They are not an independent source of truth: the
 * durable invariant lives in earnedInPaise and the ledger, never here.
 */

import mongoose from "mongoose";
import { ACQUISITION_PROGRESS_STATUS } from "../constants/fieldAgentEarning.constants.js";

const AcquisitionEarningProgressSchema = new mongoose.Schema(
  {
    acquisitionClaimRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AcquisitionClaim",
      required: true,
      immutable: true,
    },

    // Denormalized for query convenience only — never treated as a
    // second source of truth (same discipline AcquisitionClaim's own
    // stateRef/districtRef header already documents for itself).
    salonRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      immutable: true,
    },

    // Snapshotted once, at first-credit time, from the policy resolved
    // for the booking that first touched this claim — never
    // retroactively changed by a later policy publish (FA-9 locked
    // historical-integrity rule).
    targetInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: "targetInPaise must be a whole number (paise)" },
    },

    earnedInPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: "earnedInPaise must be a whole number (paise)" },
    },

    status: {
      type: String,
      enum: Object.values(ACQUISITION_PROGRESS_STATUS),
      default: ACQUISITION_PROGRESS_STATUS.IN_PROGRESS,
      required: true,
    },

    // Transient working fields — see file header. Not part of the
    // durable financial invariant. lastRemainingBeforeCredit is the
    // pre-image remaining capacity the last atomic op observed —
    // needed to distinguish "delta was 0 because target was already
    // reached" from "delta was 0 because the raw eligible amount
    // itself was 0" (e.g. a zero-commission booking) — conflating
    // these was a genuine defect caught by this phase's own dedicated
    // test (see fieldAgentEarning.service.js's own pipeline comment).
    lastAppliedDelta: { type: Number, default: 0 },
    lastRemainingBeforeCredit: { type: Number, default: 0 },
    lastAppliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AcquisitionEarningProgressSchema.index({ acquisitionClaimRef: 1 }, { unique: true });

export default mongoose.models.AcquisitionEarningProgress ||
  mongoose.model("AcquisitionEarningProgress", AcquisitionEarningProgressSchema);
