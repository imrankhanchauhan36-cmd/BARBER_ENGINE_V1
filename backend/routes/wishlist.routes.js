import express from "express";
import { getWishlistIds, getWishlistSalons, toggleWishlist } from "../controllers/wishlist.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

// POST /api/v1/wishlist/toggle
router.post("/toggle", protect, toggleWishlist);

// GET /api/v1/wishlist/ids
router.get("/ids", protect, getWishlistIds);

// GET /api/v1/wishlist — full salon details for Saved Salons screen
router.get("/", protect, getWishlistSalons);

export default router;