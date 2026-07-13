import express from "express";

import {
  getCategories,
  getSalonById,
  getSalons,
  getSalonServices,
} from "../controllers/discovery.controller.js";

const router = express.Router();

//////////////////////////////////////////////////////////////
// 🌍 PUBLIC DISCOVERY ROUTES
//////////////////////////////////////////////////////////////

// GET /api/v1/discovery/salons
router.get(
  "/salons",
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


// GET /api/v1/discovery/salons/:salonId/services
router.get(
  "/salons/:salonId/services",
  getSalonServices
);

+//////////////////////////////////////////////////////////////
+// 📂 SERVICE CATEGORIES — Category Discovery Engine
+//////////////////////////////////////////////////////////////
+
+// GET /api/discovery/categories
+// GET /api/discovery/categories?applicableFor=MEN
router.get(
  "/categories",
  getCategories
);

export default router;
