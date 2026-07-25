/**
 * BARBER_ENGINE_V1
 * backend/controllers/wishlist.controller.js
 */

import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Salon from "../models/Salon.js";
import SalonMedia from "../models/SalonMedia.js";
import Wishlist from "../models/Wishlist.js";
import logger from "../utils/logger.js";

///////////////////////////////////////////////////////////
// TOGGLE WISHLIST — add if not present, remove if present
//
// POST /api/v1/wishlist/toggle
// Body: { salonId }
//
// Delete-first pattern: attempt findOneAndDelete first (atomic —
// either it removed exactly one document or it removed none). Only
// if nothing was deleted do we attempt a create. This narrows the
// race window versus a separate findOne() + create/delete, though
// the real guarantee against a duplicate under concurrent requests
// is still the unique index on Wishlist (userId+salonId) — a losing
// concurrent create hits E11000, which is treated as success (the
// entry exists, which is the caller's intended end state either way).
///////////////////////////////////////////////////////////
export const toggleWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const { salonId } = req.body;

    if (!salonId || !mongoose.isValidObjectId(salonId)) {
      return res.status(400).json({ success: false, message: "A valid salonId is required" });
    }

    const salonExists = await Salon.exists({ _id: salonId, isDeleted: { $ne: true } });
    if (!salonExists) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const deleted = await Wishlist.findOneAndDelete({ userId, salonId });
    if (deleted) {
      return res.json({ success: true, isWishlisted: false });
    }

    try {
      await Wishlist.create({ userId, salonId });
      return res.json({ success: true, isWishlisted: true });
    } catch (err) {
      if (err.code === 11000) {
        return res.json({ success: true, isWishlisted: true });
      }
      throw err;
    }
  } catch (err) {
    logger.error("TOGGLE WISHLIST ERROR", { message: err.message, stack: err.stack });
    return res.status(500).json({ success: false, message: "Unable to update wishlist" });
  }
};

///////////////////////////////////////////////////////////
// GET WISHLIST IDS — lightweight list for O(1) client-side lookup
//
// GET /api/v1/wishlist/ids
//
// Returns just salon IDs, not populated salon documents — the
// frontend already has full salon data from the Discovery API; it
// only needs to know WHICH salons are wishlisted, so it can render
// filled/unfilled hearts via wishlistedIds.has(salonId).
///////////////////////////////////////////////////////////
export const getWishlistIds = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const entries = await Wishlist.find({ userId }).select("salonId").lean();
    const ids = entries.map((e) => e.salonId.toString());

    return res.json({ success: true, data: ids });
  } catch (err) {
    logger.error("GET WISHLIST IDS ERROR", { message: err.message, stack: err.stack });
    return res.status(500).json({ success: false, message: "Unable to load wishlist" });
  }
};

///////////////////////////////////////////////////////////
// DTO — only fields the client should ever see for a saved salon.
// Keeps `business` projection safe (excludes commissionRate,
// isSuspended, suspendedReason, suspendedAt — internal/admin-only).
///////////////////////////////////////////////////////////
const toWishlistSalonDTO = (salon, wishlistedAt, isVisited, coverUrl) => ({
  _id:              salon._id,
  basicInfo:        salon.basicInfo,
  media:            salon.media,
  coverUrl,
  location:         salon.location,
  rating:           salon.rating,
  specializations:  salon.specializations,
  business: {
    isShopOpen:     salon.business?.isShopOpen ?? false,
    isForceClosed:  salon.business?.isForceClosed ?? false,
  },
  wishlistedAt,
  isVisited,
});

///////////////////////////////////////////////////////////
// GET WISHLIST SALONS — full salon details for Saved Salons screen
//
// GET /api/v1/wishlist?page=1&limit=20
//
// Unlike getWishlistIds (lightweight, ID-only), this returns full
// Salon documents (via DTO) so the Saved Salons screen can render
// SalonCard without a second round-trip. Sorted by most-recently-
// wishlisted first (Wishlist.createdAt desc, _id desc for stable
// ordering when timestamps tie) — this IS the "Recently Added" tab's
// data source.
///////////////////////////////////////////////////////////
export const getWishlistSalons = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const page  = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip  = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      Wishlist.find({ userId })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "salonId",
          match: { isDeleted: { $ne: true } },
          select: "basicInfo media location business rating specializations",
        })
        .lean(),
      Wishlist.countDocuments({ userId }),
    ]);

    // populate() leaves salonId as null when match fails (e.g. salon
    // was deleted after being wishlisted) — filter those out rather
    // than sending broken entries to the client.
    const validEntries = entries.filter((e) => e.salonId);

    // "Visited" = user has a COMPLETED booking at this salon.
    // One query for all salonIds on this page, then a Set for O(1)
    // lookup while mapping — avoids an N+1 query per salon.
    const salonIds = validEntries.map((e) => e.salonId._id);
    const visitedSalonIds = salonIds.length
      ? await Booking.distinct("salonRef", {
          userRef: userId,
          salonRef: { $in: salonIds },
          status: "COMPLETED",
          isDeleted: { $ne: true },
        })
      : [];
    const visitedSet = new Set(visitedSalonIds.map((id) => id.toString()));

    // Cover photo — same pattern as discovery.controller.js: real
    // photos live in the SalonMedia collection, not Salon.media
    // .coverImage.url (which is almost always null in practice).
    const covers = await SalonMedia.find({ salonId: { $in: salonIds }, isDeleted: false })
      .sort({ order: 1 })
      .select("salonId url")
      .lean();
    const coverMap = {};
    for (const c of covers) {
      const key = c.salonId.toString();
      if (!coverMap[key]) coverMap[key] = c.url;
    }

    const salons = validEntries.map((e) => {
      const sid = e.salonId._id.toString();
      const coverUrl = e.salonId.media?.coverImage?.url || coverMap[sid] || null;
      return toWishlistSalonDTO(e.salonId, e.createdAt, visitedSet.has(sid), coverUrl);
    });

    return res.json({
      success: true,
      data: salons,
      pagination: { total, page, limit },
    });
  } catch (err) {
    logger.error("GET WISHLIST SALONS ERROR", { message: err.message, stack: err.stack });
    return res.status(500).json({ success: false, message: "Unable to load saved salons" });
  }
};