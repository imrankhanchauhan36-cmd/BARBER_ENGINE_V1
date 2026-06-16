import express from "express";
import {
  createRating,
  flagRating,
  getSalonRatings,
} from "../controllers/rating.controller.js";

const router = express.Router();

// 🔒 write (TEMP auth removed)
router.post("/", createRating);
router.post("/flag", flagRating);

// 🔍 read-only (public)
router.get("/salon/:salonId", getSalonRatings);

export default router;
