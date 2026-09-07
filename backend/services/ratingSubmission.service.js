import mongoose from "mongoose";

import ServiceRating, { RATING_TYPE } from "../models/ServiceRating.js";
import RatingEvent from "../models/RatingEvent.js";
import logger from "../utils/logger.js";
import {
  loadRateableBooking,
  validateDimensionAgainstBooking,
} from "./ratingEligibility.service.js";

//////////////////////////////////////////////////////////////
// 📖 SERVICE OVERVIEW — Rating & Review Engine, Phase 2
//
// Handles POST /api/ratings. Accepts one or many dimensions in a
// single request (Phase 1 Decision 4 — partial/resumable rating is
// supported; the caller may submit a subset now and the rest later).
// Every submitted dimension is validated against the AUTHORITATIVE
// Booking document — never trusted from the client beyond that
// cross-check (see validateDimensionAgainstBooking).
//
// TRANSACTION STRATEGY — why this is NOT a naive
// "insert-and-catch-per-item inside one open transaction" design:
// MongoDB does not reliably support continuing a multi-document
// transaction after an operation error (a duplicate-key error or a
// transient write conflict can leave the transaction unusable for
// further operations). Instead this uses an OPTIMISTIC PRE-CHECK +
// BOUNDED RETRY pattern:
//
//   1. Validate every requested dimension against the booking
//      (stateless — no extra DB read).
//   2. Pre-check which of the still-valid dimensions already have a
//      ServiceRating row (one read, outside any transaction).
//   3. Attempt to insert ONLY the genuinely-new ones inside a single
//      transaction, together with their RatingEvent outbox rows.
//   4. If a race causes an unexpected duplicate-key/transient error
//      at commit time (another request won the same insert between
//      steps 2 and 3), abort, re-run the pre-check (which now sees
//      the winner's committed rows), and retry with whatever
//      genuinely remains — bounded by MAX_ATTEMPTS.
//
// This keeps every transaction's operations uniform (plain inserts,
// no error-recovery mid-transaction) while still converging to the
// correct idempotent outcome under concurrent duplicate submissions.
//////////////////////////////////////////////////////////////

const VALID_TYPES = new Set(Object.values(RATING_TYPE));
const MAX_ATTEMPTS = 3;
const REVIEW_MAX_LENGTH = 500;

const isDuplicateOrConflict = (err) =>
  err.code === 11000 ||
  (typeof err.hasErrorLabel === "function" && err.hasErrorLabel("TransientTransactionError"));

const keyOf = (type, targetId) => `${type}:${targetId.toString()}`;

/**
 * @param {Object} params
 * @param {string} params.bookingId
 * @param {string} params.customerId
 * @param {Array<{type:string, targetId:string, stars:number, review?:string}>} params.ratings
 * @returns {Promise<{success:boolean, status?:number, message?:string, results?:Array}>}
 */
export async function submitRatings({ bookingId, customerId, ratings }) {
  const loaded = await loadRateableBooking({ bookingId, customerId });
  if (!loaded.ok) {
    return { success: false, status: loaded.status, message: humanizeReason(loaded.reason) };
  }
  const { booking } = loaded;

  //////////////////////////////////////////////////////////
  // STEP 1 — STATELESS VALIDATION (type/stars/booking cross-check)
  //////////////////////////////////////////////////////////

  const rejected = [];
  const candidates = []; // {type, targetId, stars, review}

  for (const item of ratings || []) {
    const { type, targetId, stars } = item;

    if (!type || !targetId || !VALID_TYPES.has(type)) {
      rejected.push({ type: type ?? null, targetId: targetId ?? null, status: "REJECTED", reason: "INVALID_TYPE" });
      continue;
    }
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      rejected.push({ type, targetId, status: "REJECTED", reason: "INVALID_STARS" });
      continue;
    }

    const check = validateDimensionAgainstBooking(booking, { type, targetId });
    if (!check.valid) {
      rejected.push({ type, targetId, status: "REJECTED", reason: check.reason });
      continue;
    }

    candidates.push({
      type,
      targetId,
      stars,
      // R3.3-B (approved): review text is now accepted on any dimension
      // — SALON, SERVICE, or PROFESSIONAL — not just SALON.
      review:
        typeof item.review === "string"
          ? item.review.trim().slice(0, REVIEW_MAX_LENGTH) || null
          : null,
    });
  }

  if (candidates.length === 0) {
    return { success: true, results: rejected };
  }

  //////////////////////////////////////////////////////////
  // STEP 2-4 — PRE-CHECK + BOUNDED-RETRY ATOMIC INSERT
  //////////////////////////////////////////////////////////

  const finalStatus = new Map(); // key -> {status, reason?}
  let remaining = candidates;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && remaining.length > 0; attempt++) {
    const existing = await ServiceRating.find({
      bookingId: booking._id,
      customerId,
      $or: remaining.map((r) => ({ type: r.type, targetId: r.targetId })),
    })
      .select("type targetId")
      .lean();

    const existingKeys = new Set(existing.map((r) => keyOf(r.type, r.targetId)));

    const toAttempt = [];
    for (const r of remaining) {
      const key = keyOf(r.type, r.targetId);
      if (existingKeys.has(key)) {
        finalStatus.set(key, { status: "ALREADY_RATED" });
      } else {
        toAttempt.push(r);
      }
    }

    if (toAttempt.length === 0) {
      remaining = [];
      break;
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Re-verify the booking is still COMPLETED inside the
      // transaction — closes the race where the booking is altered
      // (e.g. an admin dispute reopens it) between the initial load
      // and this exact commit.
      const freshBooking = await mongoose
        .model("Booking")
        .findById(booking._id)
        .session(session)
        .select("status")
        .lean();

      if (!freshBooking || freshBooking.status !== "COMPLETED") {
        const err = new Error("Booking is no longer eligible for rating");
        err.notEligible = true;
        throw err;
      }

      const createdRatings = await ServiceRating.insertMany(
        toAttempt.map((r) => ({
          bookingId: booking._id,
          salonId: booking.salonRef,
          customerId,
          type: r.type,
          targetId: r.targetId,
          stars: r.stars,
          review: r.review,
          serviceCompletedAt: booking.completedAt,
        })),
        { session, ordered: true }
      );

      const eventDocs = createdRatings.map((doc, i) => ({
        ratingId: doc._id,
        salonId: booking.salonRef,
        type: toAttempt[i].type,
        targetId: toAttempt[i].targetId,
        delta: { count: 1, stars: toAttempt[i].stars },
      }));

      await RatingEvent.insertMany(eventDocs, { session, ordered: true });

      await session.commitTransaction();

      for (const r of toAttempt) {
        finalStatus.set(keyOf(r.type, r.targetId), { status: "CREATED" });
      }
      remaining = [];
    } catch (err) {
      await session.abortTransaction();

      if (err.notEligible) {
        for (const r of toAttempt) {
          finalStatus.set(keyOf(r.type, r.targetId), { status: "REJECTED", reason: "BOOKING_NOT_COMPLETED" });
        }
        remaining = [];
        break;
      }

      if (isDuplicateOrConflict(err)) {
        // Someone else won the race for one or more of these
        // dimensions between our pre-check and this commit — loop
        // again; the next pre-check will see their committed rows.
        logger.warn("submitRatings: retrying after duplicate/transient conflict", {
          bookingId, attempt,
        });
        remaining = toAttempt;
        continue;
      }

      logger.error("submitRatings: unexpected transaction failure", {
        bookingId, message: err.message,
      });
      throw err;
    } finally {
      session.endSession();
    }
  }

  // Persistent contention across every retry (extremely unlikely) —
  // report rather than silently drop.
  for (const r of remaining) {
    const key = keyOf(r.type, r.targetId);
    if (!finalStatus.has(key)) {
      finalStatus.set(key, { status: "REJECTED", reason: "CONFLICT_RETRY_EXCEEDED" });
    }
  }

  const results = [
    ...rejected,
    ...candidates.map((r) => ({
      type: r.type,
      targetId: r.targetId,
      ...finalStatus.get(keyOf(r.type, r.targetId)),
    })),
  ];

  return { success: true, results };
}

function humanizeReason(reason) {
  switch (reason) {
    case "BOOKING_NOT_FOUND": return "Booking not found";
    case "NOT_BOOKING_OWNER": return "This booking does not belong to you";
    case "BOOKING_NOT_COMPLETED": return "Booking is not eligible for rating";
    default: return "Unable to process rating";
  }
}
