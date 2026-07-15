/**
 * BARBER_ENGINE_V1
 * backend/models/Wishlist.js
 *
 * Deliberately minimal — just the (userId, salonId) relationship.
 * No extra fields (notes, tags, etc.) until a real product need for
 * them shows up. The compound unique index is what actually
 * enforces "one wishlist entry per user per salon" — the toggle
 * controller doesn't need to pre-check existence, it can rely on
 * this constraint (see wishlist.controller.js).
 */

import mongoose from "mongoose";

const WishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
    },
  },
  // Only createdAt is meaningful here — a wishlist entry is either
  // created or deleted, it's never "updated" in place, so tracking
  // updatedAt would just be dead data on every document.
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Enforces one entry per (user, salon) pair — also the index used
// by GET /wishlist/ids (userId-scoped list).
WishlistSchema.index({ userId: 1, salonId: 1 }, { unique: true });

// Analytics-ready: most-wishlisted salons, trending, "recently
// saved by others" — all queryable by salonId (optionally sorted by
// recency) without a schema change later.
WishlistSchema.index({ salonId: 1, createdAt: -1 });

export default mongoose.models.Wishlist || mongoose.model("Wishlist", WishlistSchema);