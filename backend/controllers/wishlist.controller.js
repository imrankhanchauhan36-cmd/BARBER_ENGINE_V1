/**
 * BARBER_ENGINE_V1
 * backend/controllers/wishlist.controller.js
 */

import mongoose from "mongoose";
import Salon from "../models/Salon.js";
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