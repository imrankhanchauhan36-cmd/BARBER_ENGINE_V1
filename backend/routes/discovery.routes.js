import express from "express";

import {
  getCategories,
  getRecommendedServices,
  getSalonById,
  getSalons,
  getSalonServices,
  getTrendingServices,
} from "../controllers/discovery.controller.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

//////////////////////////////////////////////////////////////
// 🌍 PUBLIC DISCOVERY ROUTES
//////////////////////////////////////////////////////////////
// GET /api/v1/discovery/salons
// optionalAuth: sets req.userId if a valid token is present, but
// NEVER blocks the request — this route stays public either way.
// Needed so getSalons() can attach wishlist.isWishlisted when
// ?includeWishlist=true, without requiring login.
router.get(
  "/salons",
  optionalAuth,
  getSalons
);

//////////////////////////////////////////////////////////////
// 🏪 SINGLE SALON DETAILS
//////////////////////////////////////////////////////////////

// GET /api/v1/discovery/salons/:salonId
router.get(
  "/salons/:salonId",
  getSalonById
);

//////////////////////////////////////////////////////////////
// 💇 SALON SERVICES
//////////////////////////////////////////////////////////////

// GET /api/v1/discovery/salons/:salonId/services
router.get(
  "/salons/:salonId/services",
  getSalonServices
);

//////////////////////////////////////////////////////////////
// 📂 SERVICE CATEGORIES — Category Discovery Engine
//////////////////////////////////////////////////////////////

// GET /api/discovery/categories
// GET /api/discovery/categories?applicableFor=MEN
router.get(
  "/categories",
  getCategories
);

//////////////////////////////////////////////////////////////
// 🔥 TRENDING SERVICES — organic cross-salon demand feed
//////////////////////////////////////////////////////////////

// GET /api/discovery/trending-services
// GET /api/discovery/trending-services?applicableFor=MEN
router.get(
  "/trending-services",
  getTrendingServices
);

//////////////////////////////////////////////////////////////
// ❤️ RECOMMENDED FOR YOU — personalized (logged-in) or
//     trending-fallback (guest) cross-salon feed
//////////////////////////////////////////////////////////////

// GET /api/discovery/recommended
// optionalAuth: req.userId set if valid token present, but route
// stays public — guest users get trending-fallback, never a 401.
router.get(
  "/recommended",
  optionalAuth,
  getRecommendedServices
);

export default router;