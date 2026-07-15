import express from "express";
import { getWishlistIds, toggleWishlist } from "../controllers/wishlist.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

// POST /api/v1/wishlist/toggle
router.post("/toggle", protect, toggleWishlist);

// GET /api/v1/wishlist/ids
router.get("/ids", protect, getWishlistIds);

export default router;