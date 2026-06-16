import express from "express";
import {
  addSalonMedia,
  getSalonMedia,
} from "../controllers/salonMedia.controller.js";

const router = express.Router();

router.post("/", addSalonMedia);
router.get("/:salonId", getSalonMedia);

export default router;
