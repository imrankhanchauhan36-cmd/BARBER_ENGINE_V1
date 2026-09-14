/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/TerritoryActivationLock.js
 *
 * FA-5.2 — the district-scoped serialization anchor for
 * CommercialTerritory activation-class transitions (DRAFT->ACTIVE,
 * SUSPENDED->ACTIVE). See commercialTerritory.service.js#activateTerritory
 * for the full procedure.
 *
 * This model exists ONLY because two concurrent activation
 * transactions for DIFFERENT CommercialTerritory documents in the same
 * district do NOT naturally conflict under MongoDB's transaction
 * write-conflict detection (they touch different documents) — that is
 * a write-skew gap, not a bug in the transaction mechanism. Forcing
 * every activation attempt for district D to write to the ONE document
 * {districtRef: D} here, as the very first operation inside its
 * transaction, converts that gap into a real, storage-engine-enforced
 * conflict: two concurrent transactions for the same district now
 * genuinely intersect on this document, so MongoDB itself aborts one
 * with a WriteConflict/TransientTransactionError, which the caller
 * retries — re-reading post-commit state and re-evaluating the
 * overlap matrix correctly the second time.
 *
 * This is NOT a distributed lock service and depends on no external
 * system (no Redis, no in-memory state) — the guarantee comes entirely
 * from MongoDB's own multi-document transaction semantics, which are
 * authoritative at the replica-set/storage-engine level regardless of
 * how many backend processes/instances are issuing concurrent
 * requests. Two requests landing on two different application
 * instances are indistinguishable, from MongoDB's point of view, from
 * two requests landing on the same instance.
 *
 * Granularity is deliberately the District, not City or Territory:
 * a DISTRICT-scope territory can conflict with a CITY/AREA_SET
 * territory anywhere else in that same district (see the overlap
 * matrix), so every activation attempt touching the district must
 * serialize against every other one, regardless of which city it
 * targets. City-level locking would miss that case.
 *
 * One document is lazily upserted per District the first time any
 * territory in it is activated; documents are never deleted, and this
 * collection is never read or written outside activateTerritory.
 */

import mongoose from "mongoose";

const TerritoryActivationLockSchema = new mongoose.Schema(
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

export default mongoose.models.TerritoryActivationLock ||
  mongoose.model("TerritoryActivationLock", TerritoryActivationLockSchema);
