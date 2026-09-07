//////////////////////////////////////////////////////////////
// RATING & REVIEW ENGINE — ADMIN MODERATION CONTROLLER (Phase 2)
//
// Soft-hide only — never edits rating content, never deletes.
// Fixes the old adminRating.controller.js's bug (Phase 0 audit):
// `adminNote` is now an actually-declared field on ServiceRating,
// so it persists this time instead of being silently dropped by
// Mongoose's strict mode.
//
// R1 (Rating Consistency Fix, approved plan): a hide/unhide must
// keep RatingAggregate correct. The state flip and its corresponding
// RatingEvent are written in the SAME transaction, gated on an actual
// state TRANSITION (isHidden false->true, or true->false) — never an
// unconditional write. This is what makes concurrent/duplicate/
// retried hide-or-unhide requests safe: only the request that
// genuinely flips the flag ever creates an event, so the existing
// outbox + appliedEventIds idempotency ledger (both fully unchanged)
// can never be asked to apply the same moderation twice. Mirrors the
// session/transaction/retry-on-transient-conflict shape already
// established in services/ratingSubmission.service.js rather than
// inventing a new pattern. RatingAggregate itself is still touched by
// nobody but jobs/ratingOutbox.job.js — this controller never writes
// to it directly.
//////////////////////////////////////////////////////////////

import mongoose from "mongoose";

import ServiceRating from "../models/ServiceRating.js";
import RatingEvent, { RATING_EVENT_TYPE } from "../models/RatingEvent.js";
import { successResponse, Errors } from "../utils/response.js";
import logger from "../utils/logger.js";

const MAX_ATTEMPTS = 3;

const isDuplicateOrConflict = (err) =>
  err.code === 11000 ||
  (typeof err.hasErrorLabel === "function" && err.hasErrorLabel("TransientTransactionError"));

/**
 * Flips ServiceRating.isHidden from `from` to `to`, gated on the
 * document actually being in state `from` at write time, and — only
 * when that transition genuinely happens — inserts exactly one
 * RatingEvent of `eventType` in the same transaction. Returns
 * `{ transitioned: boolean }`; the caller always responds with the
 * same success message regardless, since "already in the target
 * state" and "we just moved it there" are both a correct end state
 * for the caller (idempotent by design — R1 Step 6/Step 8).
 */
async function applyModeration({ ratingId, from, to, eventType, extraSet }) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updated = await ServiceRating.findOneAndUpdate(
        { _id: ratingId, isHidden: from },
        { $set: { isHidden: to, ...extraSet } },
        { session, new: true }
      );

      if (!updated) {
        // No transition happened — either another request already
        // won this exact flip (concurrent duplicate), or the rating
        // was already in the target state. Either way, nothing to
        // record: no event, no aggregate change.
        await session.abortTransaction();
        return { transitioned: false };
      }

      await RatingEvent.insertMany(
        [
          {
            ratingId: updated._id,
            salonId: updated.salonId,
            type: updated.type,
            targetId: updated.targetId,
            eventType,
            delta: { count: 1, stars: updated.stars },
          },
        ],
        { session, ordered: true }
      );

      await session.commitTransaction();
      return { transitioned: true };
    } catch (err) {
      await session.abortTransaction();

      if (isDuplicateOrConflict(err) && attempt < MAX_ATTEMPTS - 1) {
        logger.warn("adminServiceRating: retrying after transient conflict", { ratingId, eventType, attempt });
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
}

///////////////////////////////////////////////////////////
// POST /api/admin/ratings/hide
///////////////////////////////////////////////////////////
export const hideRatingHandler = async (req, res) => {
  const { ratingId, reason } = req.body;

  const rating = await ServiceRating.findById(ratingId).select("isHidden").lean();
  if (!rating) throw Errors.notFound("Rating not found");

  // Cheap idempotent short-circuit for the overwhelmingly common
  // repeated-click/retry case — no transaction needed.
  if (rating.isHidden) {
    return successResponse(res, { message: "Rating hidden" });
  }

  await applyModeration({
    ratingId,
    from: false,
    to: true,
    eventType: RATING_EVENT_TYPE.RATING_HIDDEN,
    extraSet: { adminNote: reason || "Hidden by admin" },
  });

  return successResponse(res, { message: "Rating hidden" });
};

///////////////////////////////////////////////////////////
// POST /api/admin/ratings/unhide
///////////////////////////////////////////////////////////
export const unhideRatingHandler = async (req, res) => {
  const { ratingId } = req.body;

  const rating = await ServiceRating.findById(ratingId).select("isHidden").lean();
  if (!rating) throw Errors.notFound("Rating not found");

  if (!rating.isHidden) {
    return successResponse(res, { message: "Rating restored" });
  }

  await applyModeration({
    ratingId,
    from: true,
    to: false,
    eventType: RATING_EVENT_TYPE.RATING_UNHIDDEN,
    extraSet: {},
  });

  return successResponse(res, { message: "Rating restored" });
};
