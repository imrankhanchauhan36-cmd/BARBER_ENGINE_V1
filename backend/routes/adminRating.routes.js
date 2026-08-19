import express from "express";
import { requireRole } from "../middlewares/role.middleware.js";
import {
  hideRating,
  unhideRating,
} from "../controllers/adminRating.controller.js";

const router = express.Router();

// protect() is already applied at the app.js mount level
// (app.use("/api/admin/ratings", protect, adminRatingRoutes)).
// requireRole("ADMIN") closes the previously-open "auth later" gap.
router.post("/hide",   requireRole("ADMIN"), hideRating);
router.post("/unhide", requireRole("ADMIN"), unhideRating);

export default router;
