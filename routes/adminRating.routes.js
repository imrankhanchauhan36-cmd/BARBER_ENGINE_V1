import express from "express";
import {
  hideRating,
  unhideRating,
} from "../controllers/adminRating.controller.js";

const router = express.Router();

// 🔒 Admin-only (auth later)
router.post("/hide", hideRating);
router.post("/unhide", unhideRating);

export default router;
