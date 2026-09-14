/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/PolicyOverrideActivationLock.js
 *
 * FA-9 — the district-scoped serialization anchor for
 * CommercialPolicyOverride publish-time overlap prevention. A NEW,
 * separate collection dedicated to policy overrides — this does NOT
 * reuse or modify FA-5.2's own TerritoryActivationLock, which remains
 * exclusively CommercialTerritory's concern.
 *
 * The correctness argument is identical to TerritoryActivationLock's
 * own (see that file's header for the full write-skew explanation):
 * two concurrent publish transactions for DIFFERENT CommercialPolicyOverride
 * documents in the same district do not naturally conflict under
 * MongoDB's transaction write-conflict detection (they touch different
 * documents). Forcing every publish attempt for district D to write to
 * the ONE document {districtRef: D} here, as the very first operation
 * inside its transaction, converts that gap into a real,
 * storage-engine-enforced conflict.
 *
 * One document is lazily upserted per District the first time any
 * override in it is published; documents are never deleted, and this
 * collection is never read or written outside publishPolicyOverride.
 */

import mongoose from "mongoose";

const PolicyOverrideActivationLockSchema = new mongoose.Schema(
  {
    districtRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
      unique: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

export default mongoose.models.PolicyOverrideActivationLock ||
  mongoose.model("PolicyOverrideActivationLock", PolicyOverrideActivationLockSchema);
