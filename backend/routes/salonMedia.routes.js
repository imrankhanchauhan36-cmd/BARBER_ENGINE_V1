import express from "express";
import { requireRole } from "../middlewares/role.middleware.js";
import {
  addSalonMedia,
  getSalonMedia,
} from "../controllers/salonMedia.controller.js";

const router = express.Router();

// protect() is already applied at the app.js mount level
// (app.use("/api/salon-media", protect, onboardingBypass, salonMediaRoutes)).
// requireRole("OWNER") gates the mutating endpoint only — getSalonMedia is
// intentionally left unchanged (F6 scope: addSalonMedia only).
router.post("/", requireRole("OWNER"), addSalonMedia);
router.get("/:salonId", getSalonMedia);

export default router;
