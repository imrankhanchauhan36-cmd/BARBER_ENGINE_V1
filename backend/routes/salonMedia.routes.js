import express from "express";
import { requireRole } from "../middlewares/role.middleware.js";
import {
  addSalonMedia,
  getSalonMedia,
  getMyMedia,
  addMyMedia,
  deleteMyMedia,
  setMyCoverMedia,
  reorderMyMedia,
} from "../controllers/salonMedia.controller.js";

const router = express.Router();

// protect() is already applied at the app.js mount level
// (app.use("/api/salon-media", protect, onboardingBypass, salonMediaRoutes)).
// requireRole("OWNER") gates the mutating endpoint only — getSalonMedia is
// intentionally left unchanged (F6 scope: addSalonMedia only).
router.post("/", requireRole("OWNER"), addSalonMedia);

//////////////////////////////////////////////////////////////
// OWNER-SCOPED MANAGE GALLERY (Phase A) — every handler resolves
// the salon from req.user._id only; salonId is never accepted
// from the client for ownership authority. Declared BEFORE the
// generic "/:salonId" route below so Express never matches the
// literal path segment "owner" as a salonId param.
//////////////////////////////////////////////////////////////
router.use("/owner", requireRole("OWNER"));

router.get("/owner", getMyMedia);
router.post("/owner", addMyMedia);
router.delete("/owner/:mediaId", deleteMyMedia);
router.patch("/owner/:mediaId/cover", setMyCoverMedia);
router.patch("/owner/reorder", reorderMyMedia);

router.get("/:salonId", getSalonMedia);

export default router;
